// Arranque para desarrollo local / despliegue de un solo servicio.
// En Vercel NO se usa este archivo: allá entra por api/index.js (serverless).
import 'dotenv/config';
import app from './app.js';
import { initSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { correrAlertas } from './services/alerts.js';

const PORT = process.env.PORT || 4000;

async function start() {
  await initSchema();
  const seeded = await seedIfEmpty();
  if (seeded) console.log('🌱 Base de datos vacía: datos demo sembrados.');

  app.listen(PORT, () => {
    console.log(`🚀 API de fianzas Fortex escuchando en http://localhost:${PORT}`);
    // Corre alertas al arrancar (en producción: usar un cron diario)
    correrAlertas().catch((e) => console.error('Error en alertas:', e));
  });
}

start().catch((e) => {
  console.error('❌ No se pudo arrancar el servidor:', e);
  process.exit(1);
});
