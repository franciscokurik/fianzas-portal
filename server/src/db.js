// Capa de acceso a datos sobre PostgreSQL (Neon / Vercel Postgres).
// Usa el driver serverless de Neon (HTTP), ideal para funciones serverless.
//
// Mantiene una API parecida a la de node:sqlite (prepare().get/all/run) pero
// ASÍNCRONA: cada método devuelve una Promesa. Los placeholders siguen siendo
// '?' y aquí se convierten a $1, $2, ... de Postgres.
import { neon } from '@neondatabase/serverless';
import { inicializar } from './migrations.js';

// El dinero vive en BIGINT (centavos), y el driver entrega int8 y numeric como
// STRING. Sin convertirlos, `total + fila.monto` CONCATENA en vez de sumar y
// tres fianzas de $387,584.82 dan "$3,875,848,238,758,482,000,000".
//
// Ojo: la opción `types` de neon() NO sirve para esto — el driver HTTP la
// ignora en silencio (verificado en server/test/driver-neon.test.js). La vía
// que sí funciona es pedir `fullResults`, que además de las filas devuelve el
// TIPO de cada columna, y convertir con base en eso.
//
// Tiene que ser por tipo de columna y no por cómo se ve el valor: numero_poliza
// es TEXT y suele traer ceros a la izquierda ("0301121"), que se perderían.
const OID_INT8 = 20;     // bigint
const OID_NUMERIC = 1700; // numeric (lo que devuelve SUM sobre un bigint)

// Cliente Neon perezoso: se construye en el primer uso para no fallar al
// importar el módulo cuando aún no hay DATABASE_URL (p.ej. durante el build).
let _sql = null;
function client() {
  if (_sql) return _sql;
  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL: define la cadena de conexión de Postgres (Neon).');
  }
  _sql = neon(process.env.DATABASE_URL, { fullResults: true });
  return _sql;
}

// Convierte a Number las columnas que Postgres manda como texto por ser
// enteros de 64 bits. Son centavos, muy por debajo de 2^53, así que sumar y
// restar es exacto — que es justo lo que el float no garantizaba.
function convertirEnteros({ fields = [], rows = [] }) {
  const numericas = fields
    .filter((f) => f.dataTypeID === OID_INT8 || f.dataTypeID === OID_NUMERIC)
    .map((f) => f.name);
  if (!numericas.length) return rows;

  for (const fila of rows) {
    for (const columna of numericas) {
      if (fila[columna] !== null && fila[columna] !== undefined) {
        fila[columna] = Number(fila[columna]);
      }
    }
  }
  return rows;
}

// El driver HTTP de Neon se invoca como función: sql(texto, params).
const sql = {
  query: async (text, params) => convertirEnteros(await client()(text, params)),
};

// Convierte los '?' posicionales al formato $1, $2, ... de Postgres.
function toPg(text) {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

// Normaliza BigInt (p.ej. de COUNT o SERIAL) a Number para el código de la app.
function normalize(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k of Object.keys(row)) {
    if (typeof row[k] === 'bigint') row[k] = Number(row[k]);
  }
  return row;
}

const db = {
  // Ejecuta una consulta parametrizada y devuelve las filas.
  async query(text, params = []) {
    const rows = await sql.query(toPg(text), params);
    return rows.map(normalize);
  },
  prepare(text) {
    const pg = toPg(text);
    return {
      get: async (...args) => {
        const rows = await sql.query(pg, args);
        return rows.length ? normalize(rows[0]) : undefined;
      },
      all: async (...args) => (await sql.query(pg, args)).map(normalize),
      run: async (...args) => {
        const rows = await sql.query(pg, args);
        return { rows: rows.map(normalize) };
      },
    };
  },
};

// Aplica el esquema y las migraciones pendientes (ver migrations.js).
export async function initSchema() {
  return inicializar(db);
}

export default db;
