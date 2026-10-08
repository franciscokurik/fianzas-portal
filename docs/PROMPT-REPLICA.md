# Prompt para replicar el Portal de Fianzas en otra plataforma

> Pégale esto completo a la sesión que está montando el proyecto nuevo. Está
> escrito como especificación de **comportamiento**, no de implementación: donde
> algo es una decisión de negocio que no se negocia va marcado **[REGLA]**, y
> donde es una elección técnica del portal original va marcado *(así lo hace hoy;
> cámbialo si tu plataforma pide otra cosa)*.

---

## 0 · Qué es esto

Portal web para una agencia de fianzas (**Fortex**). Dos mundos que comparten
base de datos y catálogos:

1. **El portal del cliente** — entra la empresa y ve lo suyo.
2. **El panel de Fortex** — entran los empleados y capturan/administran todo.

Y dentro del portal del cliente hay **dos clases de empresa que no se parecen**:

- **Fiado**: compra fianzas. Ve sus pólizas, sus obras, su expediente, su línea
  de crédito.
- **Contratante** (un desarrollador): **no compra ninguna, las exige**. Entra
  nada más a vigilar si sus proveedores ya presentaron la fianza.

**[REGLA]** Son **dos negocios, no dos niveles de permiso**. Sus rutas no se
cruzan: un fiado que entra a la pantalla del contratante recibe un 403 con un
mensaje que le dice a dónde ir, y al revés. Nunca "todo en ceros" —eso se lee
como que se le perdió la información.

---

## 1 · Modelo de dominio — los cuatro niveles

Es la parte que hay que tener clara antes de escribir una línea:

| | tabla | de quién es | quién lo captura |
|---|---|---|---|
| **Desarrollo** — la torre, el fraccionamiento | `desarrollos` | del **contratante** | él desde su portal, o Fortex por él |
| **Partida** — los muros, la electricidad | `partidas` | del **contratante** | él o Fortex |
| **Obra / contrato** — lo que le toca a un proveedor | `proyectos` | del **proveedor (fiado)** | solo Fortex |
| **Fianza / previo** | `fianzas` | del **proveedor (fiado)** | solo Fortex |

**[REGLA]** Son tablas distintas porque son cosas distintas: **una fianza la
presenta una empresa por un contrato, siempre**. El desarrollo es el techo, la
partida es el pedazo que se contrata por separado, y la obra es el contrato de un
proveedor.

**[REGLA]** La partida es el nivel donde de verdad **se exige** la fianza, y por
eso existe **antes** de saber quién la va a hacer: al montar el edificio se sabe
qué hace falta mucho antes de saber a quién se le da. De ahí sale un estado que
sin ella no se puede ni decir: `sin_contratista`.

**[REGLA] La cadena se deriva hacia arriba.** `proyectos` tiene tres columnas
(`partida_id`, `desarrollo_id`, `contratante_id`) y el servidor **no le cree al
body**: la partida fija el desarrollo, y el desarrollo fija el contratante.
Asignar un fiado a "muros" es, en una sola operación, decir de qué obra es y
quién la va a ver.

Tres columnas y no una, a propósito: si el permiso dependiera del desarrollo,
habría que rehacer toda la maquinaria de privacidad, y una obra ligada a un
contratante que todavía no tiene desarrollo dejaría de verse.
**`contratante_id` es lo único que autoriza; las otras dos son agrupación.**

De ahí salen tres reglas que parecen detalles y no lo son:

- **[REGLA]** Sacar una obra del desarrollo **no** la desliga del contratante:
  deja de estar agrupada, se sigue viendo. Aparece en "obras que todavía no están
  en ningún proyecto", porque desaparecerla se leería como que se perdió.
- **[REGLA]** Desligarla del contratante **sí** la saca del desarrollo y de la
  partida. Cambiarla de contratante, también. Cambiarla de desarrollo la saca de
  la partida, que era del anterior. Si no, quedaría dentro del proyecto de
  alguien que ya no la alcanza.
- **[REGLA]** Un cuerpo que se contradice (un desarrollo + un contratante que no
  es su dueño) se rechaza con **400**, no se deriva en silencio. Derivar callado
  hacía que "desliga esta obra" contestara *200 sin desligar nada*, porque el
  desarrollo volvía a poner al contratante de antes. **Una revocación que falla
  callada es lo peor que puede hacer una ruta de permisos.**

---

## 2 · Roles y permisos

### Cuentas de Fortex (`users.client_id IS NULL`)

|  | vendedor | operador | admin |
|---|---|---|---|
| Ver clientes | **solo su cartera** | todos | todos |
| Capturar obras, pólizas y documentos | solo su cartera | todos | todos |
| Dar de alta clientes y sus accesos | ❌ | ✅ | ✅ |
| Líneas de crédito | solo consultar | ✅ | ✅ |
| Catálogos (afianzadoras, tipos, documentos) | solo consultar | ✅ | ✅ |
| **Ligar una obra a un contratante** | ❌ | ✅ | ✅ |
| Cambiar el vendedor titular | ❌ | ✅ | ✅ |
| Cuentas de acceso | ❌ | ❌ | ✅ |
| Dar de baja una empresa | ❌ | ❌ | ✅ |

**[REGLA]** Reservarle al admin solo esas dos últimas es deliberado: son las que
**no se arreglan volviendo a capturar**.

**[REGLA]** Ligar una obra a un contratante requiere operador porque **le abre
las pólizas de un cliente a otra empresa y eso no se deshace**. Lo que ya vio, lo
vio. Es la misma razón por la que las líneas de crédito tampoco son del vendedor.

**[REGLA]** En cambio el padrón **sí** se le muestra completo al vendedor que
lleva la cuenta del desarrollador, y a propósito: necesita saber a qué proveedor
le falta la fianza, porque ahí está su venta. Puede hacerlo sin riesgo porque se
le muestra **exactamente la misma proyección que ve el contratante**, no el
expediente de esos proveedores.

- La cartera vive en `clients.vendedor_id` y puede apuntar a **cualquier** cuenta
  interna: un admin o un operador también llevan cuentas propias. Para ellos el
  campo no limita nada; para el vendedor es justo lo que lo acota.
