// Esquema de la base de datos como cadena JS (no como archivo .sql) para que
// SIEMPRE quede incluido en el bundle serverless de Vercel (un fs.readFile de
// un .sql podría no empaquetarse). Dialecto: PostgreSQL (Neon / Vercel Postgres).
//
// AQUÍ SOLO VA DDL IDEMPOTENTE: este bloque corre completo en cada /api/setup.
// Lo que solo puede pasar una vez (convertir montos, tirar columnas) va en
// migrations.js.
//
// El dinero se guarda en BIGINT y en CENTAVOS, nunca en punto flotante.
const TS_DEFAULT = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clients (
  id            SERIAL PRIMARY KEY,
  razon_social  TEXT    NOT NULL,
  rfc           TEXT    UNIQUE,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'client',
  linea_credito BIGINT  NOT NULL DEFAULT 0,
  telefono      TEXT,
  created_at    TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);

CREATE TABLE IF NOT EXISTS afianzadoras (
  id      SERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL,
  slug    TEXT UNIQUE NOT NULL,
  activo  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS client_credit_lines (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id) ON DELETE CASCADE,
  linea_credito  BIGINT  NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT ${TS_DEFAULT},
  UNIQUE(client_id, afianzadora_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_lines_client ON client_credit_lines(client_id);

-- Catálogo editable de tipos de fianza (el admin puede dar de alta más).
CREATE TABLE IF NOT EXISTS tipos_fianza (
  id     SERIAL PRIMARY KEY,
  nombre TEXT UNIQUE NOT NULL,
  orden  INTEGER NOT NULL DEFAULT 50,
  activo INTEGER NOT NULL DEFAULT 1
);

-- Obras / contratos del cliente. Toda fianza cuelga de un proyecto.
CREATE TABLE IF NOT EXISTS proyectos (
  id              SERIAL PRIMARY KEY,
  client_id       INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  nombre          TEXT    NOT NULL,
  numero_contrato TEXT,
  beneficiario    TEXT,
  monto_contrato  BIGINT  NOT NULL DEFAULT 0,
  fecha_inicio    TEXT,
  fecha_termino   TEXT,
  estatus         TEXT    NOT NULL DEFAULT 'en_proceso',
  notas           TEXT,
  created_at      TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_proyectos_client ON proyectos(client_id);

-- El tipo lo manda tipos_fianza. En bases viejas todavía existe la columna de
-- texto libre 'tipo_fianza'; la migración 003 la tira una vez respaldada.
CREATE TABLE IF NOT EXISTS fianzas (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  proyecto_id    INTEGER REFERENCES proyectos(id) ON DELETE RESTRICT,
  afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id),
  numero_poliza  TEXT    NOT NULL,
  tipo_fianza_id INTEGER REFERENCES tipos_fianza(id),
  prima_neta     BIGINT  NOT NULL DEFAULT 0,
  monto_afianzado BIGINT NOT NULL DEFAULT 0,
  fecha_inicio   TEXT,
  fecha_vigencia TEXT,
  created_at     TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_fianzas_client ON fianzas(client_id);

-- Columnas nuevas sobre tablas que ya existen en producción. Idempotentes:
-- initSchema() corre en cada /api/setup, así que nada aquí puede fallar dos veces.
ALTER TABLE fianzas ADD COLUMN IF NOT EXISTS proyecto_id INTEGER REFERENCES proyectos(id) ON DELETE RESTRICT;
ALTER TABLE fianzas ADD COLUMN IF NOT EXISTS tipo_fianza_id INTEGER REFERENCES tipos_fianza(id);
ALTER TABLE fianzas ADD COLUMN IF NOT EXISTS fecha_recordatorio TEXT;
ALTER TABLE fianzas ADD COLUMN IF NOT EXISTS nota_recordatorio TEXT;
ALTER TABLE fianzas ADD COLUMN IF NOT EXISTS recordatorio_atendido_el TEXT;
CREATE INDEX IF NOT EXISTS idx_fianzas_proyecto ON fianzas(proyecto_id);
CREATE INDEX IF NOT EXISTS idx_fianzas_recordatorio ON fianzas(fecha_recordatorio);

-- Archivos colgados de un proyecto (contrato) o de una fianza (carátula).
-- Polimórfica a propósito: mañana cuelgan de un endoso o una reclamación sin
-- tocar el esquema. client_id va denormalizado para poder filtrar por dueño
-- en una sola consulta y para que el borrado en cascada limpie solo.
CREATE TABLE IF NOT EXISTS documentos (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  entidad_tipo   TEXT    NOT NULL CHECK (entidad_tipo IN ('proyecto', 'fianza')),
  entidad_id     INTEGER NOT NULL,
  tipo_doc       TEXT    NOT NULL,
  url            TEXT    NOT NULL,
  nombre_archivo TEXT    NOT NULL,
  mime_type      TEXT,
  size_bytes     INTEGER,
  subido_el      TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_documentos_entidad ON documentos(entidad_tipo, entidad_id);
CREATE INDEX IF NOT EXISTS idx_documentos_client ON documentos(client_id);

CREATE TABLE IF NOT EXISTS document_types (
  id                SERIAL PRIMARY KEY,
  nombre            TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  periodicidad_meses INTEGER,
  alerta_dias       INTEGER NOT NULL DEFAULT 30,
  orden             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS client_documents (
  id               SERIAL PRIMARY KEY,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id),
  file_path        TEXT    NOT NULL,
  original_name    TEXT    NOT NULL,
  mime_type        TEXT,
  size_bytes       INTEGER,
  uploaded_at      TEXT    NOT NULL DEFAULT ${TS_DEFAULT},
  vencimiento      TEXT,
  UNIQUE(client_id, document_type_id)
);

CREATE TABLE IF NOT EXISTS papeleria_requests (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER REFERENCES afianzadoras(id),
  fianza_id      INTEGER REFERENCES fianzas(id) ON DELETE SET NULL,
  descripcion    TEXT    NOT NULL,
  estado         TEXT    NOT NULL DEFAULT 'pendiente',
  file_path      TEXT,
  original_name  TEXT,
  uploaded_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_papeleria_client ON papeleria_requests(client_id);

CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL,
  ref_key    TEXT NOT NULL,
  canal      TEXT NOT NULL DEFAULT 'email',
  mensaje    TEXT,
  sent_at    TEXT NOT NULL DEFAULT ${TS_DEFAULT},
  UNIQUE(client_id, tipo, ref_key)
);

-- ---------------------------------------------------------------------------
-- Datos base. Re-ejecutable sin efectos; el backfill de lo que ya existía
-- vive en migrations.js porque solo puede correr una vez.
-- ---------------------------------------------------------------------------

-- Catálogo estándar del ramo. El admin puede agregar más desde el panel.
INSERT INTO tipos_fianza (nombre, orden) VALUES
  ('Anticipo', 10),
  ('Cumplimiento', 20),
  ('Buena calidad (vicios ocultos)', 30),
  ('Sostenimiento de oferta', 40),
  ('Arrendamiento', 50),
  ('Fiscal', 60),
  ('Concesión', 70),
  ('Fidelidad', 80),
  ('Judicial', 90),
  ('Crédito', 100)
ON CONFLICT (nombre) DO NOTHING;
`;
