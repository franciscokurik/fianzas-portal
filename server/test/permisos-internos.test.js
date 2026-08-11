// Tres niveles internos, de menos a más permiso. Esto no prueba una comodidad
// de la pantalla: por estas rutas pasan los estados financieros y las pólizas de
// terceros, y esconder un botón no impide cambiar el id en la URL.
//
//   VENDEDOR -> solo los clientes que tenga asignados, y solo sobre ellos.
//   OPERADOR -> todos los clientes; toda la operación.
//   ADMIN    -> lo del operador, más cuentas de acceso y baja de empresas.
//
// Y las dos puertas no se cruzan: la gente del fiado no entra al panel, y el
// personal de Fortex no entra al portal del fiado.
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
let admin;    // id 1, y además atiende la empresa C
let luisa;    // id 2, operadora
let carlos;   // id 3, vendedor; atiende la empresa B
let ana;      // id 4, del fiado A

// A no tiene responsable, B es de Carlos, C es del propio admin.
const [EMPRESA_A, EMPRESA_B, EMPRESA_C] = [1, 2, 3];

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social, rfc) VALUES
      ('Constructora A', 'AAA010101AAA'),
      ('Constructora B', 'BBB010101BBB'),
      ('Constructora C', 'CCC010101CCC');

    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Francisco', 'francisco@fortex.mx', 'x', 'admin'),
      (NULL, 'Luisa',     'luisa@fortex.mx',     'x', 'operador'),
      (NULL, 'Carlos',    'carlos@fortex.mx',    'x', 'vendedor'),
      (1,    'Ana',       'ana@constructora-a.mx', 'x', 'client');

    -- La cartera puede apuntar a cualquier cuenta interna: el admin también
    -- lleva clientes.
    UPDATE clients SET vendedor_id = 3 WHERE id = 2;
    UPDATE clients SET vendedor_id = 1 WHERE id = 3;

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

  admin = signToken({ id: 1, role: 'admin', nombre: 'Francisco' });
  luisa = signToken({ id: 2, role: 'operador', nombre: 'Luisa' });
  carlos = signToken({ id: 3, role: 'vendedor', nombre: 'Carlos' });
  ana = signToken({ id: 4, role: 'client', client_id: EMPRESA_A, nombre: 'Ana' });

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

/* --- Qué ve cada nivel --- */

test('el vendedor solo ve los clientes de su cartera', async () => {
  const { clientes } = await (await pedir('/api/admin/clientes', carlos)).json();
  assert.deepEqual(clientes.map((c) => c.razon_social), ['Constructora B']);
});

test('el operador y el admin ven a todos, incluso lo no asignado', async () => {
  for (const token of [luisa, admin]) {
    const { clientes } = await (await pedir('/api/admin/clientes', token)).json();
    assert.equal(clientes.length, 3);
  }
});

test('un cliente que atiende el admin no se le aparece al vendedor', async () => {
  // La cartera del admin es tan suya como la del vendedor: no se comparte.
  const { clientes } = await (await pedir('/api/admin/clientes', carlos)).json();
  assert.ok(!clientes.some((c) => c.id === EMPRESA_C));

  const res = await pedir(`/api/admin/clientes/${EMPRESA_C}/detalle`, carlos);
  assert.equal(res.status, 403);
});

test('el vendedor no abre el detalle de un cliente ajeno', async () => {
  assert.equal((await pedir(`/api/admin/clientes/${EMPRESA_B}/detalle`, carlos)).status, 200);

  const ajeno = await pedir(`/api/admin/clientes/${EMPRESA_A}/detalle`, carlos);
  assert.equal(ajeno.status, 403);
  assert.match((await ajeno.json()).error, /cartera/i);
});

test('los recordatorios del vendedor son solo de su cartera', async () => {
  const { recordatorios } = await (await pedir('/api/admin/recordatorios?dias=3650', carlos)).json();
  assert.deepEqual(recordatorios.map((r) => r.numero_poliza), ['ASE-B']);

  const todos = await (await pedir('/api/admin/recordatorios?dias=3650', luisa)).json();
  assert.equal(todos.recordatorios.length, 2);
});

/* --- Qué captura el vendedor: lo suyo, y nada más --- */

test('el vendedor captura sobre los clientes de su cartera', async () => {
  const proyecto = await pedir('/api/admin/proyectos', carlos, {
    method: 'POST', body: json({ client_id: EMPRESA_B, nombre: 'Obra nueva de B' }),
  });
  assert.equal(proyecto.status, 200);

  const fianza = await pedir('/api/admin/fianzas', carlos, {
    method: 'POST',
    body: json({
      client_id: EMPRESA_B,
      proyecto_id: (await proyecto.json()).id,
      afianzadora_id: 1,
      numero_poliza: 'ASE-DE-CARLOS',
      tipo_fianza_id: 2,
      prima_neta: 100000,
      prima_total: 122000,
      monto_afianzado: 5000000,
    }),
  });
  assert.equal(fianza.status, 200);
});

test('el vendedor NO captura sobre un cliente ajeno', async () => {
  const proyecto = await pedir('/api/admin/proyectos', carlos, {
    method: 'POST', body: json({ client_id: EMPRESA_A, nombre: 'Obra que no le toca' }),
  });
  assert.equal(proyecto.status, 403);

  const editar = await pedir('/api/admin/fianzas/1', carlos, {
    method: 'PUT', body: json({ numero_poliza: 'CAMBIADA' }),
  });
  assert.equal(editar.status, 403);

  const borrarDoc = await pedir('/api/admin/documentos/1', carlos, { method: 'DELETE' });
  assert.equal(borrarDoc.status, 403);

  const f = await memoria.prepare('SELECT numero_poliza FROM fianzas WHERE id = 1').get();
  assert.equal(f.numero_poliza, 'ASE-A', 'la póliza ajena debió quedar intacta');
});

