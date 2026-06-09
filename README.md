# Portal de Fianzas · Fortex

Portal web para que los clientes (fiados) de Fortex consulten y gestionen sus fianzas,
con panel de administración para Home Office.

## Stack (MVP)

- **Frontend:** React + Vite + Tailwind CSS
- **Backend:** Node.js + Express
- **Base de datos:** SQLite integrado de Node 24 (`node:sqlite`) — sin instalación ni compilación
- **Auth:** JWT + bcryptjs
- **Archivos:** disco local (`server/uploads/`)
- **Email:** Nodemailer (modo consola en MVP; listo para SendGrid)

> Diseñado para escalar: la base de datos, el almacenamiento de archivos y el email
> están aislados en módulos para migrar a PostgreSQL / S3 / SendGrid sin reescribir.

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

## Cuentas de prueba

| Rol     | Usuario             | Contraseña |
|---------|---------------------|------------|
| Cliente | cliente@demo.mx     | demo123    |
| Cliente | norte@demo.mx       | demo123    |
| Admin   | admin@fortex.mx     | admin123   |

(El cliente también puede entrar con su RFC, ej. `CBA120315ABC`.)

## Alertas por email

En MVP, `EMAIL_MODE=console`: las alertas se imprimen en la consola del servidor.
El motor (`src/services/alerts.js`) corre al arrancar y se puede disparar manual:

```
POST http://localhost:4000/api/alertas/correr
```

Para producción: en `.env` pon `EMAIL_MODE=smtp` y las credenciales SMTP de SendGrid.
Para automatizar diariamente, programa un cron que llame a ese endpoint o a `correrAlertas()`.

## Próximos pasos sugeridos

- Migrar a PostgreSQL (reemplazar `db.js` + `schema.sql`).
- Mover archivos a S3 / Cloudflare R2 (reemplazar `lib/upload.js`).
- Activar SendGrid y WhatsApp (Twilio) en `services/`.
- Cron diario para alertas.
- Cambio de contraseña / recuperación.
