// Punto de entrada serverless para Vercel.
// Todas las rutas /api/* se reescriben aquí (ver vercel.json) y las atiende
// la misma app Express del proyecto. El esquema/datos se crean vía /api/setup.
import app from '../server/src/app.js';

export default app;