- **[REGLA]** El correo de las cuentas internas debe ser del dominio de la casa
  (`DOMINIO_INTERNO`, por omisión `fortex.mx`). A los clientes **no** se les
  exige dominio: muchos contratistas usan Gmail o el correo personal del dueño.

### Cuentas de cliente (`users.client_id` lleno, `role = 'client'`)

Una empresa puede tener varias personas (dirección, contabilidad, obra) y
**todas ven lo mismo**. Se entra con el **correo**; el RFC se acepta como atajo
solo cuando la empresa tiene **una sola** cuenta activa (con varias, el RFC ya no
identifica a nadie en particular).

### Cómo se comprueba

**[REGLA]** El permiso se comprueba **en el servidor, en cada ruta**, nunca
escondiendo botones: ocultar algo en la pantalla no impide cambiar el id en la
URL, y por estas rutas pasan estados financieros y pólizas de terceros.

Ten un solo módulo `permisos` con:

- `exigirCliente(user, clientId)` → 404 si no existe, 403 si existe y no le
  toca. **La existencia se comprueba siempre, también para quien ve todo**: si no,
  un id equivocado sigue de largo y acaba subiendo el archivo al storage para
  reventar al guardarlo, dejando basura en la cuenta.
- `exigirEntidad(user, 'proyecto'|'fianza'|'documento', id)` — averigua de quién
  es y delega.
- `filtroCartera(user)` → fragmento de WHERE. **[REGLA]** Devuelve el fragmento
  vacío **solo** para quien de verdad ve todo; para cualquier otro rol lanza 403.
  Se dice quién **sí** alcanza, nunca quién no: con una lista de excepciones, el
  rol o el tipo de cuenta que se agregue mañana nace viendo el expediente de todo
  el mundo por el solo hecho de que nadie se acordó de escribirlo.
- Validar los ids de la URL **antes** de tocar la base (entero, 1..2147483647):
  un `'abc'` hacía que Postgres reventara con *"invalid input syntax for type
  integer"* y el manejador de errores devolvía **ese mensaje del motor** a la
  cuenta de otra empresa. Donde correspondía un 404 salía un 500 con detalle
  interno.
- **[REGLA]** El **tipo de cliente** (fiado / contratante) se pregunta a la base
  en cada petición y **no se lee del token**, que vive ocho horas: de eso depende
  qué se puede leer.

---

## 3 · Esquema de base de datos

Dialecto original: PostgreSQL.

**[REGLA] El dinero se guarda, se transporta y se suma siempre en centavos
enteros (`BIGINT`), nunca en punto flotante**: con montos de millones el float
pierde centavos y los totales dejan de cuadrar contra la afianzadora. El
formateo a pesos ocurre únicamente en la capa de presentación.

**[REGLA] Las fechas se manejan como texto ISO `yyyy-mm-dd`.** Nada de `Date` con
zona horaria; en México `toISOString()` recorre un día.

```
clients
  id, razon_social, rfc UNIQUE, telefono, linea_credito BIGINT,
  tipo TEXT CHECK (tipo IN ('fiado','contratante')) DEFAULT 'fiado',
  vendedor_id -> users(id) ON DELETE SET NULL,
  created_at

users
  id, client_id -> clients(id) ON DELETE CASCADE   (NULL = personal de Fortex),
  nombre, email UNIQUE, password_hash,
  role CHECK (role IN ('client','vendedor','operador','admin')),
  activo, created_at

client_proveedores            -- el PADRÓN
  id, contratante_id -> clients, proveedor_id -> clients,
  alias, notas, activo, created_at,
  UNIQUE(contratante_id, proveedor_id),
  CHECK (contratante_id <> proveedor_id)          -- nadie es su propio proveedor

desarrollos                   -- el proyecto del CONTRATANTE
  id, contratante_id -> clients ON DELETE CASCADE,
  nombre, clave, ubicacion, monto_inversion BIGINT,
  fecha_inicio, fecha_termino, estatus, notas, created_at

partidas                      -- los pedazos de obra del desarrollo
  id, desarrollo_id -> desarrollos ON DELETE CASCADE,
  nombre, alcance, monto_estimado BIGINT, orden, notas, created_at

partida_requisitos            -- QUÉ tipos de fianza exige esa partida
  id, partida_id -> partidas ON DELETE CASCADE,
  tipo_fianza_id -> tipos_fianza ON DELETE CASCADE,
  UNIQUE(partida_id, tipo_fianza_id)

proyectos                     -- la OBRA / contrato del proveedor
  id, client_id -> clients ON DELETE CASCADE,
  nombre, numero_contrato, beneficiario (texto libre), monto_contrato BIGINT,
  fecha_inicio, fecha_termino, estatus, notas, created_at,
  contratante_id -> clients      ON DELETE SET NULL,   -- LO ÚNICO que autoriza
  desarrollo_id  -> desarrollos  ON DELETE SET NULL,   -- agrupación
  partida_id     -> partidas     ON DELETE SET NULL    -- agrupación

fianzas
  id, client_id -> clients, proyecto_id -> proyectos ON DELETE RESTRICT,
  afianzadora_id -> afianzadoras, numero_poliza, tipo_fianza_id -> tipos_fianza,
  clase CHECK (clase IN ('fianza','previo')) DEFAULT 'fianza',
  prima_neta BIGINT, prima_total BIGINT, monto_afianzado BIGINT,
  fecha_inicio, fecha_vigencia,
  fecha_recordatorio, nota_recordatorio, recordatorio_atendido_el,  -- internos
  created_at

afianzadoras          id, nombre, slug UNIQUE, activo
tipos_fianza          id, nombre UNIQUE, orden, activo   -- baja lógica, nunca DELETE
client_credit_lines   id, client_id, afianzadora_id, linea_credito BIGINT,
                      UNIQUE(client_id, afianzadora_id)

documentos            -- polimórfica: archivos de una obra o de una fianza
  id, client_id (el DUEÑO, denormalizado),
  entidad_tipo CHECK IN ('proyecto','fianza'), entidad_id,
  tipo_doc, url, nombre_archivo, mime_type, size_bytes,
  subido_por ('fortex' | 'contratante' | 'proveedor'), subido_el

document_types        id, nombre, slug UNIQUE, periodicidad_meses, alerta_dias, orden
client_documents      -- EXPEDIENTE del fiado: un archivo vigente por tipo
  id, client_id, document_type_id, file_path, original_name, mime_type,
  size_bytes, uploaded_at, vencimiento, subido_por ('cliente'|'fortex'),
  UNIQUE(client_id, document_type_id)

papeleria_requests    id, client_id, afianzadora_id, fianza_id, descripcion,
                      estado, file_path, original_name, uploaded_at, created_at
notifications         id, client_id, tipo, ref_key, canal, mensaje, sent_at,
                      UNIQUE(client_id, tipo, ref_key)   -- idempotencia de avisos
password_resets       id, user_id, token_hash UNIQUE, expira_el, usado_el, created_at
```

