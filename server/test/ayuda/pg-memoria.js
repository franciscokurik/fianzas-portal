// Postgres de verdad, en memoria (PGlite/WASM), con la MISMA interfaz que
// server/src/db.js. Así las pruebas ejercitan el código real de migraciones y
// las consultas de las rutas sin tocar la base de Neon.
import { PGlite } from '@electric-sql/pglite';

// Convierte los '?' posicionales al formato $1, $2, ... igual que db.js.
function toPg(text) {
  let i = 0;
  return text.replace(/\?/g, () => `$${++i}`);
}

function normalize(row) {
  if (!row || typeof row !== 'object') return row;
  for (const k of Object.keys(row)) {
    if (typeof row[k] === 'bigint') row[k] = Number(row[k]);
  }
  return row;
}

export function baseEnMemoria() {
  const pg = new PGlite();

  const db = {
    async query(text, params = []) {
      const { rows } = await pg.query(toPg(text), params);
      return rows.map(normalize);
    },
    prepare(text) {
      const q = toPg(text);
      return {
        get: async (...a) => {
          const { rows } = await pg.query(q, a);
          return rows.length ? normalize(rows[0]) : undefined;
        },
        all: async (...a) => (await pg.query(q, a)).rows.map(normalize),
        run: async (...a) => ({ rows: (await pg.query(q, a)).rows.map(normalize) }),
      };
    },
  };

  // Para el DDL suelto de las pruebas (crear la base "vieja", por ejemplo).
  db.exec = (sql) => pg.exec(sql);
  return db;
}

// El esquema tal como estaba ANTES de proyectos, catálogo de tipos y centavos:
// es el punto de partida de la base que hoy está en producción.
export const ESQUEMA_VIEJO = `
  CREATE TABLE clients (
    id SERIAL PRIMARY KEY, razon_social TEXT NOT NULL, rfc TEXT UNIQUE,
    email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'client',
    linea_credito DOUBLE PRECISION NOT NULL DEFAULT 0,
    telefono TEXT, created_at TEXT NOT NULL DEFAULT 'x');
  CREATE TABLE afianzadoras (
    id SERIAL PRIMARY KEY, nombre TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    activo INTEGER NOT NULL DEFAULT 1);
  CREATE TABLE client_credit_lines (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id) ON DELETE CASCADE,
    linea_credito DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT 'x', UNIQUE(client_id, afianzadora_id));
  CREATE TABLE fianzas (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id),
    numero_poliza TEXT NOT NULL, tipo_fianza TEXT NOT NULL,
    prima_neta DOUBLE PRECISION NOT NULL DEFAULT 0,
    monto_afianzado DOUBLE PRECISION NOT NULL DEFAULT 0,
    fecha_inicio TEXT, fecha_vigencia TEXT, created_at TEXT NOT NULL DEFAULT 'x');
`;
