// El identificador con el que se borra un archivo en Cloudinary se deduce de su
// URL, no se guarda en una columna. Si ese parseo se rompe, cada documento que
// se reemplace deja el archivo viejo colgado en la cuenta para siempre (y la
// cuota del plan gratuito se acaba sola).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  referenciaCloudinary, firmarSubida, limpiarUrlCloudinary, traducirErrorCloudinary,
} from '../src/lib/upload.js';

test('un 403 de Cloudinary dice que hay que revisar el rol de la API key', () => {
  // El SDK manda "Server returned unexpected status code - 403", que no le
  // sirve de nada a quien está capturando una póliza.
  const traducido = traducirErrorCloudinary(
    Object.assign(new Error('Server returned unexpected status code - 403'), { http_code: 403 })
  );
  assert.match(traducido.message, /rol de la API key|Master Admin/i);

  const credenciales = traducirErrorCloudinary({ http_code: 401 });
  assert.match(credenciales.message, /credenciales/i);

  // Lo que no sepamos traducir se deja pasar tal cual, sin disfrazarlo.
  const raro = new Error('se cayó la red');
  assert.equal(traducirErrorCloudinary(raro), raro);
});

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

test('aguanta la credencial pegada con el prefijo que da el dashboard', async () => {
  // Cloudinary te da la línea completa para copiar, y al pegarla en el campo
  // "Value" de Vercel el prefijo se queda dentro del valor.
  const buena = 'cloudinary://123456789012345:elSecreto@djowdzxpg';

  assert.equal(limpiarUrlCloudinary('CLOUDINARY_URL=' + buena), buena);
  assert.equal(limpiarUrlCloudinary('  ' + buena + '  '), buena);
  assert.equal(limpiarUrlCloudinary(`"${buena}"`), buena);
  assert.equal(limpiarUrlCloudinary(buena), buena, 'lo que ya venía bien no se toca');
  assert.equal(limpiarUrlCloudinary(undefined), '');
});

test('una credencial que no se puede rescatar dice qué corregir', async () => {
  for (const v of ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    delete process.env[v];
  }
  // Con los marcadores sin sustituir, que es el otro error de dedo típico.
  process.env.CLOUDINARY_URL = 'cloudinary//<api_key>:<api_secret>@djowdzxpg';

  await assert.rejects(() => firmarSubida({ clientId: 1, nombreArchivo: 'x.pdf' }), /mal formada/);

  delete process.env.CLOUDINARY_URL;
});

test('sin credenciales, subir dice exactamente qué falta configurar', async () => {
  for (const v of ['CLOUDINARY_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET']) {
    delete process.env[v];
  }

  // El error del SDK ("Must supply api_key") no dice qué variable falta ni
  // dónde ponerla, y este es el primer tropiezo al desplegar.
  await assert.rejects(() => firmarSubida({ clientId: 1, nombreArchivo: 'x.pdf' }), /CLOUDINARY_URL/);
});

test('todos los archivos de un fiado caen bajo su propio prefijo', async () => {
  // Es lo que impide que una firma pedida para un cliente sirva para colgarle el
  // archivo a otro: al registrarlo se comprueba que el public_id empiece así.
  const { prefijoDe } = await import('../src/lib/upload.js');
  assert.ok(prefijoDe(7).endsWith('/client_7/'), prefijoDe(7));
  assert.notEqual(prefijoDe(7), prefijoDe(70), 'el prefijo de un cliente no debe ser prefijo de otro');
});

test('el cliente y el servidor declaran el mismo tope', async () => {
  // Son dos archivos distintos y nada los ata; si se separan, la pantalla
  // promete un tamaño que la API rechaza.
  const fs = await import('node:fs');
  const { MAXIMO_MB } = await import('../src/lib/upload.js');
  const lib = fs.readFileSync('client/src/lib.jsx', 'utf8');
  const enElCliente = Number(/export const MAXIMO_MB = (\d+)/.exec(lib)?.[1]);

  assert.equal(enElCliente, MAXIMO_MB);
});
