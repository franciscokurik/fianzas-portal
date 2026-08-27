# Portal de Fianzas · Fortex

Portal web para que los clientes de Fortex consulten y gestionen sus fianzas, con
panel de administración para el equipo de Fortex.

Hay **dos clases de cliente**: el **fiado**, que compra fianzas, y el
**contratante** —un desarrollador— que no compra ninguna y entra a vigilar la
fianza que le presentan sus proveedores.

## Stack (MVP)

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Node.js + Express (función serverless en Vercel)
- **Base de datos:** PostgreSQL (Neon / Vercel Postgres)
- **Auth:** JWT + bcryptjs
- **Archivos:** Cloudinary (`server/src/lib/upload.js`)
- **Email:** Nodemailer (modo consola en MVP; listo para SendGrid)

> Diseñado para escalar: la base de datos, el almacenamiento de archivos y el email
> están aislados en módulos para poder cambiar de proveedor sin reescribir.

## Almacenamiento de archivos (Cloudinary)

Todo lo que se sube —carátulas de fianzas, contratos de obra, expediente del
fiado— va a Cloudinary. Para habilitarlo basta una variable de entorno:

1. Crea una cuenta en [cloudinary.com](https://cloudinary.com) (el plan gratuito
   alcanza de sobra: 25 GB de almacenamiento).
2. En **Settings → API Keys** copia el valor de *API environment variable*.
3. Ponlo como `CLOUDINARY_URL` en Vercel (*Project Settings → Environment
   Variables*) y en tu `.env` local. Vuelve a desplegar.

Si prefieres no armar la URL, funcionan igual las tres variables sueltas
(`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`); con
`CLOUDINARY_URL` definida, esas tres se ignoran.

### El archivo no pasa por el servidor

Vercel corta el cuerpo de cada petición en ~4.5 MB, así que subir a través de la
API topaba ahí (medido: 4 MB pasa, 4.5 MB devuelve FUNCTION_PAYLOAD_TOO_LARGE).
Por eso el navegador sube **directo a Cloudinary**:

1. Pide una firma a `POST /api/subidas/firma` con el cliente al que pertenece el
   archivo. Ahí se comprueba que quien pide pueda subir para ese fiado, y se
   firma un `public_id` **concreto** bajo la carpeta de ese cliente. El
   `api_secret` nunca sale del servidor.
2. El navegador sube el archivo a Cloudinary con esa firma.
3. Le avisa a la API **dónde quedó**, y la API le pregunta a Cloudinary la URL y
   el peso: no se le cree al navegador ni una cosa ni la otra.

De ahí salen dos reglas que conviene no aflojar: el `public_id` tiene que caer
bajo el prefijo del cliente correcto (si no, una firma legítima serviría para
colgarle el archivo a otro fiado), y todo lo que se pueda validar sin tocar el
archivo se valida ANTES —el tipo de documento, los permisos—, porque cuando la
petición llega el archivo ya está en Cloudinary y cada rechazo tardío deja
basura en la cuenta.

### Compartir la cuenta con otro proyecto

Se puede, y no hace falta configurar nada extra: todo lo del portal cae bajo
`fortex-fianzas/client_<id>/<timestamp>_<archivo>`, así que no se revuelve ni
puede pisar archivos ajenos, y el borrado va por el `public_id` exacto que se
deduce de la URL guardada en la base (lo que no está en la base, el portal no lo
puede tocar). Lo que sí se comparte es la cuota del plan y **la credencial**: si
un día hay que rotar el secret, se rompen los dos proyectos a la vez. Si el otro
proyecto lo administra alguien más, mejor una cuenta aparte solo para el portal.
Para separar entornos (pruebas vs. producción) en una misma cuenta, usa
`CLOUDINARY_FOLDER`.

Detalles que conviene saber:

- Los archivos se suben como `resource_type: raw` **a propósito**: el portal no
  transforma imágenes, y con `image` los PDF dependen del interruptor
  *PDF and ZIP files delivery*, que Cloudinary trae apagado en las cuentas
  nuevas (el archivo sube bien y al abrirlo devuelve 401).
- Formatos aceptados: PDF, JPG, PNG, Excel y Word. Máximo **10 MB** por archivo.
- Los documentos que se subieron antes de esta migración siguen en Vercel Blob y
  se sirven igual. Si quieres que al reemplazarlos se borre también el archivo
  viejo, deja `BLOB_READ_WRITE_TOKEN` configurada.
- El fiado nunca recibe la URL del archivo: la descarga pasa por la API, que
  comprueba que el documento sea suyo.

