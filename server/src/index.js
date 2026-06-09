import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';

import { initSchema } from './db.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import fianzasRoutes from './routes/fianzas.js';
import documentosRoutes from './routes/documentos.js';
import adminRoutes from './routes/admin.js';
import { correrAlertas } from './services/alerts.js';

initSchema();

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

app.use('/api/auth', authRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/fianzas', fianzasRoutes);
app.use('/api/documentos', documentosRoutes);
app.use('/api/admin', adminRoutes);

// Endpoint para disparar alertas manualmente (útil en MVP/demo)
app.post('/api/alertas/correr', async (req, res) => {
  const n = await correrAlertas();
  res.json({ ok: true, notificaciones: n });
});

// Manejo de errores (incluye límite de tamaño de multer)
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera 10 MB' });
  }
  if (err) return res.status(400).json({ error: err.message });
  next();
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`🚀 API de fianzas Fortex escuchando en http://localhost:${PORT}`);
  // Corre alertas al arrancar (en producción: usar un cron diario)
  correrAlertas().catch((e) => console.error('Error en alertas:', e));
});
