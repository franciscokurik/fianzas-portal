# Portal de Fianzas · Fortex

Portal web para que los clientes (fiados) de Fortex consulten y gestionen sus fianzas,
con panel de administración para el equipo de Fortex.

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
- Formatos aceptados: PDF, JPG, PNG, Excel y Word. Máximo 10 MB por archivo.
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
      routes/      auth, dashboard, fianzas, documentos, admin
      services/    email, alerts
      lib/         dates, upload
      db.js        capa SQLite (node:sqlite)
      schema.sql   esquema
      seed.js      datos de demo
  client/          App React (Vite)
    src/
      pages/       Login, Dashboard, Admin
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

Una **empresa fiada** (`clients`) y una **cuenta de acceso** (`users`) son cosas
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

## Cuentas de prueba

| Rol      | Usuario                 | Contraseña   |
|----------|-------------------------|--------------|
| Cliente  | cliente@demo.mx         | demo123      |
| Cliente  | contabilidad@bajio.mx   | demo123      |
| Cliente  | norte@demo.mx           | demo123      |
| Operador | mariana@fortex.mx       | operador123  |
| Vendedor | carlos@fortex.mx        | vendedor123  |
| Admin    | francisco@fortex.mx     | admin123     |

Las dos primeras son de la **misma** empresa: sirven para ver que varias
personas comparten la información del fiado. `norte@demo.mx` entra también con
su RFC (`IAN980720XYZ`) porque su empresa tiene una sola cuenta. `carlos@fortex.mx`
solo ve a Ingeniería del Norte: sirve para comprobar el alcance del vendedor.

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

- Activar SendGrid y WhatsApp (Twilio) en `services/`.
- Cron diario para alertas (hoy hay que llamar `POST /api/alertas/correr`).
- Que cada quien pueda cambiar su propia contraseña estando dentro (hoy se
  repone olvidándola, o pidiéndoselo a un administrador).
- Histórico de documentos: hoy cada tipo guarda **un** archivo vigente y al
  renovarlo se reemplaza (no queda el del año pasado).
- Estado de pago de la prima (pagada / pendiente, fecha y recibo).