## Estructura

```
fianzas-portal/
  server/          API Express
    src/
      routes/      auth, dashboard, fianzas, documentos, proveedores, admin
      services/    email, alerts
      lib/         dates, upload
      db.js        capa SQLite (node:sqlite)
      schema.sql   esquema
      seed.js      datos de demo
  client/          App React (Vite)
    src/
      pages/       Login, Dashboard, Proveedores, Admin
      components/   MisFianzas, Documentos
```

## Cómo correr

Necesitas **dos terminales** (o usar el preview integrado).

### 1) Backend

```powershell
cd server
copy .env.example .env      # ajusta JWT_SECRET
npm install
npm run seed                # carga afianzadoras, tipos de doc y datos de demo
npm start                   # http://localhost:4000
```

### 2) Frontend

```powershell
cd client
npm install
npm run dev                 # http://localhost:5173
```

Abre http://localhost:5173

## Usuarios, clientes y carteras

Una **empresa** (`clients`) y una **cuenta de acceso** (`users`) son cosas
distintas:

- Una constructora puede tener varias personas dadas de alta (dirección,
  contabilidad, residencia de obra). Cada una entra con su correo y **todas ven
  lo mismo** de su empresa.
- Las cuentas de Fortex no pertenecen a ninguna empresa. Hay tres niveles, de
  menos a más permiso:

  | | vendedor | operador | admin |
  |---|---|---|---|
  | Ver clientes | **solo su cartera** | todos | todos |
  | Capturar proyectos, pólizas y documentos | solo su cartera | todos | todos |
  | Dar de alta clientes y sus accesos | ❌ | ✅ | ✅ |
  | Líneas de crédito | solo consultar | ✅ | ✅ |
  | Catálogos (afianzadoras, tipos, documentos) | solo consultar | ✅ | ✅ |
  | Cambiar el vendedor titular de una cuenta | ❌ | ✅ | ✅ |
  | Cuentas de acceso | ❌ | ❌ | ✅ |
  | Dar de baja una empresa | ❌ | ❌ | ✅ |

  Reservar al admin solo esas dos últimas es deliberado: son las que **no se
  arreglan volviendo a capturar**.

- Cada cuenta tiene un **vendedor titular** (`clients.vendedor_id`), que puede ser
  **cualquier** cuenta interna: un admin o un operador también llevan cuentas
  propias. Para ellos el campo no limita nada (de todas formas ven todo); para el
  vendedor es justo lo que lo acota. Una cuenta cuyo titular es el admin **no** se
  le aparece al vendedor.
- El correo de las cuentas de Fortex tiene que ser del dominio de la casa
  (`DOMINIO_INTERNO`, por omisión `fortex.mx`). A los fiados **no** se les exige
  dominio a propósito: muchos contratistas usan Gmail o el correo personal del
  dueño.

Se entra con el **correo**. El RFC se sigue aceptando como atajo, pero solo
cuando la empresa tiene una sola cuenta activa: con varias personas, el RFC ya
no identifica a nadie en particular.

> El permiso se comprueba en el servidor en **cada** ruta (`lib/permisos.js`), no
> escondiendo botones: ocultar algo en la pantalla no impide cambiar el id en la
> URL, y por estas rutas pasan estados financieros de terceros.

## Fianzas y previos

Al capturar una póliza se elige si es **fianza** o **previo**. Son el **mismo
registro con los mismos campos**: un previo es lo que se cotizó y todavía no
emite la afianzadora. El día que emite, se abre el renglón y se cambia esa
opción — no se recaptura nada (`fianzas.clase`).

La diferencia es una sola, y es de números: **un previo no es un pasivo**, así
que queda fuera de

- el monto afianzado y las sumas de primas (panel y portal del fiado),
- el **comprometido** de la línea de crédito (no aparta capacidad),
- los avisos de vencimiento por correo.

Se cuenta aparte ("1 previo(s)" en la lista de clientes, "Previos" en las cifras
del cliente) para que no parezca que falta algo capturado. En las tablas sale
marcado con una etiqueta violeta, y su estado **es** "Previo": juzgarle vigencia
no significa nada, porque sus fechas son las estimadas de la solicitud.

> Si mañana se decide que un previo **sí** debe apartar línea de crédito, es un
> cambio de una línea en `routes/dashboard.js` y `routes/admin.js` (los dos
> lugares que calculan el comprometido). La prueba que fija el comportamiento de
> hoy es `server/test/previos.test.js`.

