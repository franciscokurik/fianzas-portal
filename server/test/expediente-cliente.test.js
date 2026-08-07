// Expediente del fiado: los papeles que pide la afianzadora (CSF, estados
// financieros…). Los puede subir el fiado desde su portal o Fortex en su
// nombre, y lo que importa es que se sepa quién lo hizo y que un fiado no
// alcance el expediente de otro.
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
let cliente;

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social, email, password_hash, role) VALUES
      ('Fortex', 'admin@fortex.mx', 'x', 'admin'),
      ('Empresa A', 'a@demo.mx', 'x', 'client'),
      ('Empresa B', 'b@demo.mx', 'x', 'client');

    INSERT INTO document_types (nombre, slug, periodicidad_meses, alerta_dias, orden) VALUES
      ('Constancia de Situación Fiscal', 'csf', NULL, 30, 1),
      ('Estados financieros anuales', 'estados-financieros', 12, 60, 2);

    -- Los estados financieros llegaron por correo y los cargó Home Office.
    INSERT INTO client_documents
      (client_id, document_type_id, file_path, original_name, mime_type, size_bytes,
       uploaded_at, vencimiento, subido_por)
      VALUES (2, 2, 'https://res.cloudinary.com/fortex/raw/upload/v1/ef.pdf',
              'ef-2025.pdf', 'application/pdf', 250000, '2026-01-15', '2027-01-15', 'fortex');
  `);

  admin = signToken({ id: 1, role: 'admin', razon_social: 'Fortex' });
  cliente = signToken({ id: 2, role: 'client', razon_social: 'Empresa A' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const pedir = (ruta, token, opciones = {}) =>
  fetch(`${base}${ruta}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${token}`, ...(opciones.headers || {}) },
    redirect: 'manual',
  });

const conArchivo = (nombre = 'ef.pdf') => {
  const datos = new FormData();
  datos.append('archivo', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), nombre);
  return datos;
};

test('el detalle del admin dice quién cargó cada documento', async () => {
  const { documentos } = await (await pedir('/api/admin/clientes/2/detalle', admin)).json();

  const ef = documentos.find((d) => d.nombre === 'Estados financieros anuales');
  assert.equal(ef.subido_por, 'fortex');
  assert.equal(ef.original_name, 'ef-2025.pdf');

  // El que nadie subió sigue apareciendo como pendiente, no desaparece.
  const csf = documentos.find((d) => d.nombre === 'Constancia de Situación Fiscal');
  assert.equal(csf.uploaded_at, null);
});

test('el fiado ve que Fortex ya cargó su documento', async () => {
  const { documentos } = await (await pedir('/api/documentos', cliente)).json();

  const ef = documentos.find((d) => d.slug === 'estados-financieros');
  assert.equal(ef.subido_por, 'fortex');
  assert.equal(ef.has_file, true);
});

test('cargar para un cliente que no existe no llega ni a subir el archivo', async () => {
  const res = await pedir('/api/admin/clientes/999/documentos/1', admin, {
    method: 'POST', body: conArchivo(),
  });

  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /Cliente no encontrado/);
});

test('cargar un tipo de documento que no está en el catálogo se rechaza', async () => {
  const res = await pedir('/api/admin/clientes/2/documentos/999', admin, {
    method: 'POST', body: conArchivo(),
  });

  assert.equal(res.status, 404);
  assert.match((await res.json()).error, /no válido/i);
});

test('sin archivo no se guarda un registro vacío', async () => {
  const res = await pedir('/api/admin/clientes/2/documentos/1', admin, {
    method: 'POST', body: new FormData(),
  });

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /No se recibió archivo/);
});

test('un fiado no puede cargar documentos en el expediente de otro', async () => {
  const res = await pedir('/api/admin/clientes/3/documentos/1', cliente, {
    method: 'POST', body: conArchivo(),
  });

  assert.equal(res.status, 403);
});

test('el admin quita un documento del expediente', async () => {
  const res = await pedir('/api/admin/clientes/2/documentos/2', admin, { method: 'DELETE' });
  assert.equal(res.status, 200);

  const { total } = await memoria
    .prepare('SELECT COUNT(*)::int AS total FROM client_documents WHERE client_id = 2')
    .get();
  assert.equal(total, 0);

  // Volver a borrarlo avisa en vez de responder que sí sin hacer nada.
  const otra = await pedir('/api/admin/clientes/2/documentos/2', admin, { method: 'DELETE' });
  assert.equal(otra.status, 404);
});

test('el admin agrega un documento al catálogo y le aparece a los fiados', async () => {
  const res = await pedir('/api/admin/documentos-requeridos', admin, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nombre: 'Balance parcial 2026', periodicidad_meses: 6, alerta_dias: 45 }),
  });
  assert.equal(res.status, 200);

  const { tipos } = await (await pedir('/api/admin/documentos-requeridos', admin)).json();
  const nuevo = tipos.find((t) => t.nombre === 'Balance parcial 2026');
  assert.equal(nuevo.slug, 'balance-parcial-2026');
  assert.equal(nuevo.periodicidad_meses, 6);
  assert.equal(nuevo.alerta_dias, 45);

  // Y al fiado ya se le pide, sin redesplegar nada.
  const { documentos } = await (await pedir('/api/documentos', cliente)).json();
  assert.ok(documentos.some((d) => d.slug === 'balance-parcial-2026'));

  // Nadie lo ha subido: se puede quitar del catálogo.
  const borrado = await pedir(`/api/admin/documentos-requeridos/${nuevo.id}`, admin, { method: 'DELETE' });
  assert.equal(borrado.status, 200);
});

test('no se quita del catálogo un documento que algún fiado ya cargó', async () => {
  await memoria.exec(`
    INSERT INTO client_documents
      (client_id, document_type_id, file_path, original_name, uploaded_at, subido_por)
      VALUES (3, 1, 'https://res.cloudinary.com/fortex/raw/upload/v1/csf.pdf',
              'csf.pdf', '2026-02-01', 'cliente');
  `);

  const res = await pedir('/api/admin/documentos-requeridos/1', admin, { method: 'DELETE' });

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /ya tienen cargado/);
});