test('la descarga comprueba de quién es el archivo', async () => {
  const ruta = (url) => `/api/admin/descargar?path=${encodeURIComponent(url)}`;

  const propio = await pedir(ruta('https://res.cloudinary.com/fx/raw/upload/v1/b.pdf'), carlos);
  assert.equal(propio.status, 302);

  const ajeno = await pedir(ruta('https://res.cloudinary.com/fx/raw/upload/v1/a.pdf'), carlos);
  assert.equal(ajeno.status, 403, 'con la URL de otro fiado no debe bajar nada');

  const fuera = await pedir(ruta('https://ejemplo.com/lo-que-sea.pdf'), admin);
  assert.equal(fuera.status, 404, 'ni sirve de trampolín hacia cualquier sitio');
});

/* --- Lo que es de la casa: fuera del vendedor --- */

test('el vendedor no da de alta clientes ni los reasigna', async () => {
  const alta = await pedir('/api/admin/clientes', carlos, {
    method: 'POST',
    body: json({ razon_social: 'Inventada SA', email: 'x@y.mx', password: 'contrasena8' }),
  });
  assert.equal(alta.status, 403);

  const reasignar = await pedir(`/api/admin/clientes/${EMPRESA_A}/vendedor`, carlos, {
    method: 'PUT', body: json({ vendedor_id: 3 }),
  });
  assert.equal(reasignar.status, 403, 'nadie se agrega clientes a su propia cartera');
});

test('el vendedor no mueve líneas de crédito, ni las de su cartera', async () => {
  const res = await pedir(`/api/admin/clientes/${EMPRESA_B}/lineas`, carlos, {
    method: 'PUT', body: json({ afianzadora_id: 1, linea_credito: 999999999 }),
  });
  assert.equal(res.status, 403, 'la línea es el riesgo de la casa, no del vendedor');
});

test('el vendedor no cambia los catálogos que ven todos los fiados', async () => {
  for (const [ruta, cuerpo] of [
    ['/api/admin/tipos-fianza', { nombre: 'Tipo inventado' }],
    ['/api/admin/afianzadoras', { nombre: 'Afianzadora inventada' }],
    ['/api/admin/documentos-requeridos', { nombre: 'Papel inventado' }],
  ]) {
    const res = await pedir(ruta, carlos, { method: 'POST', body: json(cuerpo) });
    assert.equal(res.status, 403, ruta);
  }

  // Consultarlos sí puede: los necesita para capturar.
  assert.equal((await pedir('/api/admin/tipos-fianza', carlos)).status, 200);
  assert.equal((await pedir('/api/admin/afianzadoras', carlos)).status, 200);
  assert.equal((await pedir('/api/admin/tipos-documento', carlos)).status, 200);
});

/* --- Qué puede el operador y qué no --- */

test('el operador hace toda la operación sobre cualquier cliente', async () => {
  const alta = await pedir('/api/admin/clientes', luisa, {
    method: 'POST',
    body: json({
      razon_social: 'Constructora D', rfc: 'DDD010101DDD',
      email: 'director@constructora-d.mx', password: 'contrasena8',
    }),
  });
  assert.equal(alta.status, 200);

  const linea = await pedir(`/api/admin/clientes/${EMPRESA_A}/lineas`, luisa, {
    method: 'PUT', body: json({ afianzadora_id: 1, linea_credito: 500000000 }),
  });
  assert.equal(linea.status, 200);

  const catalogo = await pedir('/api/admin/tipos-fianza', luisa, {
    method: 'POST', body: json({ nombre: 'Fianza de garantía' }),
  });
  assert.equal(catalogo.status, 200);
});

test('el operador no maneja cuentas de acceso ni da de baja empresas', async () => {
  const crear = await pedir('/api/admin/usuarios', luisa, {
    method: 'POST',
    body: json({ nombre: 'Cómplice', email: 'complice@fortex.mx', password: 'contrasena8', role: 'admin' }),
  });
  assert.equal(crear.status, 403);

  const baja = await pedir(`/api/admin/clientes/${EMPRESA_A}`, luisa, {
    method: 'DELETE', body: json({ confirmar: 'Constructora A' }),
  });
  assert.equal(baja.status, 403);
});

test('el vendedor tampoco maneja cuentas de acceso', async () => {
  const res = await pedir('/api/admin/usuarios/1', carlos, {
    method: 'PUT', body: json({ password: 'me-robo-la-cuenta-8' }),
  });
  assert.equal(res.status, 403);
});

/* --- Las dos puertas no se cruzan --- */

test('un usuario de fiado no entra al panel de Fortex', async () => {
  const res = await pedir('/api/admin/clientes', ana);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /cuenta de Fortex/i);
});

test('el personal de Fortex no entra al portal del fiado', async () => {
  for (const token of [admin, luisa, carlos]) {
    const res = await pedir('/api/dashboard', token);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /para usuarios de un fiado/i);
  }
});

test('sin sesión no se llega a ninguna de las dos', async () => {
  for (const ruta of ['/api/admin/clientes', '/api/dashboard', '/api/fianzas']) {
    assert.equal((await fetch(`${base}${ruta}`)).status, 401, ruta);
  }
});
