// Construye la app Express (sin arrancar el servidor).
// La usan tanto el arranque local (index.js) como la función serverless de Vercel (api/index.js).
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import fianzasRoutes from './routes/fianzas.js';
import documentosRoutes from './routes/documentos.js';
import adminRoutes from './routes/admin.js';
import { correrAlertas } from './services/alerts.js';
import { seed, seedIfEmpty } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Crea el esquema y siembra datos demo. Pensado para ejecutarse UNA vez tras
// desplegar (hosting serverless). Protegido por SETUP_KEY si está definida.
//   GET /api/setup?key=XYZ            -> siembra solo si la BD está vacía
//   GET /api/setup?key=XYZ&force=1    -> re-siembra desde cero
app.get('/api/setup', async (req, res) => {
  const required = process.env.SETUP_KEY;
  if (required && req.query.key !== required) {
    return res.status(403).json({ error: 'Clave de setup inválida' });
  }
  try {
    if (req.query.force === '1') {
      await seed();
      return res.json({ ok: true, seeded: true, forced: true });
    }
    const seeded = await seedIfEmpty();
    res.json({ ok: true, seeded });
  } catch (e) {
    res.status(500).json({ error: 'Fallo en setup', detail: e.message });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/fianzas', fianzasRoutes);
app.use('/api/documentos', documentosRoutes);
app.use('/api/admin', adminRoutes);

// Dispara alertas manualmente (útil en MVP/demo)
app.post('/api/alertas/correr', async (req, res) => {
  const n = await correrAlertas();
  res.json({ ok: true, notificaciones: n });
});

// En despliegues de un solo servicio (no Vercel) sirve la app compilada.
// En Vercel el frontend lo sirve el CDN, así que esta carpeta no existe y se omite.
const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// Manejo de errores (incluye límite de tamaño de multer)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera 10 MB' });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

export default app;
