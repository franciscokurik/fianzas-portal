// Las migraciones son lo más peligroso del proyecto: corren sobre la base de
// producción y /api/setup se puede llamar varias veces. Un "multiplica por 100"
// repetido convierte $1,200,000 en $120,000,000 sin avisar.
//
// Corre con: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inicializar, MIGRACIONES } from '../src/migrations.js';
import { baseEnMemoria, ESQUEMA_VIEJO } from './ayuda/pg-memoria.js';

const CENTAVOS = 100;

// Base como la que hay hoy en producción: montos en pesos, tipo como texto
// libre, sin proyectos.
async function baseVieja() {
  const db = baseEnMemoria();
  await db.exec(ESQUEMA_VIEJO);
  await db.exec(`
    INSERT INTO clients (razon_social, email, password_hash)
      VALUES ('Constructora', 'a@d.mx', 'x');
    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta', 'aserta');
    INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito)
      VALUES (1, 1, 3000000);
    INSERT INTO fianzas (client_id, afianzadora_id, numero_poliza, tipo_fianza,
                         prima_neta, monto_afianzado) VALUES
      (1, 1, 'ASE-0012', 'Cumplimiento',  18500,   1200000),
      (1, 1, 'ASE-0048', 'Anticipo',       9200.55, 600000.99),
      (1, 1, 'BRK-7781', 'Buena calidad', 14300,    900000);
  `);
  return db;
}

const sumas = (db) => db.prepare(`SELECT
  (SELECT sum(monto_afianzado) FROM fianzas)::bigint AS montos,
  (SELECT sum(prima_neta)      FROM fianzas)::bigint AS primas,
  (SELECT linea_credito FROM client_credit_lines WHERE id = 1) AS linea`).get();

test('sobre una base existente aplica todas las migraciones', async () => {
  const db = await baseVieja();
  const corridas = await inicializar(db);
  assert.deepEqual(corridas, [
    '001_backfill_proyectos_y_tipos',
    '002_dinero_en_centavos',
    '003_quitar_tipo_fianza_legacy',
    '004_prima_total_desde_prima_neta',
    '005_usuarios_aparte_de_clientes',
  ]);
});

