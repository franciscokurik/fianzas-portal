// La subida directa: el navegador manda el archivo a Cloudinary, no a nosotros.
//
// Eso mueve la frontera de confianza, así que lo que se cuida aquí es que la
// firma no se dé a quien no le toca y que al registrar no se le crea al
// navegador: el public_id tiene que caer bajo la carpeta del fiado correcto.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { baseEnMemoria } from './ayuda/pg-memoria.js';

process.env.DATABASE_URL ??= 'postgres://noop';
process.env.JWT_SECRET = 'secreto-de-prueba';
// Credenciales de mentiras: alcanzan para firmar (la firma se calcula aquí) y
// hacen que consultar el archivo falle, que es justo lo que se quiere probar.
process.env.CLOUDINARY_CLOUD_NAME = 'cuenta-de-prueba';
process.env.CLOUDINARY_API_KEY = '123456789012345';
process.env.CLOUDINARY_API_SECRET = 'secreto-de-prueba';
delete process.env.CLOUDINARY_URL;

const { default: db } = await import('../src/db.js');
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

const { default: app } = await import('../src/app.js');
const { signToken } = await import('../src/auth/middleware.js');
const { inicializar } = await import('../src/migrations.js');
const { prefijoDe } = await import('../src/lib/upload.js');

let servidor;
let base;
let admin;
let carlos;  // vendedor, solo lleva la empresa B
let ana;     // del fiado A

const [EMPRESA_A, EMPRESA_B] = [1, 2];

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social) VALUES ('Constructora A'), ('Constructora B');
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Francisco', 'francisco@fortex.mx', 'x', 'admin'),
      (NULL, 'Carlos',    'carlos@fortex.mx',    'x', 'vendedor'),
      (1,    'Ana',       'ana@a.mx',            'x', 'client');
    UPDATE clients SET vendedor_id = 2 WHERE id = 2;

    -- Hace falta uno real: el tipo se valida ANTES de mirar el archivo, y sin
    -- esto las pruebas de abajo se quedarían en ese 404 sin llegar a lo suyo.
    INSERT INTO document_types (nombre, slug, alerta_dias, orden)
      VALUES ('Acta constitutiva', 'acta', 30, 1);
  `);

  admin = signToken({ id: 1, role: 'admin', nombre: 'Francisco' });
  carlos = signToken({ id: 2, role: 'vendedor', nombre: 'Carlos' });
  ana = signToken({ id: 3, role: 'client', client_id: EMPRESA_A, nombre: 'Ana' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const firmar = (token, cuerpo) =>
  fetch(`${base}/api/subidas/firma`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

/* --- A quién se le firma --- */

test('la firma apunta a Cloudinary y no expone el secreto', async () => {
  const res = await firmar(ana, { client_id: EMPRESA_A, nombre: 'acta.pdf' });
  assert.equal(res.status, 200);

  const f = await res.json();
  assert.match(f.subir_a, /^https:\/\/api\.cloudinary\.com\/v1_1\/.+\/raw\/upload$/);
  assert.ok(f.campos.signature, 'debe venir la firma');
  assert.ok(f.campos.api_key, 'la api_key sí viaja: es pública');

  // El secreto NUNCA sale de aquí.
  const todo = JSON.stringify(f);
  assert.ok(!todo.includes(process.env.CLOUDINARY_API_SECRET), 'el api_secret no debe viajar al navegador');

  // Y la firma es de UNA ruta concreta, no un permiso general para escribir.
  assert.ok(f.public_id.startsWith(prefijoDe(EMPRESA_A)));
  assert.equal(f.campos.public_id, f.public_id);
});

test('el fiado no consigue firma para otra empresa', async () => {
  const res = await firmar(ana, { client_id: EMPRESA_B, nombre: 'x.pdf' });
  assert.equal(res.status, 403);
});

test('el vendedor solo consigue firma para su cartera', async () => {
  assert.equal((await firmar(carlos, { client_id: EMPRESA_B, nombre: 'x.pdf' })).status, 200);

  const ajeno = await firmar(carlos, { client_id: EMPRESA_A, nombre: 'x.pdf' });
  assert.equal(ajeno.status, 403);
});

test('el formato se revisa al firmar, no después de subir ocho megas', async () => {
  const res = await firmar(admin, { client_id: EMPRESA_A, nombre: 'video.mp4', mime: 'video/mp4' });

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no permitido/i);
});

test('sin sesión no hay firma', async () => {
  const res = await fetch(`${base}/api/subidas/firma`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: EMPRESA_A }),
  });
  assert.equal(res.status, 401);
});

/* --- Al registrar no se le cree al navegador --- */

test('un public_id de otro cliente no se puede colgar del propio', async () => {
  // El caso que esto cierra: pedir una firma legítima para tu empresa y luego
  // intentar registrar un archivo que vive bajo la carpeta de otra.
  const res = await fetch(`${base}/api/documentos/1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ana}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_id: `${prefijoDe(EMPRESA_B)}999_robado.pdf`, nombre: 'robado.pdf' }),
  });

  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /no corresponde a este cliente/i);
});

test('un public_id inventado bajo el propio prefijo tampoco pasa', async () => {
  // Aunque la ruta sea la correcta, el archivo tiene que existir en Cloudinary:
  // la URL y el peso los da Cloudinary, no el navegador.
  const res = await fetch(`${base}/api/documentos/1`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ana}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ public_id: `${prefijoDe(EMPRESA_A)}999_inventado.pdf`, nombre: 'x.pdf' }),
  });

  assert.notEqual(res.status, 200, 'no debe registrarse un archivo que no existe');

  const { total } = await memoria
    .prepare('SELECT COUNT(*)::int AS total FROM client_documents').get();
  assert.equal(total, 0);
});