Catálogo semilla de `tipos_fianza`: Anticipo, Cumplimiento, Buena calidad
(vicios ocultos), Sostenimiento de oferta, Arrendamiento, Fiscal, Concesión,
Fidelidad, Judicial, Crédito.

Notas de diseño que conviene respetar:

- **[REGLA]** `client_proveedores` es **tabla puente y no una columna
  `padre_id`**: el subcontratista eléctrico le trabaja a varios desarrolladores a
  la vez, y a veces además es cliente directo de Fortex. Con una columna habría
  que darlo de alta una vez por desarrollador, y duplicarlo significa duplicarle
  el expediente y las pólizas.
- **[REGLA]** `clients.tipo` es una columna y no una tabla aparte porque un
  contratante tiene la **misma ficha** que un fiado (razón social, RFC, teléfono,
  vendedor titular) y sus accesos se dan igual. Lo único que cambia es qué ve.
- **[REGLA]** `proyectos.beneficiario` (texto libre) **no** lo sustituye
  `contratante_id`, y no lo va a sustituir: la mayoría de las obras son para CFE,
  el IMSS o un municipio, que no tienen cuenta aquí y nunca la van a tener.
- `fianzas.proyecto_id` va `ON DELETE RESTRICT`: no se borra una obra con pólizas.
- `tipos_fianza` y `client_proveedores` se dan de **baja lógica**, nunca DELETE.
- **[REGLA]** El DDL tiene que ser **idempotente** (`CREATE TABLE IF NOT EXISTS`,
  `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` antes de recrearla). Lo
  que solo puede correr una vez (convertir montos, tirar columnas) va aparte, en
  migraciones numeradas.

---

## 4 · Fianzas y previos

**[REGLA]** Al capturar una póliza se elige si es **fianza** o **previo**. Son el
**mismo registro con los mismos campos**: un previo es lo que se cotizó y todavía
no emite la afianzadora. El día que emite se abre el renglón y se cambia
`clase` — **no se recaptura nada**.

**[REGLA] Un previo no es un pasivo.** Queda fuera de:

- el monto afianzado y las sumas de primas (panel y portal),
- el **comprometido** de la línea de crédito (no aparta capacidad),
- los avisos de vencimiento por correo,
- cualquier cálculo de cobertura del contratante.

Se cuenta **aparte** ("1 previo(s)") para que no parezca que falta algo
capturado. Su estado **es** "Previo": juzgarle vigencia no significa nada porque
sus fechas son las estimadas de la solicitud. En las tablas va con etiqueta
propia.

**[REGLA] Dos primas y no una.** La **neta** es la tarifa de la afianzadora; la
**total** es lo que el fiado acaba pagando (neta + derecho de póliza + IVA). El
fiado reclama por la total y la afianzadora reporta la neta: hacen falta las dos
para que los números cuadren contra el recibo.

### Estados por vigencia — dos funciones, no una

```
estadoFianza(fecha_vigencia)        -- para el FIADO y el panel
  sin fecha  -> 'activa'
  ya pasó    -> 'vencida'
  <= 30 días -> 'por_vencer'
  else       -> 'activa'

estadoCumplimiento(fecha_vigencia)  -- para la pantalla del CONTRATANTE
  sin fecha  -> 'sin_vigencia'      <-- LA ÚNICA DIFERENCIA
  el resto, igual
```

**[REGLA]** Son dos a propósito. "Sin fecha capturada" para el fiado es su propia
captura incompleta y él sabe lo que tiene; en la pantalla con la que un
desarrollador decide si deja entrar a un proveedor a la obra, **ese mismo
silencio pintado de verde es el falso positivo más caro que hay**.

---

## 5 · El contratante: qué ve y qué no

### El alcance — las dos condiciones, siempre pegadas

**[REGLA]** La unidad de permiso **no es el proveedor: es la obra**. Toda consulta
del contratante lleva **las dos** condiciones, nunca una sola:

```sql
JOIN client_proveedores cp
  ON cp.proveedor_id   = p.client_id
 AND cp.contratante_id = p.contratante_id
 AND cp.activo = 1                    -- el padrón, activo
WHERE p.contratante_id = ?            -- la obra, ligada
```

- Con **solo la de la obra**, suspender a un proveedor no le cerraría nada: se le
  quita del padrón y sigue viendo sus pólizas.
- Con **solo la del padrón**, se abren **todas** las obras del proveedor,
  incluidas las que hace para la competencia del contratante, con el monto del
  contrato adentro. Ese es exactamente el error que este diseño existe para no
  cometer.

Guárdalas como dos constantes exportadas del módulo de permisos, pegadas, para
que ninguna consulta pueda aplicar solo la mitad. Los **desarrollos** y las
**partidas** son la excepción: esos se autorizan por **propiedad directa** (son
suyos, los escribió él) y no dependen de ningún proveedor.

### La tabla de lo que ve

