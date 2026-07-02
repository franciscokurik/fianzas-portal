-- ============================================================
--  Portal de Fianzas Fortex — Esquema de base de datos (SQLite)
--  Diseñado para migrar a PostgreSQL con cambios mínimos.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ----------------------------------------------------------------
-- Clientes (fiados) y administradores de Fortex
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  razon_social  TEXT    NOT NULL,           -- nombre o razón social
  rfc           TEXT    UNIQUE,             -- usado para login
  email         TEXT    UNIQUE NOT NULL,    -- usado para login
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'client',  -- 'client' | 'admin'
  linea_credito REAL    NOT NULL DEFAULT 0, -- línea de crédito total autorizada
  telefono      TEXT,                       -- para WhatsApp/SMS futuro
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ----------------------------------------------------------------
-- Afianzadoras (Aserta, Berkley, Tokio Marine, Chubb, ...)
-- Escalable: Fortex agrega nuevas desde el panel admin.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS afianzadoras (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre  TEXT NOT NULL,
  slug    TEXT UNIQUE NOT NULL,             -- identificador corto (aserta, berkley...)
  activo  INTEGER NOT NULL DEFAULT 1
);

-- ----------------------------------------------------------------
-- Líneas de crédito por (cliente × afianzadora)
-- Cada afianzadora autoriza su propia línea para el cliente.
-- El "disponible" se calcula = linea_credito - Σ monto_afianzado
--   de las fianzas NO vencidas de esa afianzadora.
-- (Sustituye al campo global clients.linea_credito, que queda en desuso.)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_credit_lines (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id) ON DELETE CASCADE,
  linea_credito  REAL    NOT NULL DEFAULT 0,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id, afianzadora_id)
);
CREATE INDEX IF NOT EXISTS idx_credit_lines_client ON client_credit_lines(client_id);

-- ----------------------------------------------------------------
-- Fianzas (pólizas) de cada cliente
-- El "estado" (Activa/Por vencer/Vencida) se calcula desde fecha_vigencia.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fianzas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id),
  numero_poliza  TEXT    NOT NULL,
  tipo_fianza    TEXT    NOT NULL,          -- p.ej. "Cumplimiento", "Anticipo", "Buena calidad"
  prima_neta     REAL    NOT NULL DEFAULT 0,
  monto_afianzado REAL   NOT NULL DEFAULT 0,
  fecha_inicio   TEXT,                      -- ISO yyyy-mm-dd
  fecha_vigencia TEXT,                      -- ISO yyyy-mm-dd (fecha de vencimiento)
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fianzas_client ON fianzas(client_id);

-- ----------------------------------------------------------------
-- Catálogo de tipos de documento estándar requeridos por afianzadoras
-- periodicidad_meses NULL => sin vencimiento
-- alerta_dias => cuántos días antes del vencimiento alertar
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_types (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre            TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  periodicidad_meses INTEGER,               -- NULL = no vence
  alerta_dias       INTEGER NOT NULL DEFAULT 30,
  orden             INTEGER NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------
-- Documentos subidos por el cliente (uno por tipo, se reemplaza al re-subir)
-- vencimiento se calcula al subir = fecha_subida + periodicidad_meses
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS client_documents (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id        INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  document_type_id INTEGER NOT NULL REFERENCES document_types(id),
  file_path        TEXT    NOT NULL,        -- ruta relativa en /uploads
  original_name    TEXT    NOT NULL,
  mime_type        TEXT,
  size_bytes       INTEGER,
  uploaded_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  vencimiento      TEXT,                    -- ISO yyyy-mm-dd o NULL
  UNIQUE(client_id, document_type_id)
);

-- ----------------------------------------------------------------
-- Papelería específica: solicitudes puntuales que crea Fortex
-- para un cliente y (opcionalmente) una afianzadora/póliza concreta.
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS papeleria_requests (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  afianzadora_id INTEGER REFERENCES afianzadoras(id),
  fianza_id      INTEGER REFERENCES fianzas(id) ON DELETE SET NULL,
  descripcion    TEXT    NOT NULL,
  estado         TEXT    NOT NULL DEFAULT 'pendiente', -- pendiente | entregado
  -- archivo que sube el cliente como respuesta a la solicitud
  file_path      TEXT,
  original_name  TEXT,
  uploaded_at    TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_papeleria_client ON papeleria_requests(client_id);

-- ----------------------------------------------------------------
-- Log de notificaciones enviadas (para no duplicar alertas)
-- ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tipo       TEXT NOT NULL,        -- ef_60, domicilio_30, fianza_30, papeleria
  ref_key    TEXT NOT NULL,        -- clave única del evento (p.ej. fianza:12)
  canal      TEXT NOT NULL DEFAULT 'email',
  mensaje    TEXT,
  sent_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(client_id, tipo, ref_key)
);
