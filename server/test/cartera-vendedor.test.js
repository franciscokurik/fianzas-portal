// La cartera es lo que separa a un vendedor de los clientes de sus compañeros.
// Aquí no se está probando una comodidad de la pantalla: por estas rutas pasan
// los estados financieros y las pólizas de terceros, y esconder un botón no
// impide cambiar el id en la URL. Cada ruta tiene que negar por su cuenta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { baseEnMemoria } from './ayuda/pg-memoria.js';

process.env.DATABASE_URL ??= 'postgres://noop';
process.env.JWT_SECRET = 'secreto-de-prueba';

const { default: db } = await import('../src/db.js');
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

const { default: app } = await import('../src/app.js');
const { signToken } = await import('../src/auth/middleware.js');
const { inicializar } = await import('../src/migrations.js');

let servidor;
let base;

// Empresas: 1 = de Mariana, 2 = de Pablo, 3 = sin vendedor (solo Home Office).
const [DE_MARIANA, DE_PABLO, SIN_VENDEDOR] = [1, 2, 3];
let admin;
let mariana;
let pablo;
let ana;

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social, rfc) VALUES
      ('Constructora A', 'AAA010101AAA'),
      ('Constructora B', 'BBB010101BBB'),
      ('Constructora C', 'CCC010101CCC');

    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Home Office', 'admin@fortex.mx',   'x', 'admin'),
      (NULL, 'Mariana',     'mariana@fortex.mx', 'x', 'vendedor'),
      (NULL, 'Pablo',       'pablo@fortex.mx',   'x', 'vendedor'),
      (1,    'Ana',         'ana@constructora-a.mx', 'x', 'client');

    UPDATE clients SET vendedor_id = 2 WHERE id = 1;
    UPDATE clients SET vendedor_id = 3 WHERE id = 2;

    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta', 'aserta');
    INSERT INTO proyectos (client_id, nombre, monto_contrato) VALUES
      (1, 'Obra de A', 100000000),
      (2, 'Obra de B', 100000000);
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                         tipo_fianza_id, monto_afianzado, fecha_recordatorio)
      VALUES (1, 1, 1, 'ASE-A', (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 5000000, '2026-08-11'),
             (2, 2, 1, 'ASE-B', (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 5000000, '2026-08-11');
    INSERT INTO documentos (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo)
      VALUES (1, 'fianza', 1, 'caratula', 'https://res.cloudinary.com/fx/raw/upload/v1/a.pdf', 'a.pdf'),
             (2, 'fianza', 2, 'caratula', 'https://res.cloudinary.com/fx/raw/upload/v1/b.pdf', 'b.pdf');
  `);

  admin = signToken({ id: 1, role: 'admin', nombre: 'Home Office' });
  mariana = signToken({ id: 2, role: 'vendedor', nombre: 'Mariana' });
  pablo = signToken({ id: 3, role: 'vendedor', nombre: 'Pablo' });
  ana = signToken({ id: 4, role: 'client', client_id: DE_MARIANA, nombre: 'Ana' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const pedir = (ruta, token, opciones = {}) =>
  fetch(`${base}${ruta}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opciones.headers || {}),
    },
    redirect: 'manual',
  });

const json = (cuerpo) => JSON.stringify(cuerpo);

/* --- Lo que ve cada quien --- */

test('el vendedor solo ve los clientes de su cartera', async () => {
  const { clientes } = await (await pedir('/api/admin/clientes', mariana)).json();
  assert.deepEqual(clientes.map((c) => c.razon_social), ['Constructora A']);

  const deTodos = await (await pedir('/api/admin/clientes', admin)).json();
  assert.equal(deTodos.clientes.length, 3, 'Home Office ve todo, incluso lo no asignado');
});

test('un cliente sin vendedor asignado solo lo ve Home Office', async () => {
  for (const token of [mariana, pablo]) {
    const { clientes } = await (await pedir('/api/admin/clientes', token)).json();
    assert.ok(!clientes.some((c) => c.id === SIN_VENDEDOR));
  }
});

test('el vendedor no abre el detalle de un cliente ajeno', async () => {
  const propio = await pedir(`/api/admin/clientes/${DE_MARIANA}/detalle`, mariana);
  assert.equal(propio.status, 200);

  const ajeno = await pedir(`/api/admin/clientes/${DE_PABLO}/detalle`, mariana);
  assert.equal(ajeno.status, 403);
  assert.match((await ajeno.json()).error, /cartera/i);
});

test('los recordatorios que ve el vendedor son solo de su cartera', async () => {
  const { recordatorios } = await (await pedir('/api/admin/recordatorios?dias=3650', mariana)).json();
  assert.deepEqual(recordatorios.map((r) => r.numero_poliza), ['ASE-A']);

  const todos = await (await pedir('/api/admin/recordatorios?dias=3650', admin)).json();
  assert.equal(todos.recordatorios.length, 2);
});

/* --- Lo que puede capturar --- */

test('el vendedor captura proyectos y fianzas en su cartera', async () => {
  const proyecto = await pedir('/api/admin/proyectos', mariana, {
    method: 'POST',
    body: json({ client_id: DE_MARIANA, nombre: 'Obra nueva de A' }),
  });
  assert.equal(proyecto.status, 200);

  const fianza = await pedir('/api/admin/fianzas', mariana, {
    method: 'POST',
    body: json({
      client_id: DE_MARIANA,
      proyecto_id: (await proyecto.json()).id,
      afianzadora_id: 1,
      numero_poliza: 'ASE-NUEVA',
      tipo_fianza_id: 2,
      prima_neta: 100000,
      prima_total: 122000,
      monto_afianzado: 5000000,
    }),
  });
  assert.equal(fianza.status, 200, 'el vendedor debe poder dar de alta la póliza');
});

