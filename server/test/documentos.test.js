// Documentos colgados de proyectos (contrato) y fianzas (carátula).
// Lo que más importa: que un fiado no pueda bajar los papeles de otro
// cambiando el id en la URL.
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
let tokenA;
let tokenB;

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social) VALUES ('Empresa A'), ('Empresa B');
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (1, 'Ana',  'a@demo.mx', 'x', 'client'),
      (2, 'Beto', 'b@demo.mx', 'x', 'client'),
      (NULL, 'Fortex', 'admin@fortex.mx', 'x', 'admin');
    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta','aserta');
    INSERT INTO proyectos (client_id, nombre, monto_contrato) VALUES
      (1, 'Obra de A', 100000000),
      (2, 'Obra de B', 100000000);
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                         tipo_fianza_id, monto_afianzado)
      VALUES (1, 1, 1, 'ASE-A', (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 5000000),
             (2, 2, 1, 'ASE-B', (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 5000000);

    INSERT INTO documentos (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo)
      VALUES (1, 'proyecto', 1, 'contrato', 'https://blob.test/contrato-A.pdf', 'contrato-A.pdf'),
             (1, 'fianza',   1, 'caratula', 'https://blob.test/caratula-A.pdf', 'caratula-A.pdf'),
             (2, 'fianza',   2, 'caratula', 'https://blob.test/caratula-B.pdf', 'caratula-B.pdf');
  `);

  tokenA = signToken({ id: 1, role: 'client', client_id: 1, nombre: 'Ana' });
  tokenB = signToken({ id: 2, role: 'client', client_id: 2, nombre: 'Beto' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const pedir = (ruta, token) =>
  fetch(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });

test('el fiado ve la carátula de su fianza y el contrato de su obra', async () => {
  const res = await pedir('/api/fianzas', tokenA);
  assert.equal(res.status, 200);

  const { fianzas } = await res.json();
  assert.equal(fianzas.length, 1);
  assert.equal(fianzas[0].documentos.length, 1);
  assert.equal(fianzas[0].documentos[0].tipo_doc_nombre, 'Carátula de la fianza');
  assert.equal(fianzas[0].documentos_proyecto[0].tipo_doc_nombre, 'Contrato de obra');
});

test('la URL del blob no se expone al fiado', async () => {
  const { fianzas } = await (await pedir('/api/fianzas', tokenA)).json();
  const doc = fianzas[0].documentos[0];

  assert.equal(doc.url, undefined, 'la URL directa del archivo no debe viajar al navegador');
  assert.ok(doc.id, 'debe venir el id para pedirlo por la API');
});

test('descargar un documento propio redirige al archivo', async () => {
  const res = await pedir('/api/fianzas/documentos/2', tokenA);

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://blob.test/caratula-A.pdf');
});

test('un fiado NO puede descargar el documento de otro', async () => {
  // El documento 3 es de la Empresa B; lo pide la Empresa A.
  const res = await pedir('/api/fianzas/documentos/3', tokenA);

  assert.equal(res.status, 404);
  assert.notEqual(res.headers.get('location'), 'https://blob.test/caratula-B.pdf');
});

test('sin sesión no se descarga nada', async () => {
  const res = await fetch(`${base}/api/fianzas/documentos/2`, { redirect: 'manual' });
  assert.equal(res.status, 401);
});

test('el detalle del admin trae los documentos repartidos por entidad', async () => {
  const admin = signToken({ id: 99, role: 'admin', razon_social: 'Fortex' });
  const res = await pedir('/api/admin/clientes/1/detalle', admin);
  assert.equal(res.status, 200);

  const { proyectos } = await res.json();
  assert.equal(proyectos[0].documentos.length, 1, 'el contrato va en el proyecto');
  assert.equal(proyectos[0].documentos[0].tipo_doc, 'contrato');
  assert.equal(proyectos[0].fianzas[0].documentos.length, 1, 'la carátula va en la fianza');
  assert.equal(proyectos[0].fianzas[0].documentos[0].tipo_doc, 'caratula');
});

test('no se admite un tipo de documento que no exista para esa entidad', async () => {
  const admin = signToken({ id: 99, role: 'admin', razon_social: 'Fortex' });
  const datos = new FormData();
  datos.append('archivo', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'x.pdf');
  datos.append('tipo_doc', 'caratula'); // 'caratula' es de fianza, no de proyecto

  const res = await fetch(`${base}/api/admin/proyectos/1/documentos`, {
    method: 'POST', headers: { Authorization: `Bearer ${admin}` }, body: datos,
  });

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no válido/i);
});

test('borrar una fianza se lleva sus documentos', async () => {
  const admin = signToken({ id: 99, role: 'admin', razon_social: 'Fortex' });
  const res = await fetch(`${base}/api/admin/fianzas/2`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${admin}` },
  });
  assert.equal(res.status, 200);

  const quedan = await memoria.prepare(
    `SELECT COUNT(*)::int AS total FROM documentos WHERE entidad_tipo = 'fianza' AND entidad_id = 2`
  ).get();
  assert.equal(quedan.total, 0, 'quedaron documentos huérfanos apuntando a una fianza borrada');
});