| Dato | ¿Lo ve el contratante? |
|---|---|
| Razón social y RFC del proveedor | ✅ |
| Obra ligada a él: nombre, contrato, monto, fechas, estatus | ✅ |
| Fianza: n° de póliza, tipo, afianzadora, monto afianzado, vigencia, estado | ✅ |
| Carátula, endoso y carta de liberación | ✅ |
| Lo **comprometido por su proyecto**, por proveedor y afianzadora | ✅ |
| **Prima neta y prima total** | ❌ es lo que le costó a su proveedor |
| **Recibo de prima** (el archivo) | ❌ dice lo mismo, en PDF |
| Línea de crédito autorizada / disponible del proveedor | ❌ |
| Expediente del proveedor (estados financieros, acta) | ❌ |
| Papelería y recordatorios internos de Fortex | ❌ |
| Las **otras** obras del proveedor | ❌ ni su existencia |
| Correos y accesos del proveedor | ❌ |

**[REGLA]** Nada de la columna derecha se selecciona y luego se borra del objeto
antes de responder: **no se pide nunca**. Las consultas del camino del contratante
enumeran columnas a mano; **no hay `SELECT *`** ahí.

**[REGLA]** El comprometido sí se le dice porque **no es información nueva**: es
la suma de los montos afianzados de las pólizas que ya ve una por una. Lo que
aporta es no sacar la calculadora — y por eso se pudo prender sin abrir nada. La
línea **autorizada** y el **disponible** sí son información del proveedor: se
quedan en el panel de Fortex, y **tampoco se le muestran al vendedor** que lleva
la cuenta del contratante, porque esos proveedores pueden ser clientes de otro
vendedor.

**[REGLA]** No hay líneas de crédito por proyecto: la afianzadora se la autoriza
a la **empresa**. Con una línea por proyecto, los mismos $5M aparecerían
disponibles en dos obras a la vez y el portal reportaría capacidad que no existe.

### Estados de cobertura

Una obra se juzga contra los requisitos de **su partida**:

```
estadoContraRequisitos(requisitos, fianzas):
  emitidas = fianzas sin previos
  sin emitidas                              -> 'sin_fianza'    (faltan todos)
  ninguna viva:
      alguna sin fecha de vigencia          -> 'sin_vigencia'
      else                                  -> 'vencida'
  hay vivas pero falta algún tipo exigido   -> 'incompleta'   (+ CUÁLES faltan)
  alguna viva por vencer                    -> 'por_vencer'
  todo lo exigido, vivo                     -> 'cubierta'
```

`sin_vigencia` se distingue de `vencida` porque lo primero lo arregla Fortex
(captura) y lo segundo el proveedor: se arreglan en lugares distintos.

**[REGLA] La unidad es el contrato, no la partida.** Evaluar los requisitos sobre
el montón de pólizas de la partida hacía que, con los muros partidos entre dos
empresas, la fianza de la primera tapara la falta de la segunda: la partida salía
cubierta con un contratista trabajando sin nada.

La **partida** se juzga a partir de sus contratos ya juzgados:

- sin contratos → `sin_contratista`
- si no, el **peor** de sus contratos; los faltantes son la unión sin repetir
  (decir dos veces "Anticipo" porque dos empresas lo deben no ayuda a nadie).

Orden de peor a mejor, **por riesgo y no por incomodidad**:

```
cubierta < por_vencer < sin_contratista < incompleta < sin_vigencia < vencida < sin_fianza
```

**[REGLA]** `sin_contratista` va temprano a propósito: que nadie esté haciendo
los muros todavía no expone a nadie; un contratista trabajando sin fianza sí. Si
estuviera al final, un proyecto con una partida sin contratar y otra sin fianza
gritaría "sin contratista" y taparía justo lo único que sí es un riesgo vivo.

**[REGLA]** `sin_contratista` se cuenta **aparte** de las descubiertas: es un
pendiente del desarrollador, no un proveedor que incumplió. Meterlos en el mismo
número haría que la pantalla acusara a alguien que ni existe.

**[REGLA]** El cumplimiento de un proveedor —o de un desarrollo— es el de su
**peor pedazo vivo**: tener una parte cubierta no arregla la que está descubierta.

### Las dos etiquetas verdes

| lo que se sabe | etiqueta | por qué |
|---|---|---|
| hay póliza vigente, **nadie dijo qué se exigía** | **Con fianza** | es todo lo que se puede afirmar |
| hay vigente **cada** tipo que la partida exige | **Cubierta** | ahora sí se comprobó contra algo |

**[REGLA]** Prometer completitud sin saber qué se exige es el mismo falso OK con
otro nombre. El chip recibe un `verificada` y un proyecto entero solo dice
"Cubierta" si **todas** sus partidas declararon requisitos: basta una sin ellos
para que no se pueda prometer.

**[REGLA]** El contador de pendientes del titular suma las **partidas
descubiertas** más las **obras vivas que no están en ninguna partida**. Las dos
mitades hacen falta: contando solo obras vuelve el falso OK, y contando solo
partidas desaparece una obra que Fortex ligó sin asignarle partida. **Cambiar de
unidad no puede esconder un faltante.**

**[REGLA]** Los requisitos se marcan contra el **mismo catálogo `tipos_fianza`
que usan las pólizas**. Si fuera otra lista, una partida podría exigir algo que
ninguna póliza puede cumplir.

### Obras vivas

```
ESTATUS_VIVOS = ['en_proceso', 'terminado', 'entregado']
```

**[REGLA]** Una obra **cerrada o cancelada** se le sigue mostrando al
contratante, pero **sin chip de cumplimiento y sin tinte rojo**: en su lugar se
dice el estatus. No hay cobertura que exigirle a una obra que terminó, y pintarla
en rojo llenaría la pantalla de pendientes de hace tres años.

**[REGLA] Terminadas y entregadas SÍ cuentan**, y es deliberado: ahí es donde
vive la fianza de vicios ocultos, que es justo la que se olvida. Por eso la
pantalla dice "obras **vigentes**" y no "obras en curso" — el conjunto no es el
mismo.

Un proveedor cuyas obras con ese contratante están todas cerradas sale como
**"Obras cerradas"**, no como "Sin obra": lo segundo diría que falta capturar
algo, y no falta nada.

### Suspender, no borrar

