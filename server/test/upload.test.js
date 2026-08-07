// El identificador con el que se borra un archivo en Cloudinary se deduce de su
// URL, no se guarda en una columna. Si ese parseo se rompe, cada documento que
// se reemplace deja el archivo viejo colgado en la cuenta para siempre (y la
// cuota del plan gratuito se acaba sola).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { referenciaCloudinary, subirArchivo } from '../src/lib/upload.js';

test('de una URL de Cloudinary saca qué borrar', () => {
  const ref = referenciaCloudinary(
    'https://res.cloudinary.com/fortex/raw/upload/v1723050000/fortex-fianzas/client_7/1723050000_caratula.pdf'
  );

  // En 'raw' el public_id conserva la extensión: sin ella, destroy() no
  // encuentra el archivo y no borra nada.
  assert.deepEqual(ref, {
    resource_type: 'raw',
    public_id: 'fortex-fianzas/client_7/1723050000_caratula.pdf',
  });
});

test('en imágenes el public_id va sin extensión', () => {
  const ref = referenciaCloudinary(
    'https://res.cloudinary.com/fortex/image/upload/v1723050000/fortex-fianzas/client_1/ine.jpg'
  );

  assert.deepEqual(ref, {
    resource_type: 'image',
    public_id: 'fortex-fianzas/client_1/ine',
  });
});

test('funciona sin número de versión y con parámetros en la URL', () => {
  const ref = referenciaCloudinary(
    'https://res.cloudinary.com/fortex/raw/upload/fortex-fianzas/client_2/contrato.pdf?_a=xyz'
  );

  assert.equal(ref.public_id, 'fortex-fianzas/client_2/contrato.pdf');
});

test('un archivo que quedó en Vercel Blob no se confunde con uno de Cloudinary', () => {
  // Los documentos subidos antes de migrar siguen ahí; borrarlos va por otra vía.
  assert.equal(
    referenciaCloudinary('https://abc123.public.blob.vercel-storage.com/client_1/contrato.pdf'),
    null
  );
  assert.equal(referenciaCloudinary('demo/comprobante.pdf'), null);
  assert.equal(referenciaCloudinary(null), null);
});

test('sin credenciales, subir dice exactamente qué falta configurar', async () => {
  for (const v of ['CLOUDINARY_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    delete process.env[v];
  }

  const archivo = { originalname: 'x.pdf', mimetype: 'application/pdf', size: 8, buffer: Buffer.from('%PDF-1.4') };

  // El error del SDK ("Must supply api_key") no dice qué variable falta ni
  // dónde ponerla, y este es el primer tropiezo al desplegar.
  await assert.rejects(() => subirArchivo(archivo, 1), /CLOUDINARY_URL/);
});
