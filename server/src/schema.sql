-- ============================================================
--  Portal de Fianzas Fortex — Esquema de base de datos (PostgreSQL)
--  Compatible con Neon / Vercel Postgres.
-- ============================================================

-- ----------------------------------------------------------------
-- Clientes (fiados) y administradores de Fortex
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id            SERIAL PRIMARY KEY,
  razon_social  TEXT    NOT NULL,           -- nombre o razón social
  rfc           TEXT    UNIQUE,             -- usado para login
  email         TEXT    UNIQUE NOT NULL,    -- usado para login
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'client',  -- 'client' | 'admin'
  linea_credito DOUBLE PRECISION NOT NULL DEFAULT 0, -- (en desuso) línea global heredada
  telefono      TEXT,                       -- para WhatsApp/SMS futuro
  created_at    TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
);

-- ----------------------------------------------------------------
-- Afianzadoras (Aserta, Berkley, Tokio Marine, Chubb, ...)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afianzadoras (
  id      SERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL,
  slug    TEXT UNIQUE NOT NULL,             -- identificador corto (aserta, berkley...)
  activo  INTEGER NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------------
-- Líneas de crédito por (cliente × afianzadora)
-- El "disponible" se calcula = linea_credito - Σ monto_afianzado
--   de las fianzas NO vencidas de esa afianzadora.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_credit_lines (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id) ON DELETE CASCADE,
  linea_credito  DOUBLE PRECISION NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(client_id, afianzadora_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_lines_client ON client_credit_lines(client_id);

-- ----------------------------------------------------------------
-- Fianzas (pólizas) de cada cliente
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fianzas (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id),
  numero_poliza  TEXT    NOT NULL,
  tipo_fianza    TEXT    NOT NULL,          -- p.ej. "Cumplimiento", "Anticipo", "Buena calidad"
  prima_neta     DOUBLE PRECISION NOT NULL DEFAULT 0,
  monto_afianzado DOUBLE PRECISION NOT NULL DEFAULT 0,
  fecha_inicio   TEXT,                      -- ISO yyyy-mm-dd
  fecha_vigencia TEXT,                      -- ISO yyyy-mm-dd (fecha de vencimiento)
  created_at     TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_fianzas_client ON fianzas(client_id);

-- ----------------------------------------------------------------
-- Catálogo de tipos de documento estándar requeridos por afianzadoras
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_types (
  id                SERIAL PRIMARY KEY,
  nombre            TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  periodicidad_meses INTEGER,               -- NULL = no vence
  alerta_dias       INTEGER NOT NULL DEFAULT 30,
  orden             INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------
-- Documentos subidos por el cliente (uno por tipo, se reemplaza al re-subir)
-- file_path guarda la URL pública del blob en Vercel Blob.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_documents (
  id               SERIAL PRIMARY KEY,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id),
  file_path        TEXT    NOT NULL,        -- URL pública del archivo (Vercel Blob)
  original_name    TEXT    NOT NULL,
  mime_type        TEXT,
  size_bytes       INTEGER,
  uploaded_at      TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'),
  vencimiento      TEXT,                    -- ISO yyyy-mm-dd o NULL
  UNIQUE(client_id, document_type_id)
);

-- ----------------------------------------------------------------
-- Papelería específica: solicitudes puntuales que crea Fortex
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS papeleria_requests (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER REFERENCES afianzadoras(id),
  fianza_id      INTEGER REFERENCES fianzas(id) ON DELETE SET NULL,
  descripcion    TEXT    NOT NULL,
  estado         TEXT    NOT NULL DEFAULT 'pendiente', -- pendiente | entregado
  file_path      TEXT,                      -- URL pública del archivo (Vercel Blob)
  original_name  TEXT,
  uploaded_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')
);
CREATE INDEX IF NOT EXISTS idx_papeleria_client ON papeleria_requests(client_id);

-- ----------------------------------------------------------------
-- Log de notificaciones enviadas (para no duplicar alertas)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL,        -- ef_60, domicilio_30, fianza_30, papeleria
  ref_key    TEXT NOT NULL,        -- clave única del evento (p.ej. fianza:12)
  canal      TEXT NOT NULL DEFAULT 'email',
  mensaje    TEXT,
  sent_at    TEXT NOT NULL DEFAULT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS'),
  UNIQUE(client_id, tipo, ref_key)
);