test('las cuentas que existían se vuelven usuarios sin perder la contraseña', async () => {
  const db = await baseVieja();
  await inicializar(db);

  // La constructora era a la vez empresa y login. Ahora es una empresa con una
  // persona dada de alta, que entra con el MISMO correo y la MISMA contraseña.
  const u = await db.prepare(
    `SELECT u.email, u.password_hash, u.role, u.client_id, c.razon_social
     FROM users u JOIN clients c ON c.id = u.client_id WHERE u.email = ?`
  ).get('a@d.mx');

  assert.equal(u.role, 'client');
  assert.equal(u.password_hash, 'x', 'la contraseña no debe cambiar: nadie tendría que recuperarla');
  assert.equal(u.razon_social, 'Constructora');

  // Y las columnas de login ya no viven en la tabla de empresas.
  const cols = await db.prepare(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ?`).all('clients');
  const nombres = cols.map((c) => c.column_name);
  for (const muerta of ['email', 'password_hash', 'role']) {
    assert.ok(!nombres.includes(muerta), `clients no debería seguir con la columna ${muerta}`);
  }
});

test('la cuenta de admin deja de ser una empresa fiada', async () => {
  const db = baseEnMemoria();
  await db.exec(ESQUEMA_VIEJO);
  await db.exec(`
    INSERT INTO clients (razon_social, email, password_hash, role)
      VALUES ('Fortex', 'admin@fortex.mx', 'hash', 'admin'),
             ('Constructora', 'c@d.mx', 'x', 'client');
  `);
  await inicializar(db);

  // El admin vivía en la tabla de fiados solo porque ahí estaba el login.
  // Migrado a users, no tiene por qué seguir apareciendo como cliente.
  const empresas = await db.prepare('SELECT razon_social FROM clients').all();
  assert.deepEqual(empresas.map((e) => e.razon_social), ['Constructora']);

  const admin = await db.prepare('SELECT client_id, role FROM users WHERE email = ?').get('admin@fortex.mx');
  assert.equal(admin.role, 'admin');
  assert.equal(admin.client_id, null, 'el admin no pertenece a ninguna empresa');
});

test('convierte los montos a centavos sin perder los centavos', async () => {
  const db = await baseVieja();
  await inicializar(db);
  const { montos, primas, linea } = await sumas(db);

  // 1,200,000 + 600,000.99 + 900,000 = 2,700,000.99
  assert.equal(montos, 270000099);
  // 18,500 + 9,200.55 + 14,300 = 42,000.55
  assert.equal(primas, 4200055);
  assert.equal(linea, 3000000 * CENTAVOS);
});

test('volver a llamar /api/setup NO vuelve a multiplicar los montos', async () => {
  const db = await baseVieja();
  await inicializar(db);
  const antes = await sumas(db);

  await inicializar(db);
  await inicializar(db);
  const despues = await sumas(db);

  assert.deepEqual(despues, antes, 'los montos cambiaron al re-aplicar el esquema');
});

test('aunque se pierda el registro de migraciones, los montos no se duplican', async () => {
  const db = await baseVieja();
  await inicializar(db);
  const antes = await sumas(db);

  // Caso catastrófico: alguien vacía schema_migrations (o se restaura un
  // respaldo viejo del registro) y /api/setup vuelve a correr.
  await db.query('DELETE FROM schema_migrations');
  await inicializar(db);

  assert.deepEqual(await sumas(db), antes,
    'la conversión a centavos se aplicó dos veces');
});

test('deja los montos como BIGINT', async () => {
  const db = await baseVieja();
  await inicializar(db);
  const cols = await db.prepare(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?`
  ).all('fianzas');
  const tipo = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));

  assert.equal(tipo.monto_afianzado, 'bigint');
  assert.equal(tipo.prima_neta, 'bigint');
});

test('toda fianza queda con proyecto y con tipo del catálogo', async () => {
  const db = await baseVieja();
  await inicializar(db);
  const { sin_proyecto, sin_tipo } = await db.prepare(`SELECT
    count(*) FILTER (WHERE proyecto_id IS NULL)::int    AS sin_proyecto,
    count(*) FILTER (WHERE tipo_fianza_id IS NULL)::int AS sin_tipo
    FROM fianzas`).get();

  assert.equal(sin_proyecto, 0);
  assert.equal(sin_tipo, 0);
});

test('al tirar la columna de texto no se pierde ningún tipo capturado a mano', async () => {
  const db = await baseVieja();
  await inicializar(db);

  // 'Buena calidad' no está en el catálogo estándar: debió conservarse.
  const fila = await db.prepare(
    `SELECT t.nombre FROM fianzas f JOIN tipos_fianza t ON t.id = f.tipo_fianza_id
     WHERE f.numero_poliza = ?`).get('BRK-7781');
  assert.equal(fila?.nombre, 'Buena calidad');

  // Y 'Cumplimiento' no se duplicó por diferencias de mayúsculas.
  const repes = await db.prepare(
    `SELECT count(*)::int AS c FROM tipos_fianza WHERE lower(nombre) = 'cumplimiento'`).get();
  assert.equal(repes.c, 1);

  const cols = await db.prepare(
    `SELECT column_name FROM information_schema.columns WHERE table_name = ?`).all('fianzas');
  assert.ok(!cols.some((c) => c.column_name === 'tipo_fianza'),
    'la columna de texto libre debió eliminarse');
});

