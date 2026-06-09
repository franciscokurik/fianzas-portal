// Capa de acceso a datos usando el SQLite integrado de Node 24 (node:sqlite).
// Cero dependencias nativas / sin compilación.
// Para migrar a PostgreSQL más adelante, solo se reemplaza este módulo.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Aplica el esquema (idempotente: usa CREATE TABLE IF NOT EXISTS)
export function initSchema() {
  const sql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  db.exec(sql);
}

export default db;