test('el vendedor NO captura sobre un cliente ajeno', async () => {
  const proyecto = await pedir('/api/admin/proyectos', mariana, {
    method: 'POST',
    body: json({ client_id: DE_PABLO, nombre: 'Obra que no le toca' }),
  });
  assert.equal(proyecto.status, 403);

  const fianza = await pedir('/api/admin/fianzas', mariana, {
    method: 'POST',
    body: json({
      client_id: DE_PABLO, proyecto_id: 2, afianzadora_id: 1,
      numero_poliza: 'ASE-ROBADA', tipo_fianza_id: 2, monto_afianzado: 1,
    }),
  });
  assert.equal(fianza.status, 403);
});

test('el vendedor no edita ni borra la póliza de un cliente ajeno', async () => {
  const editar = await pedir('/api/admin/fianzas/2', mariana, {
    method: 'PUT', body: json({ numero_poliza: 'CAMBIADA' }),
  });
  assert.equal(editar.status, 403);

  const borrar = await pedir('/api/admin/fianzas/2', mariana, { method: 'DELETE' });
  assert.equal(borrar.status, 403);

  // Y la póliza sigue como estaba.
  const f = await memoria.prepare('SELECT numero_poliza FROM fianzas WHERE id = 2').get();
  assert.equal(f.numero_poliza, 'ASE-B');
});

test('el vendedor no borra documentos de un cliente ajeno', async () => {
  const res = await pedir('/api/admin/documentos/2', mariana, { method: 'DELETE' });
  assert.equal(res.status, 403);

  const { total } = await memoria
    .prepare('SELECT COUNT(*)::int AS total FROM documentos WHERE id = 2').get();
  assert.equal(total, 1, 'el documento del otro fiado debió quedarse');
});

test('la descarga comprueba de quién es el archivo, no solo que sea una URL', async () => {
  const ruta = (url) => `/api/admin/descargar?path=${encodeURIComponent(url)}`;

  const propio = await pedir(ruta('https://res.cloudinary.com/fx/raw/upload/v1/a.pdf'), mariana);
  assert.equal(propio.status, 302);

  const ajeno = await pedir(ruta('https://res.cloudinary.com/fx/raw/upload/v1/b.pdf'), mariana);
  assert.equal(ajeno.status, 403, 'con la URL de otro fiado no debe bajar nada');

  // Y ya no sirve de trampolín hacia cualquier sitio.
  const fuera = await pedir(ruta('https://ejemplo.com/lo-que-sea.pdf'), admin);
  assert.equal(fuera.status, 404);
});

/* --- Lo que es solo de Home Office --- */

test('el vendedor no da de alta clientes ni mueve líneas de crédito', async () => {
  const cliente = await pedir('/api/admin/clientes', mariana, {
    method: 'POST',
    body: json({ razon_social: 'Inventada SA', email: 'x@y.mx', password: 'contrasena8' }),
  });
  assert.equal(cliente.status, 403);

  const linea = await pedir(`/api/admin/clientes/${DE_MARIANA}/lineas`, mariana, {
    method: 'PUT', body: json({ afianzadora_id: 1, linea_credito: 999999999 }),
  });
  assert.equal(linea.status, 403, 'la línea es riesgo de la casa, no del vendedor');
});

test('el vendedor no cambia los catálogos que ven todos los fiados', async () => {
  const tipo = await pedir('/api/admin/tipos-fianza', mariana, {
    method: 'POST', body: json({ nombre: 'Tipo inventado' }),
  });
  assert.equal(tipo.status, 403);

  const requerido = await pedir('/api/admin/documentos-requeridos', mariana, {
    method: 'POST', body: json({ nombre: 'Papel inventado' }),
  });
  assert.equal(requerido.status, 403);

  // Consultarlos sí puede: los necesita para capturar.
  assert.equal((await pedir('/api/admin/tipos-fianza', mariana)).status, 200);
  assert.equal((await pedir('/api/admin/afianzadoras', mariana)).status, 200);
});

test('el vendedor no da de alta usuarios ni reasigna carteras', async () => {
  const usuario = await pedir('/api/admin/usuarios', mariana, {
    method: 'POST',
    body: json({ nombre: 'Cómplice', email: 'complice@fortex.mx', password: 'contrasena8', role: 'vendedor' }),
  });
  assert.equal(usuario.status, 403);

  const cartera = await pedir(`/api/admin/clientes/${DE_PABLO}/vendedor`, mariana, {
    method: 'PUT', body: json({ vendedor_id: 2 }),
  });
  assert.equal(cartera.status, 403, 'nadie se asigna clientes a sí mismo');
});

/* --- Las dos puertas no se cruzan --- */

test('un usuario de fiado no entra al panel de Fortex', async () => {
  const res = await pedir('/api/admin/clientes', ana);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /cuenta de Fortex/i);
});

test('el personal de Fortex no entra al portal del fiado', async () => {
  // Sin esto sus consultas saldrían vacías y parecería que el fiado no tiene
  // nada, en vez de decir que se equivocaron de pantalla.
  for (const token of [admin, mariana]) {
    const res = await pedir('/api/dashboard', token);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /para usuarios de un fiado/i);
  }
});

test('sin sesión no se llega a ninguna de las dos', async () => {
  for (const ruta of ['/api/admin/clientes', '/api/dashboard', '/api/fianzas']) {
    const res = await fetch(`${base}${ruta}`);
    assert.equal(res.status, 401, ruta);
  }
});