**[REGLA]** Para dejar de trabajar con un proveedor se **suspende**
(`activo = 0`): el contratante deja de ver sus obras en el mismo instante —el
`activo` es una de las dos condiciones del alcance— y queda el historial de lo que
sí presentó. En el panel aparece en una sección aparte con botón para
reactivarlo, y reactivarlo **no** borra el alias ni las notas que el contratante
tenía escritas.

Borrar la fila es otra cosa: es para la liga que nunca debió existir (se agregó al
padrón equivocado). Se niega mientras haya obras ligadas, y **no borra la
empresa**.

**[REGLA]** Suspender **no** desliga las obras. Una obra que sigue apuntando a un
contratante que ya suspendió a ese proveedor queda colgada —no se ve del lado del
contratante, pero existe—, y por eso en el detalle del fiado ese renglón se pinta
en gris con la palabra "suspendido", en vez de afirmar que el contratante está
viendo esas fianzas.

### El hueco que hay que decir en voz alta

**[REGLA]** El portal solo sabe de las fianzas que **colocó Fortex**. Un proveedor
que contrató la suya con otro agente aparece igual en la lista, así que la
etiqueta dice **"Sin registro"** y **no "Sin fianza"**, y la pantalla lo explica
al pie. Acusar en falso a un proveedor que sí cumplió es la forma más rápida de
que el desarrollador cierre el portal y vuelva al Excel.

Lo que sí se puede es **guardar el papel**: el contratante (o Fortex) sube el PDF
que el proveedor entregó a la carpeta de la obra. Es media solución a propósito:
el papel prueba que la presentó, pero el portal sigue sin poder juzgarle vigencia
ni sumarla.

---

## 6 · Documentos y archivos

### Los tres catálogos

```
TIPOS_DOC.proyecto   (papeles del PROVEEDOR sobre su obra)
  contrato, convenio_modificatorio, acta_entrega_recepcion,
  fallo_licitacion, otro

TIPOS_DOC.fianza
  caratula, endoso, carta_liberacion, recibo_prima, otro

TIPOS_DOC_CONTRATANTE (la carpeta del contratante sobre esa misma obra)
  fianza_presentada, contrato_proveedor, otro_contratante
```

**[REGLA] Lista blanca de lo que el contratante puede descargar:**
`['caratula', 'endoso', 'carta_liberacion']`. Es blanca y no negra por la misma
razón que la lista de roles: el tipo que se agregue mañana nace cerrado. Queda
fuera `recibo_prima` (dice cuánto le cobró la afianzadora al proveedor, es el
dato con el que se le negociaría a la baja — sin la lista, la carátula y el
recibo se bajaban por la misma puerta), `otro` (por definición, un archivo que
nadie clasificó) y todo lo del proyecto (pueden traer condiciones que el
desarrollador no tiene por qué leer). Si algún día se abre alguno, se abre **en
ese único lugar**.

### Dos carpetas sobre la misma obra

**[REGLA]** En `documentos` con `entidad_tipo = 'proyecto'` conviven **dos**
carpetas y lo único que las distingue es `client_id`:

- los papeles del **proveedor** (contrato, convenios, actas) — el contratante no
  los ve;
- la carpeta del **contratante** ("Documentos que recibiste") — el proveedor no
  los ve.

Cualquier consulta que lea documentos de un proyecto **tiene que decidir cuál de
las dos quiere**.

**[REGLA]** `documentos.client_id` es el **dueño**: para lo que sube el
contratante, el dueño es el contratante, no el proveedor de la obra. Así el
archivo vive bajo *su* prefijo de storage y no hay que aflojar la regla del
prefijo. Consecuencias: el proveedor no ve esos archivos, el contratante solo
puede borrar los suyos, y si se da de baja su cuenta se van con él.

**[REGLA]** `documentos.client_id` **no sirve para autorizar** una descarga del
contratante: está denormalizado para filtrar por dueño, y usarlo ahí entregaría
los papeles de las obras que el proveedor hace para otros. Hay que subir por el
proyecto: documento → fianza → proyecto → alcance.

**[REGLA] Los dos lados pueden subir a la carpeta del contratante** (él desde su
portal, Fortex desde el panel), porque en la práctica el proveedor le entrega el
papel al desarrollador o directo a Fortex, y las dos cosas pasan. Queda
registrado el `subido_por` para que en pantalla se sepa quién lo consiguió.

**[REGLA] Un PDF en esa carpeta NO es una póliza.** No suma en el monto
afianzado, no cuenta como cobertura y no aparece como producción de Fortex. Una
obra puede decir "Sin registro" y al mismo tiempo tener el PDF adentro: son dos
cosas distintas, y confundirlas metería en las cifras de Fortex pólizas que no
son suyas.

**[REGLA]** Dar de baja a un cliente tiene que llevarse también los archivos que
el contratante colgó de sus obras: la tabla es polimórfica y borrar el proyecto
no los limpia solo.

### Expediente del fiado

`client_documents`, un archivo **vigente** por tipo (`UNIQUE(client_id,
document_type_id)`): al renovarlo se reemplaza. El vencimiento se calcula sumando
`periodicidad_meses` a hoy.

**[REGLA]** Dos puertas al mismo lugar —el fiado sube desde su portal, Fortex lo
carga cuando llega por correo— y las dos deben dejar el registro **idéntico**,
cambiando solo `subido_por`. Vive en un servicio compartido, no dentro de una
ruta.

Estados: `pendiente` (no subido), `al_dia`, `por_vencer` (dentro de
`alerta_dias`), `vencido`.

### Subida directa al storage *(así lo hace hoy; adáptalo)*

El archivo **no pasa por el servidor**, porque la plataforma corta el cuerpo de
cada petición en ~4.5 MB (medido: 4 MB pasa, 4.5 MB revienta):

1. El navegador pide una **firma** con el `client_id` al que pertenece el
   archivo. Ahí se comprueba el permiso y se firma un `public_id` **concreto**
   bajo la carpeta de ese cliente. El secreto nunca sale del servidor.
2. El navegador sube directo al storage.
3. Le avisa a la API **dónde quedó**, y la API le pregunta al storage la URL y el
   peso: **no se le cree al navegador** ni una cosa ni la otra.

