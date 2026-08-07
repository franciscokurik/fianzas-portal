// Levanta el API contra un Postgres en memoria (PGlite) con los datos demo
// sembrados. Sirve para revisar el portal en local sin credenciales de Neon:
// no toca la base de producción ni escribe en disco, y todo se pierde al
// cerrar el proceso.
//
//   node server/preview-memoria.mjs   ->  http://127.0.0.1:4000
//
// La base es de mentiras pero el almacenamiento NO: si el .env trae las
// credenciales de Cloudinary, lo que se sube aquí se sube de verdad. Es la
// forma de comprobar que subir un documento funciona sin tocar Neon.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// El .env vive en la raíz del repo, y este script se arranca tanto desde la
// raíz como desde server/ (ver .claude/launch.json). Se apunta al archivo por
// ruta absoluta para que no dependa del directorio de trabajo.
const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
config({ path: path.join(raiz, '.env') });

const { default: app } = await import('./src/app.js');
const { default: db, initSchema } = await import('./src/db.js');
const { seedIfEmpty } = await import('./src/seed.js');
const { baseEnMemoria } = await import('./test/ayuda/pg-memoria.js');

Object.assign(db, baseEnMemoria());
await initSchema();
await seedIfEmpty();

app.listen(4000, '127.0.0.1', () => {
  console.log('API en memoria lista en http://127.0.0.1:4000');
});
