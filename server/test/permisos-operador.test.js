// Solo hay dos roles internos y la diferencia es corta, así que conviene
// tenerla clavada con pruebas: el OPERADOR hace toda la operación sobre todos
// los fiados; el ADMIN además maneja las cuentas de acceso y puede dar de baja
// empresas completas.
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
let admin;
let luisa;
let ana;

const [EMPRESA_A, EMPRESA_B] = [1, 2];

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social, rfc) VALUES
      ('Constructora A', 'AAA010101AAA'),
      ('Constructora B', 'BBB010101BBB');

    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Francisco', 'francisco@fortex.mx', 'x', 'admin'),
      (NULL, 'Luisa',     'luisa@fortex.mx',     'x', 'operador'),
      (1,    'Ana',       'ana@constructora-a.mx', 'x', 'client');

    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta', 'aserta');
    INSERT INTO proyectos (client_id, nombre, monto_contrato) VALUES
      (1, 'Obra de A', 100000000),
      (2, 'Obra de B', 100000000);
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                         tipo_fianza_id, monto_afianzado, fecha_recordatorio)
      VALUES (1, 1, 1, 'ASE-A', (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 5000000, '2026-08-11'),
             (2, 2, 1, 'ASE-B', (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 5000000, '2026-08-11');
    INSERT INTO documentos (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo)
      VALUES (1, 'fianza', 1, 'caratula', 'https://res.cloudinary.com/fx/raw/upload/v1/a.pdf', 'a.pdf');
  `);

  admin = signToken({ id: 1, role: 'admin', nombre: 'Francisco' });
  luisa = signToken({ id: 2, role: 'operador', nombre: 'Luisa' });
  ana = signToken({ id: 3, role: 'client', client_id: EMPRESA_A, nombre: 'Ana' });

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

/* --- Lo que el operador SÍ hace --- */

test('el operador ve a todos los clientes, no a un subconjunto', async () => {
  const { clientes } = await (await pedir('/api/admin/clientes', luisa)).json();
  assert.deepEqual(clientes.map((c) => c.razon_social), ['Constructora A', 'Constructora B']);

  const delAdmin = await (await pedir('/api/admin/clientes', admin)).json();
  assert.equal(delAdmin.clientes.length, clientes.length, 'admin y operador ven lo mismo');
});

test('el operador abre el detalle de cualquier cliente', async () => {
  for (const id of [EMPRESA_A, EMPRESA_B]) {
    assert.equal((await pedir(`/api/admin/clientes/${id}/detalle`, luisa)).status, 200);
  }
});

test('el operador ve todos los recordatorios', async () => {
  const { recordatorios } = await (await pedir('/api/admin/recordatorios?dias=3650', luisa)).json();
  assert.deepEqual(recordatorios.map((r) => r.numero_poliza).sort(), ['ASE-A', 'ASE-B']);
});

test('el operador da de alta un cliente con su primer acceso', async () => {
  const res = await pedir('/api/admin/clientes', luisa, {
    method: 'POST',
    body: json({
      razon_social: 'Constructora C', rfc: 'CCC010101CCC',
      email: 'director@constructora-c.mx', password: 'contrasena8',
    }),
  });
  assert.equal(res.status, 200, 'es lo que el vendedor no podía y el operador sí');

  const { clientes } = await (await pedir('/api/admin/clientes', luisa)).json();
  assert.ok(clientes.some((c) => c.razon_social === 'Constructora C'));
});

test('el operador captura proyectos y pólizas de cualquier cliente', async () => {
  const proyecto = await pedir('/api/admin/proyectos', luisa, {
    method: 'POST', body: json({ client_id: EMPRESA_B, nombre: 'Obra nueva de B' }),
  });
  assert.equal(proyecto.status, 200);

  const fianza = await pedir('/api/admin/fianzas', luisa, {
    method: 'POST',
    body: json({
      client_id: EMPRESA_B,
      proyecto_id: (await proyecto.json()).id,
      afianzadora_id: 1,
      numero_poliza: 'ASE-NUEVA',
      tipo_fianza_id: 2,
      prima_neta: 100000,
      prima_total: 122000,
      monto_afianzado: 5000000,
    }),
  });
  assert.equal(fianza.status, 200);
});

test('el operador fija las líneas de crédito', async () => {
  const res = await pedir(`/api/admin/clientes/${EMPRESA_A}/lineas`, luisa, {
    method: 'PUT', body: json({ afianzadora_id: 1, linea_credito: 500000000 }),
  });
  assert.equal(res.status, 200);

  const { lineas } = await (await pedir(`/api/admin/clientes/${EMPRESA_A}/detalle`, luisa)).json();
  assert.equal(lineas[0].linea_credito, 500000000);
});

test('el operador mantiene los catálogos que usa para capturar', async () => {
  const tipo = await pedir('/api/admin/tipos-fianza', luisa, {
    method: 'POST', body: json({ nombre: 'Fianza de garantía' }),
  });
  assert.equal(tipo.status, 200, 'si no puede agregarla, se atora capturando la póliza');

  const afianzadora = await pedir('/api/admin/afianzadoras', luisa, {
    method: 'POST', body: json({ nombre: 'Zurich' }),
  });
  assert.equal(afianzadora.status, 200);

  const requerido = await pedir('/api/admin/documentos-requeridos', luisa, {
    method: 'POST', body: json({ nombre: 'Balance parcial' }),
  });
  assert.equal(requerido.status, 200);
});

test('el operador anota quién atiende a un cliente', async () => {
  const res = await pedir(`/api/admin/clientes/${EMPRESA_B}/vendedor`, luisa, {
    method: 'PUT', body: json({ vendedor_id: 2 }),
  });
  assert.equal(res.status, 200);

  // Y eso NO acota nada: el campo es informativo, sigue viendo todo.
  const { clientes } = await (await pedir('/api/admin/clientes', luisa)).json();
  assert.ok(clientes.length >= 3, 'anotar un responsable no debe esconderle los demás');
});

/* --- Lo que queda solo para el admin --- */

test('el operador no maneja las cuentas de acceso', async () => {
  const crear = await pedir('/api/admin/usuarios', luisa, {
    method: 'POST',
    body: json({ nombre: 'Cómplice', email: 'complice@fortex.mx', password: 'contrasena8', role: 'admin' }),
  });
  assert.equal(crear.status, 403, 'nadie se crea compañeros de trabajo con permisos');

  const editar = await pedir('/api/admin/usuarios/1', luisa, {
    method: 'PUT', body: json({ password: 'me-robo-la-cuenta-8' }),
  });
  assert.equal(editar.status, 403, 'menos todavía reponerle la contraseña al admin');

  const borrar = await pedir('/api/admin/usuarios/1/permanente', luisa, { method: 'DELETE' });
  assert.equal(borrar.status, 403);
});

test('el operador no da de baja una empresa', async () => {
  const res = await pedir(`/api/admin/clientes/${EMPRESA_B}`, luisa, {
    method: 'DELETE', body: json({ confirmar: 'Constructora B' }),
  });
  assert.equal(res.status, 403, 'se lleva el historial completo y no tiene deshacer');

  const { total } = await memoria
    .prepare('SELECT COUNT(*)::int AS total FROM clients WHERE id = ?').get(EMPRESA_B);
  assert.equal(total, 1);
});

/* --- La descarga sigue comprobando de dónde sale el archivo --- */

test('la descarga solo sirve para archivos registrados, no como trampolín', async () => {
  const ruta = (url) => `/api/admin/descargar?path=${encodeURIComponent(url)}`;

  const propio = await pedir(ruta('https://res.cloudinary.com/fx/raw/upload/v1/a.pdf'), luisa);
  assert.equal(propio.status, 302);

  const fuera = await pedir(ruta('https://ejemplo.com/lo-que-sea.pdf'), admin);
  assert.equal(fuera.status, 404, 'no debe redirigir a cualquier URL que le pasen');
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
  for (const token of [admin, luisa]) {
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