Dos reglas que no conviene aflojar:

- **[REGLA]** El `public_id` tiene que caer bajo el prefijo del cliente correcto.
  Si no, una firma legítima serviría para colgarle el archivo a otro fiado. Un
  usuario de portal **solo puede firmar para su propio `client_id`** — eso es
  exactamente lo que hace segura la subida del contratante.
- **[REGLA]** Todo lo que se pueda validar sin tocar el archivo se valida
  **antes** (formato, tipo de documento, permisos): cuando llega la petición de
  registro el archivo ya está en el storage, y cada rechazo tardío deja basura en
  la cuenta.

Formatos: PDF, JPG, PNG, XLSX, XLS, DOCX, DOC. Máximo 10 MB. *(Excel y Word
porque los estados financieros llegan en Excel y las actas en Word; si no se
admiten, el fiado no tiene cómo entregarlos.)*

**[REGLA] El cliente nunca recibe la URL del archivo**: la descarga pasa por la
API, que comprueba el dueño (o el alcance, si es el contratante) y redirige. Y la
ruta de descarga del panel **no** redirige a cualquier URL que le pasen: el
archivo tiene que estar registrado en la base y quien lo pide, alcanzar a su
dueño.

---

## 7 · Endpoints

*(Rutas del portal original; conserva la forma aunque cambie el transporte.)*

### Auth
```
POST /api/auth/login            { usuario (email o RFC), password } -> token
POST /api/auth/recuperar        { email }   -> siempre la misma respuesta
POST /api/auth/restablecer      { token, password }
GET  /api/auth/me
```

### Portal del FIADO
```
GET  /api/dashboard                       métricas + alertas
GET  /api/fianzas?afianzadora_id&proyecto_id
GET  /api/fianzas/afianzadoras
GET  /api/fianzas/proyectos
GET  /api/fianzas/documentos/:id          descarga (comprueba dueño)
GET  /api/documentos                      expediente + estados
POST /api/documentos/:typeId              sube / reemplaza
GET  /api/documentos/descargar/:typeId
GET  /api/documentos/papeleria
POST /api/documentos/papeleria/:id        responde una solicitud
```

### Portal del CONTRATANTE
```
GET    /api/proveedores                   padrón + métricas (SIN las obras)
GET    /api/proveedores/:id               un proveedor: sus obras y pólizas
GET    /api/proveedores/proyectos         sus desarrollos + obras sin proyecto
POST   /api/proveedores/proyectos
PUT    /api/proveedores/proyectos/:id
DELETE /api/proveedores/proyectos/:id     se niega si tiene obras adentro
GET    /api/proveedores/proyectos/:id     un desarrollo con sus partidas
POST   /api/proveedores/proyectos/:id/partidas
PUT    /api/proveedores/partidas/:id
DELETE /api/proveedores/partidas/:id
GET    /api/proveedores/tipos-fianza      el MISMO catálogo que las pólizas
GET    /api/proveedores/tipos-documento
POST   /api/proveedores/obras/:obraId/documentos
DELETE /api/proveedores/documentos/:id    solo los suyos
GET    /api/proveedores/documentos/:id    descarga (lista blanca + alcance)
```

**[REGLA]** El padrón **no manda las obras**: la pantalla solo pinta el renglón de
cada proveedor y sus cifras, y las obras se piden al abrirlo. Con cuarenta
proveedores eso era casi el 90% del peso de la respuesta viajando para que nadie
lo leyera.

**[REGLA]** El contratante **no puede asignarse proveedores ni ligar obras**: eso
lo hace Fortex. Ligar una obra le abre las pólizas de otra empresa.

**[REGLA]** El panorama del contratante se arma con **pocas consultas y el pegado
en memoria**, no con una consulta por proveedor: con cuarenta proveedores serían
cuarenta viajes a la base para pintar una pantalla. Y el detalle de un proveedor
sale **del mismo panorama, filtrando**, para que el WHERE que define el alcance
viva en **un solo lugar**.

### Panel de Fortex
```
GET    /api/admin/clientes                 lista con cifras de alarma
POST   /api/admin/clientes                 [operador] alta + primer acceso
PUT    /api/admin/clientes/:id             [operador]
DELETE /api/admin/clientes/:id             [admin] baja de la empresa
PUT    /api/admin/clientes/:id/vendedor    [operador]
PUT    /api/admin/clientes/:id/tipo        [operador] fiado <-> contratante
GET    /api/admin/clientes/:id/detalle     TODO lo del cliente

       .../proyectos                  GET POST PUT DELETE   (obras del fiado)
       .../proyectos/:pid/partidas    GET POST
       .../partidas/:paid             PUT DELETE
       .../proveedores                POST PUT DELETE [operador]  (padrón)
       .../lineas                     PUT / DELETE :afianzadoraId [operador]
       .../documentos/:typeId         POST DELETE           (expediente)
       .../obras/:obraId/documentos   POST                  (carpeta del contratante)

POST   /api/admin/proyectos        PUT /:id   DELETE /:id
POST   /api/admin/fianzas          PUT /:id   DELETE /:id
PUT    /api/admin/fianzas/:id/recordatorio
GET    /api/admin/recordatorios
GET    /api/admin/afianzadoras     POST [operador]
GET    /api/admin/tipos-fianza     POST DELETE [operador]   (baja lógica)
GET    /api/admin/tipos-documento
GET    /api/admin/documentos-requeridos  POST PUT DELETE [operador]
POST   /api/admin/(proyectos|fianzas)/:id/documentos
GET    /api/admin/documentos/:id/archivo    DELETE /api/admin/documentos/:id
POST   /api/admin/papeleria
GET    /api/admin/descargar?path=<url>
GET    /api/admin/usuarios/internos [operador]
POST   /api/admin/usuarios   PUT /:id   DELETE /:id   DELETE /:id/permanente [admin]

POST   /api/subidas/firma          la firma de subida (fiado, contratante y Fortex)
POST   /api/alertas/correr         dispara el motor de avisos
GET    /api/health                 GET /api/setup?key=...   (DDL idempotente)
```

