// Esquema de la base de datos como cadena JS (no como archivo .sql) para que
// SIEMPRE quede incluido en el bundle serverless de Vercel (un fs.readFile de
// un .sql podría no empaquetarse). Dialecto: PostgreSQL (Neon / Vercel Postgres).
const TS_DEFAULT = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS clients (
  id            SERIAL PRIMARY KEY,
  razon_social  TEXT    NOT NULL,
  rfc           TEXT    UNIQUE,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'client',
  linea_credito DOUBLE PRECISION NOT NULL DEFAULT 0,
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
  linea_credito  DOUBLE PRECISION NOT NULL DEFAULT 0,
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
  monto_contrato  DOUBLE PRECISION NOT NULL DEFAULT 0,
  fecha_inicio    TEXT,
  fecha_termino   TEXT,
  estatus         TEXT    NOT NULL DEFAULT 'en_proceso',
  notas           TEXT,
  created_at      TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_proyectos_client ON proyectos(client_id);

CREATE TABLE IF NOT EXISTS fianzas (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id),
  numero_poliza  TEXT    NOT NULL,
  tipo_fianza    TEXT    NOT NULL,
  prima_neta     DOUBLE PRECISION NOT NULL DEFAULT 0,
  monto_afianzado DOUBLE PRECISION NOT NULL DEFAULT 0,
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
-- Datos base y migración de lo que ya existe. Todo re-ejecutable sin efectos.
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

-- Los tipos que hoy están capturados como texto libre y no coinciden con el
-- catálogo se agregan tal cual, para no perder información de nadie.
INSERT INTO tipos_fianza (nombre, orden)
SELECT DISTINCT btrim(f.tipo_fianza), 500
FROM fianzas f
WHERE f.tipo_fianza IS NOT NULL
  AND btrim(f.tipo_fianza) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM tipos_fianza t WHERE lower(t.nombre) = lower(btrim(f.tipo_fianza))
  )
ON CONFLICT (nombre) DO NOTHING;

UPDATE fianzas f SET tipo_fianza_id = t.id
FROM tipos_fianza t
WHERE f.tipo_fianza_id IS NULL
  AND lower(t.nombre) = lower(btrim(f.tipo_fianza));

-- Toda fianza requiere proyecto: a las que venían sueltas se les crea uno
-- llamado 'General' por cliente para que el admin las reasigne después.
INSERT INTO proyectos (client_id, nombre, notas)
SELECT DISTINCT f.client_id, 'General', 'Creado automáticamente al migrar fianzas que no tenían proyecto.'
FROM fianzas f
WHERE f.proyecto_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM proyectos p WHERE p.client_id = f.client_id AND p.nombre = 'General'
  );

UPDATE fianzas f SET proyecto_id = p.id
FROM proyectos p
WHERE f.proyecto_id IS NULL
  AND p.client_id = f.client_id
  AND p.nombre = 'General';
`;