## Contratantes y padrón de proveedores

No todos los clientes compran fianzas. Un desarrollador —Desarrollos Delta, en
los datos de demostración— no compra ninguna: **las exige**. Quien las presenta
es su proveedor, y lo que el desarrollador necesita del portal es una sola
respuesta, proveedor por proveedor: ¿ya presentó la fianza o no?

Eso es `clients.tipo`, y son dos negocios, no dos niveles de permiso:

| | fiado | contratante |
|---|---|---|
| Compra fianzas | ✅ | ❌ |
| Obras propias, pólizas, líneas de crédito, expediente | ✅ | ❌ (el servidor las rechaza) |
| Padrón de proveedores | ❌ | ✅ |
| Al entrar ve | "Mis fianzas" | "Mis proveedores" |

Va como una columna sobre la misma tabla, y no como una tabla aparte, porque un
contratante tiene la **misma ficha** que un fiado (razón social, RFC, teléfono,
vendedor titular) y sus accesos se dan igual. Lo único que cambia es qué ve.

### Un proveedor es un fiado normal

No tiene nada especial: es una fila de `clients` con `tipo = 'fiado'`. Puede
además ser cliente directo de Fortex, y **puede estar en el padrón de varios
desarrolladores a la vez** — el subcontratista eléctrico le trabaja a todo el
mundo. Por eso la liga es una tabla puente (`client_proveedores`) y no una
columna "empresa padre": con una columna habría que dar de alta al mismo
proveedor una vez por desarrollador, y duplicarlo significa duplicarle el
expediente y las pólizas.

El acceso al portal del proveedor es **opcional**. Se le puede dar de alta desde
el padrón con solo su razón social: Fortex le captura la fianza, el contratante
la ve, y en esa empresa nadie tiene que enterarse de que este sistema existe.

### Qué ve el contratante, y qué no

La unidad de permiso **no es el proveedor: es la obra**. Lo que le abre a un
contratante las fianzas de una obra es `proyectos.contratante_id`.

Es la decisión de diseño que más importa de todo esto. Si bastara con estar en el
padrón, el día que el mismo eléctrico le trabaje a dos desarrollos, cada uno
vería la obra del otro —con el monto del contrato de su competencia dentro—.
Ligando por obra, cada uno ve la suya.

Y hacen falta **las dos** condiciones a la vez, siempre (`JOIN_PADRON` +
`ALCANCE` en `lib/permisos.js`): la obra ligada **y** el proveedor activo en el
padrón. Con solo la primera, suspender a un proveedor no le cerraría nada; con
solo la segunda, se abrirían todas sus obras.

| Dato | ¿Lo ve el contratante? |
|---|---|
| Razón social y RFC del proveedor | ✅ |
| Obra ligada a él: nombre, contrato, monto, fechas, estatus | ✅ |
| Fianza: n° de póliza, tipo, afianzadora, monto afianzado, vigencia, estado | ✅ |
| Carátula, endoso y carta de liberación | ✅ |
| **Prima neta y prima total** | ❌ es lo que le costó a su proveedor |
| **Recibo de prima** (el archivo) | ❌ dice lo mismo, en PDF |
| Línea de crédito del proveedor | ❌ |
| Expediente del proveedor (estados financieros, acta) | ❌ |
| Papelería y recordatorios internos de Fortex | ❌ |
| Las **otras** obras del proveedor | ❌ ni su existencia |
| Correos y accesos del proveedor | ❌ |

Nada de esa columna derecha se selecciona y luego se borra del objeto antes de
responder: **no se pide nunca** (`services/proveedores.js`, y la lista blanca de
tipos de documento en `lib/permisos.js`). La prueba que lo fija —
`server/test/contratantes.test.js` — no revisa campos sueltos: recorre el JSON
completo y falla si aparece **cualquier** llave de una lista prohibida, así que
el día que alguien le agregue una columna a `fianzas` se entera ahí y no en la
pantalla de un cliente.

### Suspender, no borrar

Para dejar de trabajar con un proveedor se **suspende** del padrón
(`client_proveedores.activo = 0`): el contratante deja de ver sus obras en el
mismo instante —el `activo` es una de las dos condiciones del alcance— y queda el
historial de lo que sí presentó. En el panel aparece en una sección aparte, con
un botón para reactivarlo, y reactivarlo **no** le borra el alias ni las notas
que el contratante tenía escritas.

Borrar la fila es otra cosa: es para la liga que nunca debió existir (se agregó
al padrón equivocado). Se niega mientras haya obras ligadas, y no borra la
empresa.

