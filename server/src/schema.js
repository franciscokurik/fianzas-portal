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
  -- Qué es esta empresa PARA EL PORTAL. Son dos negocios distintos, no dos
  -- niveles de permiso:
  --   'fiado'       -> compra fianzas. Todo lo de siempre.
  --   'contratante' -> NO compra ninguna. Es el desarrollador que EXIGE la
  --                    fianza a sus proveedores y entra nada más a ver quién
  --                    cumplió (ver routes/proveedores.js).
  --
  -- Va como columna y no como tabla aparte porque un contratante tiene la
  -- misma ficha que un fiado —razón social, RFC, teléfono, vendedor titular— y
  -- sus accesos se dan igual. Lo único que cambia es qué ve al entrar.
  tipo          TEXT    NOT NULL DEFAULT 'fiado'
                CHECK (tipo IN ('fiado', 'contratante')),
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

-- El tipo de empresa sobre bases que ya existen. El DEFAULT deja como 'fiado'
-- todo lo que ya estaba capturado, que es exactamente lo que es. La
-- restricción se rehace en cada /api/setup (el DROP primero) para que volver a
-- correr esto no truene.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'fiado';
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_tipo_check;
ALTER TABLE clients ADD CONSTRAINT clients_tipo_check CHECK (tipo IN ('fiado', 'contratante'));

-- El PADRÓN de proveedores de un contratante: a quién le exige fianza.
--
-- Tabla puente y NO una columna 'padre_id' en clients, porque un
-- subcontratista —el eléctrico, el de estructuras— le trabaja a varios
-- desarrolladores a la vez, y a veces además es cliente directo de Fortex. Con
-- una columna habría que darlo de alta una vez por cada desarrollador, y eso
-- significa duplicarle el expediente y las pólizas.
--
-- Estar en el padrón NO abre por sí solo ninguna información: nada más dice
-- que ese proveedor le tiene que presentar fianza a este contratante, y sirve
-- para poder decir "todavía no ha presentado ninguna". Lo que el contratante
-- alcanza a VER se decide por OBRA (proyectos.contratante_id), en
-- lib/permisos.js.
CREATE TABLE IF NOT EXISTS client_proveedores (
  id             SERIAL PRIMARY KEY,
  contratante_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  proveedor_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- Cómo le llama el contratante y qué le surte. Es SU nota, no un dato del
  -- proveedor: dos desarrolladores pueden anotar cosas distintas del mismo.
  alias          TEXT,
  notas          TEXT,
  -- Se SUSPENDE, no se borra: un proveedor al que el desarrollador ya no le
  -- compra tiene un historial de fianzas presentadas que no hay por qué perder.
  -- Y este 1/0 es además el interruptor de LECTURA: en 0, el contratante deja de
  -- ver sus obras en el mismo instante, aunque sigan ligadas (ver el
  -- JOIN_PADRON de lib/permisos.js). Baja lógica, igual que en tipos_fianza.
  activo         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT    NOT NULL DEFAULT ${TS_DEFAULT},
  UNIQUE(contratante_id, proveedor_id),
  -- Nadie es su propio proveedor. Sin esto, ligarse a sí mismo dejaría a un
  -- contratante viéndose en su propio padrón.
  CHECK (contratante_id <> proveedor_id)
);
ALTER TABLE client_proveedores ADD COLUMN IF NOT EXISTS activo INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_proveedores_contratante ON client_proveedores(contratante_id);
CREATE INDEX IF NOT EXISTS idx_proveedores_proveedor ON client_proveedores(proveedor_id);

