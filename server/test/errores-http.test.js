// Reproduce lo que pasó en producción: el código nuevo desplegado contra una
// base a la que todavía no se le corre /api/setup.
//
// Antes, la consulta reventaba dentro de un handler async, Express 4 dejaba la
// promesa sin atender y la petición se quedaba colgada: el panel mostraba "(0)"
// para siempre, como si no hubiera datos. Debe responder con un error claro.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { baseEnMemoria, ESQUEMA_VIEJO } from './ayuda/pg-memoria.js';

// El módulo de rutas importa db.js, que exige DATABASE_URL al construirse.
process.env.DATABASE_URL ??= 'postgres://noop';
process.env.JWT_SECRET = 'secreto-de-prueba';

const { default: db } = await import('../src/db.js');
const { default: app } = await import('../src/app.js');
const { signToken } = await import('../src/auth/middleware.js');

// Base "vieja": existe clients y fianzas, pero NO proyectos ni las columnas
// de recordatorio. Se le presta a db.js su acceso a datos.
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

let servidor;
let base;
let token;

before(async () => {
  await memoria.exec(ESQUEMA_VIEJO);
  await memoria.exec(`
    INSERT INTO clients (razon_social, email, password_hash, role)
      VALUES ('Fortex', 'admin@fortex.mx', 'x', 'admin');
    INSERT INTO clients (razon_social, email, password_hash)
      VALUES ('Constructora Nueva', 'nueva@demo.mx', 'x');
  `);
  token = signToken({ id: 1, role: 'admin', razon_social: 'Fortex' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const pedir = (ruta) =>
  fetch(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });

test('una consulta contra el esquema viejo responde, no se cuelga', async () => {
  // Si la petición se colgara, el timeout del test la mataría.
  const res = await pedir('/api/admin/clientes');
  assert.equal(res.status, 500);

  const cuerpo = await res.json();
  assert.match(cuerpo.error, /api\/setup/,
    'el mensaje debe decir qué hacer, no ser un error genérico');
  assert.ok(cuerpo.code, 'debe venir el código de error de Postgres');
});

test('el catálogo de tipos también falla con mensaje, no con lista vacía', async () => {
  const res = await pedir('/api/admin/tipos-fianza');
  assert.equal(res.status, 500);

  const cuerpo = await res.json();
  // Lo importante: NO devolver { tipos: [] }, que la UI pintaría como "(0)".
  assert.equal(cuerpo.tipos, undefined);
  assert.match(cuerpo.error, /api\/setup/);
});

test('ya migrada, la misma consulta funciona', async () => {
  const { inicializar } = await import('../src/migrations.js');
  await inicializar(memoria);

  const res = await pedir('/api/admin/clientes');
  assert.equal(res.status, 200);

  const { clientes } = await res.json();
  assert.equal(clientes.length, 1, 'solo el cliente, no el admin');
  assert.equal(clientes[0].razon_social, 'Constructora Nueva');
});

test('el catálogo trae los tipos sembrados tras migrar', async () => {
  const res = await pedir('/api/admin/tipos-fianza');
  assert.equal(res.status, 200);

  const { tipos } = await res.json();
  assert.ok(tipos.length >= 10, `se esperaba el catálogo del ramo, llegaron ${tipos.length}`);
  assert.ok(tipos.some((t) => t.nombre === 'Cumplimiento'));
});