test('la prima total arranca desde la neta y luego ya no se pisa', async () => {
  const db = await baseVieja();
  await inicializar(db);

  // Las fianzas que ya estaban capturadas no traen prima total: se arranca
  // desde la neta para que los totales no se lean como "no se paga nada".
  const { netas, totales } = await db.prepare(`SELECT
    sum(prima_neta)::bigint  AS netas,
    sum(prima_total)::bigint AS totales
    FROM fianzas`).get();
  assert.equal(totales, netas);

  // El admin captura la prima real del recibo (con derecho de póliza e IVA)…
  await db.query(`UPDATE fianzas SET prima_total = 2204000 WHERE numero_poliza = 'ASE-0012'`);

  // …y ni perdiendo el registro de migraciones se la vuelven a pisar.
  await db.query('DELETE FROM schema_migrations');
  await inicializar(db);

  const f = await db.prepare('SELECT prima_total FROM fianzas WHERE numero_poliza = ?').get('ASE-0012');
  assert.equal(f.prima_total, 2204000);
});

test('la prima total queda como BIGINT en centavos, igual que la neta', async () => {
  const db = await baseVieja();
  await inicializar(db);
  const cols = await db.prepare(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = ?`
  ).all('fianzas');
  const tipo = Object.fromEntries(cols.map((c) => [c.column_name, c.data_type]));

  assert.equal(tipo.prima_total, 'bigint');
});

test('un proyecto con fianzas no se puede borrar', async () => {
  const db = await baseVieja();
  await inicializar(db);
  await assert.rejects(() => db.query('DELETE FROM proyectos WHERE id = 1'));
});

test('en una base nueva no corre ninguna migración y nada se corrompe', async () => {
  const db = baseEnMemoria();
  const corridas = await inicializar(db);
  assert.deepEqual(corridas, [], 'una base nueva ya nace en su forma final');

  const registro = await db.prepare('SELECT nombre FROM schema_migrations').all();
  assert.equal(registro.length, MIGRACIONES.length, 'deben quedar registradas como aplicadas');

  await db.exec(`
    INSERT INTO clients (razon_social) VALUES ('Nueva SA');
    INSERT INTO users (client_id, nombre, email, password_hash, role)
      VALUES (1, 'Contacto', 'n@d.mx', 'x', 'client');
    INSERT INTO afianzadoras (nombre, slug) VALUES ('Chubb','chubb');
    INSERT INTO proyectos (client_id, nombre, monto_contrato) VALUES (1,'Obra',2400000000);
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                         tipo_fianza_id, prima_neta, monto_afianzado)
      VALUES (1,1,1,'CHB-1',(SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'),
              1850000, 120000000);
  `);

  await inicializar(db);
  await inicializar(db);

  const f = await db.prepare('SELECT monto_afianzado, prima_neta FROM fianzas WHERE id = 1').get();
  assert.equal(f.monto_afianzado, 120000000);
  assert.equal(f.prima_neta, 1850000);
});

test('los montos llegan a la app como número, no como texto', async () => {
  // Con BIGINT, el driver entrega int8 como string por omisión. Si eso se
  // colara, `total + fila.monto` concatenaría en vez de sumar.
  const db = await baseVieja();
  await inicializar(db);
  const f = await db.prepare('SELECT monto_afianzado FROM fianzas WHERE numero_poliza = ?')
    .get('ASE-0012');

  assert.equal(typeof f.monto_afianzado, 'number');
  assert.equal(f.monto_afianzado + f.monto_afianzado, 240000000);
});

test('el disponible cuadra al centavo', async () => {
  const db = await baseVieja();
  await inicializar(db);

  const linea = await db.prepare(
    'SELECT linea_credito FROM client_credit_lines WHERE id = 1').get();
  const fianzas = await db.prepare('SELECT monto_afianzado FROM fianzas').all();
  const comprometido = fianzas.reduce((s, f) => s + f.monto_afianzado, 0);

  // $3,000,000.00 - $2,700,000.99 = $299,999.01
  assert.equal(linea.linea_credito - comprometido, 29999901);
});
