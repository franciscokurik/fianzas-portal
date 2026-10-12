// La puerta por la que Fortex HRM lee las comisiones de fianzas, para sumarlas
// al estado de cuenta de cada asesor.
//
// Lo que se fija aquí:
//   1. falla CERRADO: sin llave configurada, o con una corta, no contesta;
//   2. solo entra con la llave: ni sin encabezado, ni con otra, ni con la
//      sesión de un admin del portal;
//   3. manda solo lo CONCILIADO dentro del periodo, por fecha de conciliación;
//   4. el vendedor va por correo, y es el guardado al capturar, no el titular
//      de hoy; las comisiones sin vendedor no salen;
//   5. va la comisión neta completa: el porcentaje del asesor lo pone HRM.
import { test, before, after, afterEach } from 'node:test';
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

const LLAVE = 'a'.repeat(64);

let servidor;
let base;

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Admin', 'admin@fortex.mx', 'x', 'admin'),
      (NULL, 'Ana',   'Ana.Lopez@Fortex.mx', 'x', 'vendedor'),
      (NULL, 'Beto',  'beto@fortex.mx', 'x', 'vendedor');
    INSERT INTO clients (razon_social, vendedor_id) VALUES
      ('Constructora Uno', 2), ('Sin Vendedor SA', NULL);
    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta', 'aserta');
    INSERT INTO proyectos (client_id, nombre) VALUES (1, 'Obra Uno'), (2, 'Obra Dos');
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza, clase,
                         tipo_fianza_id, prima_neta, monto_afianzado, fecha_vigencia) VALUES
      (1, 1, 1, '0301121', 'fianza', (SELECT id FROM tipos_fianza WHERE nombre = 'Cumplimiento'),
       2000000, 50000000, '2099-01-01'),
      (2, 2, 1, 'SV-1', 'fianza', NULL, 1000000, 50000000, '2099-01-01');
    INSERT INTO comisiones (fianza_id, vendedor_id, fecha_pago, fecha_conciliacion, comision_neta) VALUES
      -- De Ana, conciliada en marzo de 2026: sale.
      (1, 2, '2026-03-01', '2026-03-15', 300000),
      -- Guardada a Beto aunque el titular de hoy es Ana: sale como de Beto.
      (1, 3, NULL,         '2026-11-30', 120000),
      -- Una devolución, en negativo: sale tal cual.
      (1, 2, NULL,         '2026-06-10', -50000),
      -- Por conciliar: todavía no se le debe a nadie.
      (1, 2, '2026-04-01', NULL,         99900),
      -- Conciliada, pero de otro año.
      (1, 2, NULL,         '2025-12-31', 77700),
      -- Sin vendedor: no hay a quién sumársela.
      (2, NULL, NULL,      '2026-05-05', 88800);
  `);

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());
afterEach(() => { delete process.env.HRM_API_KEY; });

const RUTA = '/api/integracion/comisiones?desde=2026-01-01&hasta=2026-12-31';
const pedir = (ruta, autorizacion) =>
  fetch(`${base}${ruta}`, { headers: autorizacion ? { Authorization: autorizacion } : {} });

test('sin HRM_API_KEY no le contesta a nadie, ni con una llave cualquiera', async () => {
  const r = await pedir(RUTA, `Bearer ${LLAVE}`);
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /HRM_API_KEY/);
});

test('una llave corta configurada tampoco abre: se adivina', async () => {
  process.env.HRM_API_KEY = 'corta';
  const r = await pedir(RUTA, 'Bearer corta');
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /corta/);
});

test('sin la llave correcta no entra, tampoco con la sesión de un admin', async () => {
  process.env.HRM_API_KEY = LLAVE;
  const admin = signToken({ id: 1, role: 'admin', nombre: 'Admin' });
  for (const autorizacion of [null, `Bearer ${'b'.repeat(64)}`, LLAVE, `Bearer ${admin}`]) {
    assert.equal((await pedir(RUTA, autorizacion)).status, 401, String(autorizacion));
  }
});

test('el periodo es obligatorio y tiene que ser de fechas válidas', async () => {
  process.env.HRM_API_KEY = LLAVE;
  const auth = `Bearer ${LLAVE}`;
  for (const q of ['', '?desde=2026-01-01', '?desde=2026-02-31&hasta=2026-12-31',
    '?desde=2026-12-31&hasta=2026-01-01']) {
    assert.equal((await pedir(`/api/integracion/comisiones${q}`, auth)).status, 400, q);
  }
});

test('manda solo lo conciliado en el periodo, con el correo del vendedor guardado', async () => {
  process.env.HRM_API_KEY = LLAVE;
  const r = await pedir(RUTA, `Bearer ${LLAVE}`);
  assert.equal(r.status, 200);
  const { comisiones } = await r.json();

  assert.deepEqual(
    comisiones.map((c) => [c.fecha_conciliacion, c.vendedor_email, c.comision_neta]),
    [
      ['2026-03-15', 'ana.lopez@fortex.mx', 300000],
      ['2026-06-10', 'ana.lopez@fortex.mx', -50000],
      ['2026-11-30', 'beto@fortex.mx', 120000],
    ],
  );

  // Lo que HRM pinta en el detalle: póliza con su cero, afianzadora, cliente,
  // tipo y la prima, en centavos como todo el dinero del portal.
  const [primera] = comisiones;
  assert.equal(primera.numero_poliza, '0301121');
  assert.equal(primera.afianzadora, 'Aserta');
  assert.equal(primera.cliente, 'Constructora Uno');
  assert.equal(primera.tipo_fianza, 'Cumplimiento');
  assert.equal(primera.prima_neta, 2000000);
  assert.equal(primera.vendedor_nombre, 'Ana');
});
