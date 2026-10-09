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

// Para entrar a la sesión local con una contraseña propia en vez de la de la
// semilla. Cambiarla desde el panel no sirve de mucho: la base nace de la
// semilla en cada arranque y el cambio se pierde al reiniciar. Con esto queda
// puesta siempre. Solo toca la base EN MEMORIA de este proceso, nunca Neon, y
// solo las cuentas admin (las demás conservan la de demostración, para poder
// probar cada rol).
if (process.env.PREVIEW_ADMIN_PASSWORD) {
  const { default: bcrypt } = await import('bcryptjs');
  await db.prepare(`UPDATE users SET password_hash = ? WHERE role = 'admin'`)
    .run(bcrypt.hashSync(process.env.PREVIEW_ADMIN_PASSWORD, 10));
  console.log('Cuenta admin con la contraseña de PREVIEW_ADMIN_PASSWORD');
}

app.listen(4000, '127.0.0.1', () => {
  console.log('API en memoria lista en http://127.0.0.1:4000');
});