Ojo con el estado intermedio: suspender **no** desliga las obras. Una obra que
sigue apuntando a un contratante que ya suspendió a ese proveedor queda colgada
—no se ve del lado del contratante, pero existe—, y por eso en el detalle del
fiado ese renglón se pinta en gris con la palabra "suspendido" en vez de afirmar
que el contratante está viendo esas fianzas.

### La obra que ya no se juzga

Una obra **cerrada o cancelada** se le sigue mostrando al contratante, pero sin
chip de cumplimiento y sin tinte rojo: en su lugar se dice el estatus. No hay
cobertura que exigirle a una obra que terminó, y pintarla en rojo llenaría la
pantalla de pendientes de hace tres años.

Las **terminadas y entregadas** sí cuentan, y es deliberado: ahí es donde vive la
fianza de vicios ocultos, que es justo la que se olvida. Por eso la pantalla dice
"obras **vigentes**" y no "obras en curso" — el conjunto no es el mismo.

Un proveedor cuyas obras con ese contratante están todas cerradas sale como
"Obras cerradas", no como "Sin obra": lo segundo diría que falta capturar algo, y
no falta nada.

### Lo que el vendedor no puede

Ligar una obra a un contratante requiere **operador**. Un vendedor captura la
obra completa —nombre, contrato, montos, fechas— pero no ese campo: le abre las
pólizas de su cliente a otra empresa, y eso **no se deshace**. Lo que ya vio, lo
vio. Es la misma razón por la que las líneas de crédito tampoco son suyas.

En cambio el padrón sí se le muestra completo al vendedor que lleva la cuenta del
desarrollador, y a propósito: necesita saber a qué proveedor le falta la fianza,
porque ahí está su venta. Puede hacerlo sin riesgo porque el panel le muestra
**exactamente la misma proyección** que ve el contratante —la misma consulta
alimenta las dos pantallas—, no el expediente completo de esos proveedores.

### El hueco que hay que decir en voz alta

El portal solo sabe de las fianzas que **colocó Fortex**. Un proveedor que
contrató la suya con otro agente aparece igual en la lista, así que la etiqueta
dice **"Sin registro"** y no "Sin fianza", y la pantalla lo explica al pie. La
diferencia no es cosmética: acusar en falso a un proveedor que sí cumplió es la
forma más rápida de que el desarrollador cierre el portal y vuelva al Excel.

Registrar las fianzas colocadas por terceros es la ampliación obvia, y no es
gratis: pide un tercer valor en `fianzas.clase` (una póliza que se vigila pero
no es producción de Fortex) y revisar los lugares donde `clase` decide si algo
suma. Mientras no exista, esa lista de "sin registro" es la lista de prospectos
de Fortex.

Dos cosas más que **no** hace esta primera entrega:

- **No sabe qué fianza exige cada obra.** Una obra que necesita anticipo y
  cumplimiento, y solo tiene el cumplimiento, sale en verde. Lo único que la
  pantalla caza con certeza es "no presentó nada". Por eso el chip verde dice
  "Con fianza" y no "Cubierta".
- **No le avisa por correo al contratante** cuando la fianza de un proveedor está
  por vencer. Hoy el aviso le llega solo a quien la compró, que es justo el que
  ya lo sabe. Es probablemente lo que más valor agregaría después de esto.

## Cuentas de prueba

| Rol         | Usuario                 | Contraseña   |
|-------------|-------------------------|--------------|
| Fiado       | cliente@demo.mx         | demo123      |
| Fiado       | contabilidad@bajio.mx   | demo123      |
| Fiado       | norte@demo.mx           | demo123      |
| Contratante | delta@demo.mx           | demo123      |
| Fiado       | vega@demo.mx            | demo123      |
| Fiado       | herrera@demo.mx         | demo123      |
| Operador    | mariana@fortex.mx       | operador123  |
| Vendedor    | carlos@fortex.mx        | vendedor123  |
| Admin       | francisco@fortex.mx     | admin123     |

Las dos primeras son de la **misma** empresa: sirven para ver que varias
personas comparten la información del fiado. `norte@demo.mx` entra también con
su RFC (`IAN980720XYZ`) porque su empresa tiene una sola cuenta. `carlos@fortex.mx`
solo ve a Ingeniería del Norte: sirve para comprobar el alcance del vendedor.

