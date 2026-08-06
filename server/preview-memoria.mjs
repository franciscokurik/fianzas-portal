// Levanta el API contra un Postgres en memoria (PGlite) con los datos demo
// sembrados. Sirve para revisar el portal en local sin credenciales de Neon:
// no toca la base de producción ni escribe en disco, y todo se pierde al
// cerrar el proceso.
//
//   node server/preview-memoria.mjs   ->  http://127.0.0.1:4000
import app from './src/app.js';
import db, { initSchema } from './src/db.js';
import { seedIfEmpty } from './src/seed.js';
import { baseEnMemoria } from './test/ayuda/pg-memoria.js';

Object.assign(db, baseEnMemoria());
await initSchema();
await seedIfEmpty();

app.listen(4000, '127.0.0.1', () => {
  console.log('API en memoria lista en http://127.0.0.1:4000');
});
