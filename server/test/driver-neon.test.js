// Esta prueba faltaba, y por eso se fue a producción un bug feo: el panel
// mostraba "$3,875,848,238,758,482,000,000" de monto afianzado.
//
// Causa: Postgres manda los BIGINT como texto. Sumar tres fianzas hacía
// "38758482" + "38758482" + "10146828" — concatenación, no suma.
//
// Las demás pruebas usan PGlite, que entrega los bigint ya como número de JS,
// así que NUNCA tocaban este camino. Aquí se ejercita el driver real de Neon
// contra una respuesta HTTP simulada.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = 'postgresql://u:p@ep-prueba.us-east-2.aws.neon.tech/db';
const { default: db } = await import('../src/db.js');

const fetchReal = globalThis.fetch;
after(() => { globalThis.fetch = fetchReal; });

// Simula lo que Neon devuelve por HTTP: los valores SIEMPRE vienen como texto,
// y el tipo real de cada columna viaja aparte, en `fields`.
function responderCon(fields, filas) {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ command: 'SELECT', rowCount: filas.length, fields, rows: filas }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const COL = {
  texto: (name) => ({ name, dataTypeID: 25, format: 'text' }),
  bigint: (name) => ({ name, dataTypeID: 20, format: 'text' }),
  numeric: (name) => ({ name, dataTypeID: 1700, format: 'text' }),
  entero: (name) => ({ name, dataTypeID: 23, format: 'text' }),
};

before(() => responderCon([], []));

test('un BIGINT llega como número, no como texto', async () => {
  responderCon([COL.bigint('monto_afianzado')], [['38758482']]);
  const fila = await db.prepare('SELECT monto_afianzado FROM fianzas').get();

  assert.equal(typeof fila.monto_afianzado, 'number');
  assert.equal(fila.monto_afianzado, 38758482);
});

test('sumar varias fianzas suma de verdad (el bug de producción)', async () => {
  responderCon(
    [COL.bigint('monto_afianzado')],
    [['38758482'], ['38758482'], ['10146828']],
  );
  const filas = await db.prepare('SELECT monto_afianzado FROM fianzas').all();
  const total = filas.reduce((s, f) => s + f.monto_afianzado, 0);

  // $387,584.82 + $387,584.82 + $101,468.28 = $876,637.92
  assert.equal(total, 87663792);
  assert.notEqual(String(total), '0387584823875848210146828');
});

test('un SUM de Postgres (numeric) también llega como número', async () => {
  responderCon([COL.numeric('total')], [['87663792']]);
  const fila = await db.prepare('SELECT sum(monto_afianzado) AS total FROM fianzas').get();

  assert.equal(typeof fila.total, 'number');
  assert.equal(fila.total, 87663792);
});

test('las columnas de TEXTO no se tocan, aunque parezcan números', async () => {
  // numero_poliza es TEXT y suele traer ceros a la izquierda: convertirlo
  // a número los borraría y dejaría de coincidir con el de la afianzadora.
  responderCon(
    [COL.texto('numero_poliza'), COL.texto('rfc'), COL.bigint('monto_afianzado')],
    [['0301121', '0012345678', '38758482']],
  );
  const fila = await db.prepare('SELECT numero_poliza, rfc, monto_afianzado FROM fianzas').get();

  assert.equal(fila.numero_poliza, '0301121', 'se perdió el cero a la izquierda');
  assert.equal(fila.rfc, '0012345678');
  assert.equal(fila.monto_afianzado, 38758482);
});

test('un NULL sigue siendo null, no se vuelve 0', async () => {
  responderCon([COL.bigint('monto_afianzado')], [[null]]);
  const fila = await db.prepare('SELECT monto_afianzado FROM fianzas').get();

  assert.equal(fila.monto_afianzado, null);
});

test('los enteros normales (int4) siguen funcionando', async () => {
  responderCon([COL.entero('id'), COL.entero('c')], [['7', '3']]);
  const fila = await db.prepare('SELECT id, count(*)::int AS c FROM fianzas').get();

  assert.equal(fila.id, 7);
  assert.equal(fila.c, 3);
});

test('una consulta sin filas no truena', async () => {
  responderCon([COL.bigint('monto_afianzado')], []);
  assert.equal(await db.prepare('SELECT monto_afianzado FROM fianzas').get(), undefined);
  assert.deepEqual(await db.prepare('SELECT monto_afianzado FROM fianzas').all(), []);
});