`delta@demo.mx` es el **contratante**. Entra a otra pantalla y su padrón trae los
tres casos de una vez: Cimentaciones Vega con fianza vigente, Instalaciones
Herrera con una que vence en veinte días, y Acabados Solís con una obra en
proceso y **ninguna** fianza — el renglón que el desarrollador quiere cazar.
Acabados Solís no tiene cuenta a propósito: se ve que un proveedor puede vivir en
el padrón sin entrar nunca al portal.

Y está el caso que hace demostrable el aislamiento: **Cimentaciones Vega tiene
además una obra para CFE** (`Piloteado Planta CFE Escobedo`, con su propia póliza
de $5.2M) que no está ligada a ningún contratante. Delta **no la ve**, aunque
Vega esté en su padrón. Si algún día se ve, se rompió el alcance.

## Correo saliente y recuperación de contraseña

Quien olvida su contraseña la repone solo: en el login hay un
**"¿Olvidaste tu contraseña?"** que manda un enlace al correo de la cuenta. El
enlace vence en **una hora**, es de **un solo uso**, y pedir uno nuevo invalida
el anterior. En la base se guarda solo el *hash* del token: quien pueda leer esa
tabla —o un respaldo— no puede entrar a ninguna cuenta con lo que vea ahí.

Pedir el enlace responde **lo mismo exista o no la cuenta**. Es a propósito: si
contestara distinto, cualquiera podría ir probando correos para averiguar
quiénes son clientes de Fortex.

Para que los correos salgan de verdad hay que configurar el buzón de no-reply:

1. Crea el buzón `no-reply@fortex.mx` (en Google Workspace: *Usuarios → Añadir*).
2. Activa la verificación en dos pasos de esa cuenta y genera una
   **contraseña de aplicación** (*Seguridad → Contraseñas de aplicaciones*).
   La contraseña normal del correo **no** sirve para SMTP.
3. En Vercel (*Settings → Environment Variables*) pon:

   | Name | Value |
   |---|---|
   | `EMAIL_MODE` | `smtp` |
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `587` |
   | `SMTP_USER` | `no-reply@fortex.mx` |
   | `SMTP_PASS` | la contraseña de aplicación |
   | `EMAIL_FROM` | `no-reply@fortex.mx` |
   | `EMAIL_FROM_NAME` | `Portal de Fianzas Fortex` |

4. Redespliega y llama `/api/setup?key=...`: la respuesta trae un campo
   `correo` que dice si las credenciales sirven, **sin mandarle nada a nadie**.
   Así no se descubre que el SMTP está mal el día que alguien de verdad olvidó
   su contraseña.

> Con Google Workspace, `EMAIL_FROM` tiene que ser el mismo buzón que
> `SMTP_USER` (o un alias suyo); si no, Gmail reescribe el remitente.
> Si algún día el volumen crece o la entrega se vuelve un problema, se cambia a
> un proveedor transaccional (Resend, SendGrid, Brevo) tocando solo estas
> variables.

## Alertas por email

En MVP, `EMAIL_MODE=console`: las alertas se imprimen en la consola del servidor.
El motor (`src/services/alerts.js`) corre al arrancar y se puede disparar manual:

```
POST http://localhost:4000/api/alertas/correr
```

Para producción: en `.env` pon `EMAIL_MODE=smtp` y las credenciales SMTP de SendGrid.
Para automatizar diariamente, programa un cron que llame a ese endpoint o a `correrAlertas()`.

## Próximos pasos sugeridos

- Avisarle **al contratante** por correo que a su proveedor se le vence la fianza
  (hoy el aviso solo le llega a quien la compró). Es lo que más valor agrega de
  lo que falta.
- Registrar las fianzas que el proveedor colocó con **otro agente**, para que el
  padrón no diga "sin registro" de quien sí cumplió.
- **Qué fianza exige cada obra** (`obra_requisitos`): hoy una obra a la que le
  falta el anticipo pero tiene el cumplimiento sale en verde.
- Ayudar a ligar obras viejas a su contratante a partir del campo de texto
  `beneficiario` (proponiendo las coincidencias para que un operador las
  confirme, nunca aplicándolas solas: ligar de más abre información).
- Activar SendGrid y WhatsApp (Twilio) en `services/`.
- Cron diario para alertas (hoy hay que llamar `POST /api/alertas/correr`).
- Que cada quien pueda cambiar su propia contraseña estando dentro (hoy se
  repone olvidándola, o pidiéndoselo a un administrador).
- Histórico de documentos: hoy cada tipo guarda **un** archivo vigente y al
  renovarlo se reemplaza (no queda el del año pasado).
- Estado de pago de la prima (pagada / pendiente, fecha y recibo).