**[REGLA]** El middleware **no** protege `/api` en bloque. Cada handler se
autentica solo: los `GET` con el helper de lectura, los `POST/PUT/DELETE` con el
de escritura.

**[REGLA]** El detalle de un **contratante** se contesta con **exactamente la
misma proyección que ve él en su portal**, no con el expediente completo de sus
proveedores. Es lo que hace segura esa pantalla para un vendedor. Los proveedores
**suspendidos** van en una lista aparte, y solo para Fortex: el contratante no
los ve, pero el operador necesita poder reactivarlos (si no, suspender sería una
puerta de un solo sentido).

---

## 8 · Cifras

### Dashboard del fiado
`linea_disponible`, `linea_credito_total`, `lineas[]` (por afianzadora:
autorizada / comprometido / disponible), `fianzas_activas`,
`previos_en_tramite`, `monto_afianzado_total`, `suma_prima_neta`,
`suma_prima_total`, `fianzas_por_vencer`, `proyectos_activos`; y alertas de
`documentos_pendientes` y `papeleria_pendiente`.

**[REGLA]** El **comprometido** por afianzadora suma el monto afianzado de las
pólizas **emitidas y no vencidas**. Un previo no aparta; una vencida ya liberó.
*(En la pantalla del contratante hay una diferencia deliberada: ahí una póliza
sin fecha de vigencia tampoco aparta nada, porque su estado sale de
`estadoCumplimiento`.)*

### Detalle del cliente en el panel
Por obra: sus fianzas y previos juntos en la tabla, pero los totales de dinero
solo con las emitidas; `monto_afianzado` (vigentes), `suma_prima_neta`,
`suma_prima_total`, y `pct_contrato_afianzado` (qué tanto del contrato está
respaldado). Se trae el nombre del contratante ligado: es lo que le dice al
operador *"ojo, las pólizas de esta obra las está viendo Desarrollos Delta"*.

### Lista de clientes del panel
Por cliente: total de accesos, proveedores en su padrón, padrones en los que
está, obras, fianzas, previos, por vencer, vencidas, recordatorios pendientes,
docs pendientes, papelería pendiente, y **obras descubiertas** (solo
contratantes).

**[REGLA]** A un contratante **no** se le calculan expediente ni papelería: le
pintaría "5 documento(s) faltante(s)" por papeles que nadie le va a pedir nunca,
y la alerta prendida para siempre. Aun así **la forma del objeto es la misma para
las dos clases** (los campos que no aplican van en 0): al front le toca pintar, no
averiguar qué campos existen.

**[REGLA]** La cifra de obras descubiertas de la lista lleva el alcance
**completo** (las dos mitades), no una copia a mano de la mitad: escrita sin el
padrón contaba obras de proveedores ya suspendidos, y la lista prendía la alerta
por un pendiente que el detalle decía que no existía (y que el contratante,
correctamente, tampoco veía).

**[REGLA]** La condición que enciende el punto de alerta se escribe **una sola
vez** y la usan el punto y el filtro, para que no puedan discrepar.

---

## 9 · Correo

### Recuperación de contraseña
- Enlace que vence en **una hora**, de **un solo uso**; pedir uno nuevo invalida
  el anterior.
- **[REGLA]** En la base se guarda solo el **hash** del token: quien pueda leer
  esa tabla —o un respaldo— no puede entrar a ninguna cuenta con lo que vea ahí.
- **[REGLA]** Pedir el enlace responde **lo mismo exista o no la cuenta**. Si
  contestara distinto, cualquiera podría ir probando correos para averiguar
  quiénes son clientes de la agencia.
- **[REGLA]** Que haya una forma de **verificar las credenciales SMTP sin mandarle
  nada a nadie**. Así no se descubre que el correo está mal el día que alguien de
  verdad olvidó su contraseña.

### Motor de alertas
Corre bajo demanda o por cron diario. Avisa de fianzas que vencen en ≤ 30 días,
documentos del expediente por vencer o vencidos, y papelería pendiente.

- **[REGLA]** Solo a **fiados**: un contratante no compra fianzas ni tiene
  expediente, así que recorrerlo sería un montón de consultas para no mandar nada.
- **[REGLA]** Solo pólizas **emitidas**: avisarle que "vence" un previo es un
  correo que no puede atender.
- **[REGLA]** El aviso va a **todas las cuentas activas** de la empresa, no a "el
  correo del cliente": el papel lo puede resolver cualquiera de ellos.
- **[REGLA]** Cada evento se manda **una sola vez** (`UNIQUE(client_id, tipo,
  ref_key)`). Y si no hay a quién avisarle, **no se marca como enviado**: si
  mañana le dan de alta un usuario, el aviso todavía le puede llegar.

---

## 10 · Pantallas

### Portal del fiado
- **Mis fianzas** — filtro por afianzadora y por obra; cada póliza con estado,
  días para vencer y sus documentos. Los previos, marcados.
- **Documentos** — expediente con su estado por tipo, y la papelería que Fortex le
  pidió.

### Portal del contratante
- **Mis proyectos** — sus desarrollos, cada uno con sus partidas, el estado de
  cobertura de cada una y **qué tipo de fianza falta**; abajo, las obras que
  Fortex le ligó y que todavía no están en ningún proyecto.
- **Proveedores** — el padrón, un renglón por proveedor con su peor estado. Al
  abrir uno: sus obras con este contratante, las pólizas de cada una, lo
  comprometido por afianzadora y la carpeta "Documentos que recibiste".

### Panel de Fortex
- Lista de clientes con buscador, punto de alerta y filtro de pendientes.
- Detalle del cliente en pestañas: **Obras y crédito**, **Papeles**, **Accesos**.
  Para un contratante, en su lugar: su padrón, sus proyectos y sus partidas, con
  la asignación de contratista a cada partida.
- Configuración: afianzadoras, tipos de fianza, documentos requeridos, personal.
- Bandeja de recordatorios de pólizas (fecha + nota + marcar atendido).

