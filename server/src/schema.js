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
-- La EMPRESA fiada. No tiene con qué entrar al portal: para eso están los
-- usuarios. Antes esta tabla era las dos cosas a la vez, y por eso una
-- constructora solo podía tener un acceso (ver migración 005).
CREATE TABLE IF NOT EXISTS clients (
  id            SERIAL PRIMARY KEY,
  razon_social  TEXT    NOT NULL,
  rfc           TEXT    UNIQUE,
  linea_credito BIGINT  NOT NULL DEFAULT 0,
  telefono      TEXT,
  created_at    TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);

-- Las PERSONAS que entran al portal.
--   client_id lleno  -> gente del fiado; ve solo lo de su empresa.
--   client_id NULL   -> personal de Fortex (admin u operador).
--
-- Tres niveles internos, de menos a más:
--   VENDEDOR -> solo los clientes que tenga asignados, y solo sobre ellos.
--   OPERADOR -> todos los clientes; toda la operación (alta de clientes,
--               líneas de crédito, catálogos).
--   ADMIN    -> lo del operador, más las cuentas de acceso y la baja de una
--               empresa completa.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  client_id     INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  nombre        TEXT    NOT NULL,
  email         TEXT    UNIQUE NOT NULL,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'client'
                CHECK (role IN ('client', 'vendedor', 'operador', 'admin')),
  activo        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_users_client ON users(client_id);

-- El vendedor titular de la cuenta. Puede ser CUALQUIER cuenta interna: un
-- admin o un operador también llevan cuentas propias. Para ellos el campo no
-- limita nada, porque de todas formas ven todo; para el vendedor es justo lo
-- que lo acota (ver lib/permisos.js, el único lugar donde eso se decide).
--
-- ON DELETE SET NULL: al dar de baja a quien lo atendía, el cliente queda sin
-- asignar y lo siguen viendo los admins y operadores. Nunca se borra con él.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS vendedor_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_clients_vendedor ON clients(vendedor_id);

-- Enlaces para reponer la contraseña olvidada.
--
-- Se guarda el HASH del token, no el token: quien pueda leer esta tabla (un
-- respaldo, un log de consultas) no debe poder entrar a ninguna cuenta con lo
-- que vea aquí. El token en claro solo existe dentro del correo que se manda.
CREATE TABLE IF NOT EXISTS password_resets (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT    NOT NULL UNIQUE,
  expira_el  TEXT    NOT NULL,
  usado_el   TEXT,
  created_at TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);

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
  -- Dos primas y no una: la NETA es la tarifa de la afianzadora y la TOTAL es
  -- lo que el fiado acaba pagando (neta + derecho de póliza + IVA). El fiado
  -- reclama por la total y la afianzadora reporta la neta, así que hacen falta
  -- las dos para que los números cuadren contra el recibo.
  prima_neta     BIGINT  NOT NULL DEFAULT 0,
  prima_total    BIGINT  NOT NULL DEFAULT 0,
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
ALTER TABLE fianzas ADD COLUMN IF NOT EXISTS prima_total BIGINT NOT NULL DEFAULT 0;
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

-- Expediente del fiado: un archivo vigente por cada tipo de documento. Cuando
-- se renueva, se reemplaza (el UNIQUE es lo que fuerza eso).
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
  -- 'cliente' o 'fortex': el papel puede llegar por el portal o por correo a
  -- Fortex, y conviene saber quién lo cargó para no perseguir al fiado
  -- por algo que ya entregó.
  subido_por       TEXT    NOT NULL DEFAULT 'cliente',
  UNIQUE(client_id, document_type_id)
);
ALTER TABLE client_documents ADD COLUMN IF NOT EXISTS subido_por TEXT NOT NULL DEFAULT 'cliente';

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
