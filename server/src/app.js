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
import { seed, seedIfEmpty, reiniciarVacio } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Express 4 no entiende los handlers async: si uno rechaza, la promesa queda
// sin atender y la petición se cuelga hasta que la plataforma la corta. El
// front no recibe ni un error, solo se queda esperando. Esto encadena el
// rechazo a next() para que llegue al manejador de errores de abajo.
function capturarAsync(router) {
  for (const capa of router.stack) {
    if (!capa.route) continue;
    for (const sub of capa.route.stack) {
      const handler = sub.handle;
      if (handler.length === 4) continue; // ya es un manejador de errores
      sub.handle = (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
    }
  }
  return router;
}

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || true }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

// Crea el esquema y siembra datos demo. Pensado para ejecutarse UNA vez tras
// desplegar (hosting serverless). Protegido por SETUP_KEY si está definida.
//   GET /api/setup?key=XYZ            -> aplica esquema y migraciones; siembra
//                                        datos demo SOLO si la BD está vacía
//   GET /api/setup?key=XYZ&force=1    -> re-siembra desde cero CON datos demo
//   GET /api/setup?key=XYZ&reiniciar=vacio&confirmar=BORRAR
//                                     -> deja el portal en blanco para operar:
//                                        borra todos los datos de clientes y
//                                        conserva las cuentas admin, las
//                                        afianzadoras y los catálogos
app.get('/api/setup', async (req, res) => {
  const required = process.env.SETUP_KEY;
  if (required && req.query.key !== required) {
    return res.status(403).json({ error: 'Clave de setup inválida' });
  }
  try {
    if (req.query.reiniciar === 'vacio') {
      // Doble confirmación: la clave sola no basta para borrar producción.
      if (req.query.confirmar !== 'BORRAR') {
        return res.status(400).json({
          error: 'Falta confirmar el borrado',
          detail: 'Repite la llamada agregando &confirmar=BORRAR. Se eliminarán '
                + 'todos los clientes con sus proyectos, fianzas, líneas y documentos. '
                + 'Se conservan las cuentas admin, las afianzadoras y los catálogos.',
        });
      }
      const borrado = await reiniciarVacio();
      return res.json({ ok: true, reiniciado: true, borrado });
    }

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

app.use('/api/auth', capturarAsync(authRoutes));
app.use('/api/dashboard', capturarAsync(dashboardRoutes));
app.use('/api/fianzas', capturarAsync(fianzasRoutes));
app.use('/api/documentos', capturarAsync(documentosRoutes));
app.use('/api/admin', capturarAsync(adminRoutes));

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
  if (!err) return next();

  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'El archivo supera 10 MB' });
  }

  // Los errores de Postgres traen un `code` de 5 caracteres. Casi siempre
  // significan que falta correr /api/setup tras un despliegue, así que se
  // dice explícitamente en vez de devolver un 400 genérico.
  const esErrorDeBase = typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code);
  if (esErrorDeBase) {
    console.error(`[db ${err.code}] ${req.method} ${req.originalUrl}: ${err.message}`);
    return res.status(500).json({
      error: 'La base de datos rechazó la consulta. ¿Falta correr /api/setup tras el despliegue?',
      detail: err.message,
      code: err.code,
    });
  }

  console.error(`[error] ${req.method} ${req.originalUrl}: ${err.message}`);
  res.status(err.status || 400).json({ error: err.message });
});

export default app;