**[REGLA] La UI esconde lo que no se puede hacer** en vez de pintar botones
grises o `disabled`: donde había acción va la etiqueta "Solo lectura". Y esconder
no es seguridad — el servidor decide igual.

**[REGLA]** Si una carga falla hay que **decirlo**. El error tragado que deja la
pantalla en "(0)" se lee como "no hay nada" en vez de "no se pudo consultar", y
hace pensar que lo que se guardó se perdió.

**[REGLA]** Los avisos del tipo *"quedó ligada PERO el contratante todavía no la
ve"* **no** van en el banner verde de éxito con su palomita, que dice lo
contrario del texto: van en ámbar y **sin caducidad**, se cierran a mano.

**[REGLA]** El formulario limpia el proyecto al cambiar de contratante, **y**
el servidor rechaza el par imposible. Guarda en los dos lados.

---

## 11 · Pruebas que hay que escribir

Una por cada regla que costó caro. Las que no pueden faltar:

1. **Aislamiento del contratante** — recorrer el **JSON completo** de todas sus
   respuestas y fallar si aparece **cualquier** llave de una lista prohibida
   (`prima_neta`, `prima_total`, `linea_credito`, `fecha_recordatorio`…). No
   revisar campos sueltos: así, el día que alguien le agregue una columna a
   `fianzas`, se entera en la prueba y no en la pantalla de un cliente.
2. Un contratante **no ve** las obras del mismo proveedor para otro contratante,
   ni las que no están ligadas a nadie.
3. Suspender a un proveedor **le cierra el acceso en el mismo instante**;
   reactivarlo conserva alias y notas; borrar la liga se niega si hay obras.
4. **Los previos** no suman en monto afianzado, no consumen línea, no disparan
   avisos y no cuentan como cobertura.
5. **Derivación de la cadena**: la partida fija el desarrollo y el desarrollo el
   contratante; un cuerpo contradictorio se rechaza con 400; desligar del
   contratante limpia desarrollo y partida; sacar del desarrollo **no** desliga.
6. **Requisitos**: una obra con cumplimiento y sin anticipo sale `incompleta` y
   dice cuál falta; una partida con dos contratistas no se da por cubierta con la
   fianza de uno solo; sin requisitos capturados dice "Con fianza", no "Cubierta".
7. **Permisos internos**: el vendedor no alcanza clientes fuera de su cartera, no
   liga obras a contratantes y no ve las líneas de los proveedores de su
   contratante.
8. **Subidas**: no se puede firmar para otro `client_id`; el formato se rechaza
   antes de subir; la URL y el peso se leen del storage, no del body.
9. **Baja de un cliente**: se lleva los archivos que el contratante colgó de sus
   obras.
10. **Migraciones idempotentes**: el DDL corre dos veces seguidas sin tronar, y
    arrancar contra una base vacía funciona.
11. **Errores HTTP**: un id inválido en la URL contesta 404, nunca un 500 con el
    mensaje del motor de base de datos.

---

## 12 · Lo que el portal original NO hace (decídelo tú)

- No registra las fianzas que el proveedor colocó **con otro agente**. Pide un
  tercer valor en `fianzas.clase` (una póliza que se vigila pero no es producción
  de Fortex) y revisar todos los lugares donde `clase` decide si algo suma.
  Mientras no exista, la lista de "sin registro" es la lista de prospectos.
- No le avisa por correo **al contratante** cuando la fianza de su proveedor está
  por vencer. Hoy el aviso le llega solo a quien la compró, que es el que ya lo
  sabe. Es probablemente lo que más valor agregaría.
- El contratante no puede **pedirle a Fortex que asigne** un proveedor desde su
  portal. Sería una solicitud, no un alta directa: ligar una obra abre las
  pólizas de otra empresa.
- No hay **histórico de documentos**: cada tipo guarda un archivo vigente y al
  renovarlo se reemplaza (no queda el del año pasado).
- No hay **estado de pago de la prima** (pagada / pendiente, fecha y recibo).
- No se puede **cambiar la propia contraseña estando dentro** (se repone
  olvidándola, o pidiéndoselo a un administrador).
- No ayuda a **ligar obras viejas** a su contratante a partir del campo de texto
  `beneficiario`. Si se hace: proponer coincidencias para que un operador las
  confirme, **nunca** aplicarlas solas — ligar de más abre información.

---

## 13 · Cómo trabajar

- Interfaz, comentarios y mensajes de commit **en español**, tuteando y sin jerga
  técnica: "Dar de baja", no "Desactivar registro".
- Comenta **el porqué**, no el qué. Estas reglas se ven arbitrarias sin la
  historia que las produjo; escríbela junto al código o alguien la deshará.
- Folios, pólizas, RFC y números de contrato en **fuente monoespaciada**; cifras
  con `tabular-nums`.
- Formatos: `Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' })`
  y `Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })`.
- Fechas que vienen de la base: recórtalas con `String(d).slice(0, 10)`, **nunca**
  con `toISOString()`.

---

## 14 · Datos de demostración

Siembra un escenario que traiga todos los casos de una vez:

- Una constructora con **dos cuentas de acceso** (dirección y contabilidad), para
  ver que varias personas comparten la información de la empresa.
- Una empresa con **una sola cuenta**, que entra también con su RFC.
- Un **contratante** con **dos desarrollos**: uno con tres proveedores dentro y
  otro recién capturado, **sin nadie asignado** (sale "Sin obra": captura que
  falta, no incumplimiento).
- Dentro del primero, los tres casos: un proveedor **con fianza vigente**, uno con
  una que **vence en veinte días**, y uno con obra en proceso y **ninguna
  fianza** — el renglón que el desarrollador quiere cazar.
- Ese tercero **sin cuenta de acceso**, para ver que un proveedor puede vivir en
  el padrón sin entrar nunca al portal.
- **El caso que hace demostrable el aislamiento**: uno de esos proveedores tiene
  además **otra obra, para un tercero que no es contratante del portal**, con su
  propia póliza. El desarrollador **no la ve**, aunque el proveedor esté en su
  padrón. Si algún día se ve, se rompió el alcance.
- Un vendedor que lleva **una sola cuenta**, para comprobar el alcance de cartera.
