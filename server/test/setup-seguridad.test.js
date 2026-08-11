// /api/setup puede borrar la base. Si SETUP_KEY no está configurada en el
// entorno, el endpoint queda expuesto a internet, así que las operaciones
// destructivas deben negarse en vez de correr.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { baseEnMemoria } from './ayuda/pg-memoria.js';

process.env.DATABASE_URL ??= 'postgres://noop';
delete process.env.SETUP_KEY;

const { default: db } = await import('../src/db.js');
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

const { default: app } = await import('../src/app.js');
const { inicializar } = await import('../src/migrations.js');

let servidor;
let base;

before(async () => {
  await inicializar(memoria);
  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

beforeEach(async () => {
  await memoria.query(`DELETE FROM fianzas`);
  await memoria.query(`DELETE FROM proyectos`);
  await memoria.query(`DELETE FROM clients`);
  await memoria.query(`DELETE FROM users`);
  await memoria.exec(`
    INSERT INTO clients (razon_social) VALUES ('GASPE'), ('Otra SA');
    -- El id se busca en vez de escribirlo: este bloque corre antes de cada
    -- prueba y la secuencia no se reinicia, así que en la segunda vuelta las
    -- empresas ya no son la 1 y la 2.
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Administración', 'admin@fortex.mx', 'hash', 'admin'),
      ((SELECT id FROM clients WHERE razon_social = 'GASPE'),
       'Isidro', 'isidro@gaspe.mx', 'x', 'client');
  `);
});

const pedir = (qs) => fetch(`${base}/api/setup${qs}`);
const cuantosClientes = async () =>
  (await memoria.prepare('SELECT COUNT(*)::int AS total FROM clients').get()).total;

test('sin SETUP_KEY, el reinicio en blanco se niega y no borra nada', async () => {
  delete process.env.SETUP_KEY;
  const res = await pedir('?reiniciar=vacio&confirmar=BORRAR');

  assert.equal(res.status, 403);
  const cuerpo = await res.json();
  assert.match(cuerpo.error, /SETUP_KEY/);
  assert.equal(await cuantosClientes(), 2, 'no debió borrar ningún cliente');
});

test('sin SETUP_KEY, force=1 también se niega', async () => {
  delete process.env.SETUP_KEY;
  const res = await pedir('?force=1');

  assert.equal(res.status, 403);
  assert.equal(await cuantosClientes(), 2);
});

test('sin SETUP_KEY, el setup normal sí corre (no borra nada)', async () => {
  delete process.env.SETUP_KEY;
  const res = await pedir('');

  assert.equal(res.status, 200);
  const cuerpo = await res.json();
  assert.equal(cuerpo.ok, true);
  assert.equal(cuerpo.seeded, false, 'con datos existentes no debe sembrar demo');
  assert.equal(await cuantosClientes(), 2);
});

test('con SETUP_KEY, una clave equivocada no pasa', async () => {
  process.env.SETUP_KEY = 'la-buena';
  const res = await pedir('?key=la-mala&reiniciar=vacio&confirmar=BORRAR');

  assert.equal(res.status, 403);
  assert.equal(await cuantosClientes(), 2);
});

test('con SETUP_KEY correcta pero sin confirmar, no borra', async () => {
  process.env.SETUP_KEY = 'la-buena';
  const res = await pedir('?key=la-buena&reiniciar=vacio');

  assert.equal(res.status, 400);
  const cuerpo = await res.json();
  assert.match(cuerpo.error, /confirmar/i);
  assert.equal(await cuantosClientes(), 2, 'sin confirmar no se toca la base');
});

test('con SETUP_KEY correcta y confirmación, sí borra y conserva al admin', async () => {
  process.env.SETUP_KEY = 'la-buena';
  const res = await pedir('?key=la-buena&reiniciar=vacio&confirmar=BORRAR');

  assert.equal(res.status, 200);
  const cuerpo = await res.json();
  assert.equal(cuerpo.borrado.clientes, 2);
  assert.equal(cuerpo.borrado.admins_conservados, 1);
  // Las empresas se van todas: el admin ya no vive en esa tabla, es un usuario.
  assert.equal(await cuantosClientes(), 0);

  const { total } = await memoria
    .prepare(`SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin'`).get();
  assert.equal(total, 1, 'la cuenta de administrador debe seguir ahí');
});
