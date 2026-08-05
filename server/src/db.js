// Capa de acceso a datos sobre PostgreSQL (Neon / Vercel Postgres).
// Usa el driver serverless de Neon (HTTP), ideal para funciones serverless.
//
// Mantiene una API parecida a la de node:sqlite (prepare().get/all/run) pero
// ASÍNCRONA: cada método devuelve una Promesa. Los placeholders siguen siendo
// '?' y aquí se convierten a $1, $2, ... de Postgres.
import { neon, types as pgTypes } from '@neondatabase/serverless';
import { inicializar } from './migrations.js';

// El dinero vive en BIGINT (centavos). Por omisión el driver entrega int8 y
// numeric como STRING, así que `total + fila.monto` concatenaría texto en vez
// de sumar. Los convertimos a Number aquí, en la frontera con la base:
// son centavos enteros, siempre muy por debajo de 2^53, así que la suma y la
// resta son exactas (que es justo lo que el float no garantizaba).
const OID_INT8 = 20;
const OID_NUMERIC = 1700;
const types = {
  getTypeParser(oid, format) {
    if (oid === OID_INT8 || oid === OID_NUMERIC) {
      return (valor) => (valor === null ? null : Number(valor));
    }
    return pgTypes.getTypeParser(oid, format);
  },
};

// Cliente Neon perezoso: se construye en el primer uso para no fallar al
// importar el módulo cuando aún no hay DATABASE_URL (p.ej. durante el build).
let _sql = null;
function client() {
  if (_sql) return _sql;
  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL: define la cadena de conexión de Postgres (Neon).');
  }
  _sql = neon(process.env.DATABASE_URL, { types });
  return _sql;
}
// El driver HTTP de Neon se invoca como función: sql(texto, params) -> filas.
const sql = {
  query: (text, params) => client()(text, params),
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