-- El PROYECTO DEL CONTRATANTE: el desarrollo completo (una torre, un
-- fraccionamiento), con varios proveedores adentro.
--
-- Es otra cosa que 'proyectos', y por eso es otra tabla:
--   desarrollos -> lo que el DESARROLLADOR contrata y vigila. Es de él, y lo
--                  registra él desde su portal.
--   proyectos   -> el contrato de UN proveedor, que es de ese proveedor. Toda
--                  fianza cuelga de uno de estos, porque una fianza siempre la
--                  presenta una sola empresa por un solo contrato.
--
-- Sin este nivel, el desarrollador tenía sus obras sueltas —una por proveedor—
-- y ningún lugar donde ver la torre completa. Y es lo único que le pidió al
-- portal: tener todo en un mismo lugar.
--
-- El estatus usa el MISMO vocabulario que proyectos, para que la etiqueta se
-- pinte con la misma función en las dos pantallas.
CREATE TABLE IF NOT EXISTS desarrollos (
  id              SERIAL PRIMARY KEY,
  contratante_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  nombre          TEXT    NOT NULL,
  clave           TEXT,
  ubicacion       TEXT,
  monto_inversion BIGINT  NOT NULL DEFAULT 0,
  fecha_inicio    TEXT,
  fecha_termino   TEXT,
  estatus         TEXT    NOT NULL DEFAULT 'en_proceso',
  notas           TEXT,
  created_at      TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_desarrollos_contratante ON desarrollos(contratante_id);

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

-- Las PARTIDAS de un desarrollo: los pedazos de obra que el desarrollador va a
-- contratar por separado. Muros, electricidad, plomería, cancelería.
--
-- Es del CONTRATANTE, no del proveedor, y existe ANTES de saber quién la va a
-- hacer. Esa es toda la razón de que sea una tabla y no el contrato del
-- proveedor: al montar el edificio se sabe qué hace falta mucho antes de saber
-- a quién se le va a dar, y "esta partida todavía no tiene contratista" es un
-- pendiente distinto de "este contratista no ha presentado su fianza". Sin este
-- nivel, el primero no se podía ni decir.
--
-- El contrato del proveedor (proyectos) apunta a la partida que cumple. Así
-- queda la cadena completa: partida -> desarrollo -> contratante, y de ahí se
-- DERIVA todo lo demás, que es lo que impide que las columnas discrepen.
CREATE TABLE IF NOT EXISTS partidas (
  id             SERIAL PRIMARY KEY,
  desarrollo_id  INTEGER NOT NULL REFERENCES desarrollos(id) ON DELETE CASCADE,
  nombre         TEXT    NOT NULL,
  alcance        TEXT,
  monto_estimado BIGINT  NOT NULL DEFAULT 0,
  -- Para presentarlas en el orden de la obra y no alfabético: primero
  -- cimentación, al final acabados. Empatados, se ordenan por nombre.
  orden          INTEGER NOT NULL DEFAULT 50,
  notas          TEXT,
  created_at     TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
CREATE INDEX IF NOT EXISTS idx_partidas_desarrollo ON partidas(desarrollo_id);

-- QUÉ fianzas exige una partida. Es la pieza que faltaba para poder decir
-- "cubierta" y no solo "tiene una fianza".
--
-- Sin esto, una partida con la de cumplimiento pero SIN la de anticipo salía en
-- verde: el portal no tenía forma de saber que faltaba algo. Con la lista, la
-- pantalla contesta lo que de verdad importa — qué falta, no si hay algo.
--
-- El tipo lo manda el catálogo (tipos_fianza), el mismo que usan las pólizas.
-- ON DELETE CASCADE por los dos lados: si se va la partida se van sus
-- requisitos, y un tipo de fianza no se puede borrar del catálogo si alguien lo
-- usó (tipos_fianza se da de baja lógica, nunca se borra).
CREATE TABLE IF NOT EXISTS partida_requisitos (
  id             SERIAL PRIMARY KEY,
  partida_id     INTEGER NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
  tipo_fianza_id INTEGER NOT NULL REFERENCES tipos_fianza(id) ON DELETE CASCADE,
  UNIQUE(partida_id, tipo_fianza_id)
);
CREATE INDEX IF NOT EXISTS idx_requisitos_partida ON partida_requisitos(partida_id);

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

-- PARA QUIÉN es la obra, cuando ese alguien también entra al portal. Es LO
-- ÚNICO que le abre a un contratante la puerta a ver las fianzas de esta obra.
--
-- No sustituye a 'beneficiario' (texto libre) ni lo va a sustituir: la mayoría
-- de las obras son para CFE, el IMSS o un municipio, que no tienen cuenta aquí
-- y nunca la van a tener. Esta columna es para el caso en que el beneficiario
-- SÍ es cliente del portal.
--
-- Se liga la OBRA y no el proveedor a propósito. Si bastara con estar en el
-- padrón, el día que el mismo eléctrico le trabaje a dos desarrolladores cada
-- uno vería la obra del otro —incluido el monto del contrato de su
-- competencia—. Ligando por obra, cada uno ve la suya.
--
-- ON DELETE SET NULL: si se da de baja al contratante, la obra del proveedor
-- se queda (es suya); nada más deja de estar ligada.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS contratante_id INTEGER REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proyectos_contratante ON proyectos(contratante_id);

-- Dentro de QUÉ desarrollo va este contrato. Es AGRUPACIÓN, no permiso: quien
-- decide lo que el contratante alcanza sigue siendo contratante_id, y ese sigue
-- siendo el único que aparece en el alcance de lib/permisos.js.
--
-- Por eso las dos columnas y no una. Si el alcance dependiera del desarrollo,
-- habría que rehacer y volver a probar toda la maquinaria de privacidad, y una
-- obra ligada a un contratante que todavía no tiene desarrollo dejaría de
-- verse. Aquí contratante_id se DERIVA del desarrollo cuando hay uno
-- (routes/admin.js lo fuerza y no le cree al body), así que no pueden discrepar.
--
-- ON DELETE SET NULL: si el desarrollador borra su proyecto, el contrato del
-- proveedor se queda —es suyo, con sus pólizas— y nada más sale de la
-- agrupación.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS desarrollo_id INTEGER REFERENCES desarrollos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proyectos_desarrollo ON proyectos(desarrollo_id);

-- QUÉ partida del desarrollo cumple este contrato. Es lo que asigna un fiado a
-- "muros" o a "electricidad".
--
-- Sigue siendo AGRUPACIÓN, no permiso: quien autoriza es contratante_id, igual
-- que antes. Y la cadena se deriva hacia arriba —partida manda sobre desarrollo,
-- y desarrollo sobre contratante— porque con tres columnas que hablan de lo
-- mismo, la única forma de que no discrepen es que dos salgan de la primera
-- (ver resolverPartida en routes/admin.js).
--
-- ON DELETE SET NULL: si el desarrollador borra la partida, el contrato del
-- proveedor se queda —es suyo, con sus pólizas— y nada más deja de estar
-- asignado a ese pedazo de obra.
--
-- Nullable a propósito: una obra puede estar ligada a un contratante sin partida
-- (así era antes de que existieran), y hay obras que no son para ningún
-- contratante del portal.
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS partida_id INTEGER REFERENCES partidas(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_proyectos_partida ON proyectos(partida_id);

-- El tipo lo manda tipos_fianza. En bases viejas todavía existe la columna de
-- texto libre 'tipo_fianza'; la migración 003 la tira una vez respaldada.
CREATE TABLE IF NOT EXISTS fianzas (
  id             SERIAL PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  proyecto_id    INTEGER REFERENCES proyectos(id) ON DELETE RESTRICT,
  afianzadora_id INTEGER NOT NULL REFERENCES afianzadoras(id),
  numero_poliza  TEXT    NOT NULL,
  tipo_fianza_id INTEGER REFERENCES tipos_fianza(id),
  -- 'fianza' = póliza emitida. 'previo' = el mismo registro, con los mismos
  -- datos, pero antes de que la afianzadora la emita. Se captura igual porque
  -- es lo que se cotizó, y con el mismo renglón se convierte a fianza el día
  -- que sale: solo se cambia esta columna.
  --
  -- Un previo NO es un pasivo: no suma en el monto afianzado, no consume línea
  -- de crédito ni dispara avisos de vencimiento (ver routes/dashboard.js,
  -- routes/admin.js y services/alerts.js, que filtran por esta columna).
  clase          TEXT    NOT NULL DEFAULT 'fianza'
                 CHECK (clase IN ('fianza', 'previo')),
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
-- Las que ya estaban capturadas son pólizas emitidas: el DEFAULT las deja como
-- 'fianza' sin necesidad de migración aparte. La restricción se rehace en cada
-- /api/setup (el DROP primero) para que volver a correr esto no truene.
ALTER TABLE fianzas ADD COLUMN IF NOT EXISTS clase TEXT NOT NULL DEFAULT 'fianza';
ALTER TABLE fianzas DROP CONSTRAINT IF EXISTS fianzas_clase_check;
ALTER TABLE fianzas ADD CONSTRAINT fianzas_clase_check CHECK (clase IN ('fianza', 'previo'));
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
  -- Quién lo puso ahí: 'fortex', 'contratante' o 'proveedor'. Hace falta desde
  -- que el contratante puede subir la fianza que le entregó su proveedor: en la
  -- pantalla es la diferencia entre "esto lo tenemos porque nos lo dieron" y
  -- "esto lo emitió la afianzadora por medio de Fortex".
  --
  -- OJO con client_id en estos archivos: sigue siendo el DUEÑO, y para lo que
  -- sube el contratante el dueño es el contratante, no el proveedor de la obra.
  -- Así el archivo vive en la carpeta de Cloudinary de quien lo subió y no hay
  -- que aflojar la regla del prefijo, que es lo único que impide que un cliente
  -- le cuelgue archivos a otro.
  subido_por     TEXT    NOT NULL DEFAULT 'fortex',
  subido_el      TEXT    NOT NULL DEFAULT ${TS_DEFAULT}
);
-- En bases que ya existen: todo lo que hay lo subió Fortex, porque hasta ahora
-- la única ruta que registraba estos archivos era del panel.
ALTER TABLE documentos ADD COLUMN IF NOT EXISTS subido_por TEXT NOT NULL DEFAULT 'fortex';
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

-- Las comisiones que genera cada póliza. Son de FORTEX y de nadie más: ni el
-- fiado, ni el contratante, ni el operador las ven (ver routes/comisiones.js).
-- Una póliza puede generar varias —emisión, renovación, endoso—, así que es una
-- tabla aparte y no una columna de fianzas.
--
--   fecha_pago         -> cuando el CLIENTE pagó la fianza. Es la que manda en
--                         "comisión del mes".
--   fecha_conciliacion -> cuando se concilió contra el estado de cuenta de la
--                         afianzadora. Vacía = por conciliar.
--   vendedor_id        -> el vendedor titular del cliente AL CAPTURARLA. Se
--                         guarda y no se deriva: si mañana cambia el titular,
--                         lo ya ganado no se le pasa al nuevo.
--
-- ON DELETE CASCADE con la póliza: la comisión no tiene sentido sin ella. Lo
-- que impide perder comisiones por un borrado descuidado es la ruta, que solo
-- deja borrar una póliza con comisiones al administrador.
CREATE TABLE IF NOT EXISTS comisiones (
  id                 SERIAL PRIMARY KEY,
  fianza_id          INTEGER NOT NULL REFERENCES fianzas(id) ON DELETE CASCADE,
  vendedor_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  fecha_pago         TEXT    NOT NULL,
  fecha_conciliacion TEXT,
  comision_neta      BIGINT  NOT NULL,
  notas              TEXT,
  -- 'manual' o 'masiva': para saber, si algo no cuadra, si vino de un Excel.
  origen             TEXT    NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'masiva')),
  capturada_por      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at         TEXT    NOT NULL DEFAULT ${TS_DEFAULT},
  updated_at         TEXT
);
CREATE INDEX IF NOT EXISTS idx_comisiones_fianza ON comisiones(fianza_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_vendedor ON comisiones(vendedor_id);
CREATE INDEX IF NOT EXISTS idx_comisiones_pago ON comisiones(fecha_pago);

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
