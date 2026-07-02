// Subida de archivos en memoria (buffer) para luego enviarlos a Vercel Blob.
// En serverless no hay disco persistente, así que NO se guarda en disco.
import multer from 'multer';
import { put, del } from '@vercel/blob';

const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    cb(new Error('Tipo de archivo no permitido. Usa PDF, JPG o PNG.'));
  },
});

// Sube un archivo (buffer de multer) a Vercel Blob y devuelve la URL pública.
export async function subirArchivo(file, clientId) {
  const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
  const pathname = `client_${clientId}/${Date.now()}_${safe}`;
  const blob = await put(pathname, file.buffer, {
    access: 'public',
    contentType: file.mimetype,
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });
  return blob.url;
}

// Borra un blob por su URL (si aplica). Ignora errores (p.ej. datos demo).
export async function borrarArchivo(url) {
  if (!url || !/^https:\/\//.test(url)) return;
  try {
    await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
  } catch { /* noop */ }
}
