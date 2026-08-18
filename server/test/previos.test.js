// Previos: el mismo registro que una fianza y con los mismos datos, pero antes
// de que la afianzadora emita. Lo que se prueba aquí es lo único que los
// distingue: un previo NO es un pasivo, así que no puede colarse en el monto
// afianzado, en las primas, en el comprometido de la línea de crédito ni en los
// avisos de vencimiento. Y pasarlo a fianza es cambiar una columna, sin
// recapturar nada.
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
let tipoCumplimiento;

// La fianza emitida y el previo llevan el MISMO monto, para que cualquier
// total que los sume mal salte a la vista.
const MONTO = 500000; // centavos

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social) VALUES ('Constructora A');
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Administración', 'admin@fortex.mx', 'x', 'admin'),
      (1, 'Ana', 'a@demo.mx', 'x', 'client');
    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta','aserta');
    INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito)
      VALUES (1, 1, 10000000);
    INSERT INTO proyectos (client_id, nombre, monto_contrato) VALUES (1, 'Obra', 20000000);
  `);
  tipoCumplimiento = (await memoria.query(
    `SELECT id FROM tipos_fianza WHERE nombre = 'Cumplimiento'`
  ))[0].id;

  admin = signToken({ id: 1, role: 'admin', nombre: 'Administración' });
  cliente = signToken({ id: 2, role: 'client', client_id: 1, nombre: 'Ana' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const pedir = (ruta, token) =>
  fetch(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });

const mandar = (metodo, ruta, token, cuerpo) =>
  fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

const datosBase = {
  client_id: 1,
  proyecto_id: 1,
  afianzadora_id: 1,
  prima_neta: 10000,
  prima_total: 12000,
  monto_afianzado: MONTO,
  fecha_inicio: '2026-01-01',
  fecha_vigencia: '2027-01-01',
};

test('se dan de alta los dos con los mismos campos; sin clase es fianza', async () => {
  const emitida = await mandar('POST', '/api/admin/fianzas', admin, {
    ...datosBase, numero_poliza: 'ASE-1', tipo_fianza_id: tipoCumplimiento,
  });
  assert.equal(emitida.status, 200);

  const previo = await mandar('POST', '/api/admin/fianzas', admin, {
    ...datosBase, numero_poliza: 'PREV-1', tipo_fianza_id: tipoCumplimiento, clase: 'previo',
  });
  assert.equal(previo.status, 200);

  const clases = await memoria.query('SELECT numero_poliza, clase FROM fianzas ORDER BY id');
  assert.deepEqual(clases, [
    { numero_poliza: 'ASE-1', clase: 'fianza' },
    { numero_poliza: 'PREV-1', clase: 'previo' },
  ]);
});

test('una clase inventada se rechaza', async () => {
  const res = await mandar('POST', '/api/admin/fianzas', admin, {
    ...datosBase, numero_poliza: 'X-1', tipo_fianza_id: tipoCumplimiento, clase: 'borrador',
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /fianza o previo/);
});

test('el previo no suma en el panel del admin ni aparta línea de crédito', async () => {
  const { proyectos, lineas, fianzas } = await (await pedir('/api/admin/clientes/1/detalle', admin)).json();

  // Los dos renglones se ven (se capturan y se consultan igual)...
  assert.equal(fianzas.length, 2);
  assert.equal(proyectos[0].fianzas.length, 2);
  // ...pero el dinero es solo de la emitida.
  assert.equal(proyectos[0].monto_afianzado, MONTO);
  assert.equal(proyectos[0].total_fianzas, 1);
  assert.equal(proyectos[0].total_previos, 1);
  assert.equal(proyectos[0].suma_prima_total, 12000);
  assert.equal(lineas[0].comprometido, MONTO);
  assert.equal(lineas[0].disponible, 10000000 - MONTO);

  // Un previo no tiene vigencia que juzgar: su estado ES ser previo.
  assert.equal(fianzas.find((f) => f.numero_poliza === 'PREV-1').estado, 'previo');
});

test('el listado de clientes cuenta los previos aparte', async () => {
  const { clientes } = await (await pedir('/api/admin/clientes', admin)).json();
  assert.equal(clientes[0].total_fianzas, 1);
  assert.equal(clientes[0].total_previos, 1);
});

test('al fiado se le muestra el previo marcado, pero fuera de sus cifras', async () => {
  const { fianzas } = await (await pedir('/api/fianzas', cliente)).json();
  assert.equal(fianzas.length, 2);
  const p = fianzas.find((f) => f.numero_poliza === 'PREV-1');
  assert.equal(p.clase, 'previo');
  assert.equal(p.estado, 'previo');
  assert.equal(p.dias_para_vencer, null);

  const { metricas } = await (await pedir('/api/dashboard', cliente)).json();
  assert.equal(metricas.monto_afianzado_total, MONTO);
  assert.equal(metricas.fianzas_activas, 1);
  assert.equal(metricas.previos_en_tramite, 1);
  assert.equal(metricas.suma_prima_total, 12000);
  assert.equal(metricas.lineas[0].comprometido, MONTO);
});

test('el previo no dispara avisos de vencimiento', async () => {
  // Se le pone vigencia dentro de la ventana de 30 días a los dos registros:
  // el aviso tiene que salir solo por la póliza emitida.
  const pronto = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  await memoria.query('UPDATE fianzas SET fecha_vigencia = $1', [pronto]);

  const { correrAlertas } = await import('../src/services/alerts.js');
  await correrAlertas();

  const avisos = await memoria.query(
    `SELECT ref_key FROM notifications WHERE tipo = 'fianza_30' ORDER BY ref_key`
  );
  assert.deepEqual(avisos.map((a) => a.ref_key), ['fianza:1']);
});

test('pasar el previo a fianza es cambiar la clase, sin recapturar nada', async () => {
  const antes = (await memoria.query('SELECT * FROM fianzas WHERE numero_poliza = $1', ['PREV-1']))[0];

  const res = await mandar('PUT', '/api/admin/fianzas/2', admin, { clase: 'fianza' });
  assert.equal(res.status, 200);

  const despues = (await memoria.query('SELECT * FROM fianzas WHERE numero_poliza = $1', ['PREV-1']))[0];
  assert.deepEqual({ ...despues, clase: 'previo' }, antes, 'solo cambió la clase');

  // Y ya emitida, sí entra en las cifras.
  const { lineas } = await (await pedir('/api/admin/clientes/1/detalle', admin)).json();
  assert.equal(lineas[0].comprometido, MONTO * 2);
});
