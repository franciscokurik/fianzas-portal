// Capa de acceso a datos sobre PostgreSQL (Neon / Vercel Postgres).
// Usa el driver serverless de Neon (HTTP), ideal para funciones serverless.
//
// Mantiene una API parecida a la de node:sqlite (prepare().get/all/run) pero
// ASÍNCRONA: cada método devuelve una Promesa. Los placeholders siguen siendo
// '?' y aquí se convierten a $1, $2, ... de Postgres.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

// Cliente Neon perezoso: se construye en el primer uso para no fallar al
// importar el módulo cuando aún no hay DATABASE_URL (p.ej. durante el build).
let _sql = null;
function client() {
  if (_sql) return _sql;
  if (!process.env.DATABASE_URL) {
    throw new Error('Falta DATABASE_URL: define la cadena de conexión de Postgres (Neon).');
  }
  _sql = neon(process.env.DATABASE_URL);
  return _sql;
}
const sql = {
  query: (text, params) => client().query(text, params),
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

// Aplica el esquema. El driver HTTP corre UNA sentencia por llamada, así que
// dividimos el archivo en sentencias individuales (sin comentarios de línea).
export async function initSchema() {
  const raw = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const stripped = raw.replace(/--[^\n]*/g, '');
  const statements = stripped
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const stmt of statements) {
    await sql.query(stmt);
  }
}

export default db;
