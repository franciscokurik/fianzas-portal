// Archivos en Cloudinary.
//
// El archivo NO pasa por este servidor: el navegador lo sube directo a
// Cloudinary con una firma que se da aquí, y después nos avisa qué subió. Es la
// única forma de admitir 10 MB, porque Vercel corta el cuerpo de cada petición
// en ~4.5 MB antes de que corra la función.
//
// Lo que sí vive aquí: firmar la subida, comprobar contra Cloudinary que el
// archivo existe de verdad (no se le cree al navegador) y borrarlo.
//
// Los archivos que quedaron en Vercel Blob de antes siguen sirviéndose igual;
// solo hay que saber borrarlos cuando se reemplazan.
//
// Los SDK se cargan con import() PEREZOSO, no arriba. En serverless, un import
// de arriba que falle (versión de Node incompatible, paquete que no quedó en el
// bundle, interop CommonJS) tumba TODA la función: deja de responder hasta
// /api/health y el portal completo se cae por algo que solo hacía falta para
// subir un archivo.

// Qué se acepta. La carátula de una fianza siempre es PDF o imagen, pero los
// estados financieros suelen llegar en Excel y las actas en Word: si no se
// admiten, el fiado no tiene cómo entregarlos.
const PERMITIDOS = new Map([
  ['application/pdf', 'PDF'],
  ['image/jpeg', 'JPG'],
  ['image/png', 'PNG'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'XLSX'],
  ['application/vnd.ms-excel', 'XLS'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'DOCX'],
  ['application/msword', 'DOC'],
]);

export const FORMATOS_PERMITIDOS = [...new Set(PERMITIDOS.values())];

// 10 MB: el tope del plan gratuito de Cloudinary para archivos raw.
//
// Se puede prometer ese número porque los archivos NO pasan por aquí. Vercel
// corta el cuerpo de cada petición en ~4.5 MB, así que el navegador sube directo
// a Cloudinary con una firma que da este servidor, y luego solo nos avisa qué
// subió. Si algún día se vuelve a subir a través de la función, el techo baja a
// 4 MB de golpe y sin avisar.
export const MAXIMO_MB = 10;

export const esFormatoPermitido = (mimetype) => PERMITIDOS.has(mimetype);

// Carpeta raíz dentro de Cloudinary. Configurable para que un entorno de
// pruebas no revuelva sus archivos con los de producción.
const carpeta = () => process.env.CLOUDINARY_FOLDER || 'fortex-fianzas';

// El SDK lee CLOUDINARY_URL del entorno por su cuenta; las tres variables
// sueltas son la alternativa cuando la plataforma no permite pegar la URL
// completa. Sin credenciales se avisa en claro: el error del SDK ("Must supply
// api_key") no dice qué falta configurar ni dónde.
// El dashboard de Cloudinary da la credencial ya con el prefijo
// ("CLOUDINARY_URL=cloudinary://..."), y al pegarla en el campo de valor de
// Vercel el prefijo se queda DENTRO del valor. El SDK entonces responde
// "Invalid CLOUDINARY_URL protocol", que no le dice a nadie qué corregir.
// Se limpian el prefijo, los espacios y las comillas de sobra.
export function limpiarUrlCloudinary(valor) {
  return String(valor || '')
    .trim()
    .replace(/^CLOUDINARY_URL\s*=\s*/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

let sdk = null;
async function configurar() {
  if (sdk) return sdk;

  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  const CLOUDINARY_URL = limpiarUrlCloudinary(process.env.CLOUDINARY_URL);

  if (CLOUDINARY_URL && !CLOUDINARY_URL.startsWith('cloudinary://')) {
    throw new Error(
      'CLOUDINARY_URL mal formada: el valor debe ser solo '
      + '"cloudinary://<api_key>:<api_secret>@<cloud_name>", sin el prefijo '
      + '"CLOUDINARY_URL=", sin comillas y sin los signos < >.'
    );
  }

  if (!CLOUDINARY_URL && !(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET)) {
    throw new Error(
      'Falta configurar Cloudinary: define CLOUDINARY_URL (o CLOUDINARY_CLOUD_NAME, '
      + 'CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET) en las variables de entorno del proyecto.'
    );
  }

  // Import por omisión y luego .v2, en vez de `import { v2 }`: el paquete es
  // CommonJS y la detección de exportaciones con nombre depende del analizador
  // de cada versión de Node. Esta forma funciona en todas.
  const modulo = await import('cloudinary');
  const cloudinary = (modulo.default ?? modulo).v2;

  if (CLOUDINARY_URL) {
    // El SDK lee la variable del entorno él solo, así que se le deja ya limpia
    // en vez de parsearla aquí: él sabe de casos raros que nosotros no.
    process.env.CLOUDINARY_URL = CLOUDINARY_URL;
    cloudinary.config({ secure: true });
  } else {
    cloudinary.config({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      api_secret: CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  sdk = cloudinary;
  return sdk;
}

// El SDK reporta los fallos como "Server returned unexpected status code - 403",
// que no le dice nada a quien está capturando una póliza a las 11 de la noche.
// Se traducen a la acción concreta que hay que hacer para destrabarlo.
export function traducirErrorCloudinary(err) {
  const codigo = err?.http_code ?? err?.error?.http_code;
  const porCodigo = {
    401: 'Cloudinary rechazó las credenciales (401). Revisa CLOUDINARY_URL, o '
       + 'CLOUDINARY_API_KEY y CLOUDINARY_API_SECRET, en las variables del proyecto.',
    403: 'Cloudinary no permitió la operación (403). Casi siempre es el ROL de la API key: '
       + 'en Settings → API Keys, cámbialo a Master Admin.',
    420: 'Cloudinary está limitando las peticiones (420). Espera un momento y reintenta.',
    429: 'Se alcanzó el límite de peticiones de Cloudinary (429). Espera un momento y reintenta.',
  };
  return porCodigo[codigo] ? new Error(porCodigo[codigo]) : err;
}

// Todos los archivos de un fiado viven bajo su propio prefijo. Es lo que se
// comprueba al registrar un documento: una firma pedida para un cliente no
// sirve para colgarle el archivo a otro.
export const prefijoDe = (clientId) => `${carpeta()}/client_${Number(clientId)}/`;

// Firma para que el NAVEGADOR suba directo a Cloudinary.
//
// Se firma un public_id concreto, no un permiso general: con esta firma solo se
// puede escribir en esa ruta exacta, bajo la carpeta del cliente. El api_secret
// nunca sale de aquí; lo que viaja al navegador es la firma, que además caduca
// (Cloudinary rechaza timestamps de más de una hora).
//
// resource_type 'raw' y no 'auto': el portal solo guarda y devuelve archivos, no
// los transforma. Con 'auto' un PDF entra como imagen y su entrega depende del
// interruptor "PDF and ZIP files delivery", que Cloudinary trae APAGADO en las
// cuentas nuevas — el archivo sube bien y al abrirlo da 401.
export async function firmarSubida({ clientId, nombreArchivo }) {
  const cloudinary = await configurar();
  const { cloud_name, api_key, api_secret } = cloudinary.config();

  const limpio = String(nombreArchivo || 'archivo').replace(/[^\w.\-]+/g, '_');
  const publicId = `${prefijoDe(clientId)}${Date.now()}_${limpio}`;
  const timestamp = Math.round(Date.now() / 1000);

  return {
    subir_a: `https://api.cloudinary.com/v1_1/${cloud_name}/raw/upload`,
    public_id: publicId,
    campos: {
      api_key,
      timestamp,
      public_id: publicId,
      signature: cloudinary.utils.api_sign_request({ public_id: publicId, timestamp }, api_secret),
    },
  };
}

// Le pregunta a Cloudinary qué hay en ese public_id. No se le cree al navegador
// ni la URL ni el tamaño: el navegador solo dice DÓNDE subió, y el peso y la URL
// definitiva los da el propio Cloudinary. Devuelve null si no existe.
export async function consultarArchivo(publicId) {
  const cloudinary = await configurar();
  try {
    const r = await cloudinary.api.resource(String(publicId), { resource_type: 'raw' });
    return { url: r.secure_url, bytes: r.bytes, public_id: r.public_id };
  } catch (e) {
    if (e?.http_code === 404 || e?.error?.http_code === 404) return null;
    throw traducirErrorCloudinary(e);
  }
}

// Saca de la URL lo que hace falta para borrar el archivo en Cloudinary. Se
// deduce en vez de guardarlo en una columna aparte porque el formato de la URL
// lo fijamos nosotros al subir (sin transformaciones):
//
//   https://res.cloudinary.com/<cuenta>/<resource_type>/upload/v<version>/<public_id>
//
// En 'raw' el public_id conserva la extensión; en 'image' y 'video' no.
export function referenciaCloudinary(url) {
  const limpia = String(url || '').split('?')[0];
  const partes = /res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/(?:upload|private|authenticated)\/(?:v\d+\/)?(.+)$/
    .exec(limpia);
  if (!partes) return null;

  const [, resourceType, resto] = partes;
  const publicId = resourceType === 'raw' ? resto : resto.replace(/\.[^./]+$/, '');
  return { resource_type: resourceType, public_id: decodeURIComponent(publicId) };
}

// Borra el archivo de donde esté. Los errores se ignoran a propósito: quien
// llama ya quitó (o está por quitar) el registro que lo apuntaba, y un archivo
// huérfano en el CDN no debe tumbar la operación del usuario.
export async function borrarArchivo(url) {
  if (!url || !/^https:\/\//.test(url)) return; // rutas de demo o vacías

  try {
    const ref = referenciaCloudinary(url);
    if (ref) {
      const cloudinary = await configurar();
      await cloudinary.uploader.destroy(ref.public_id, {
        resource_type: ref.resource_type,
        invalidate: true,
      });
      return;
    }
    // Archivo de antes de la migración: sigue viviendo en Vercel Blob.
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      const { del } = await import('@vercel/blob');
      await del(url, { token: process.env.BLOB_READ_WRITE_TOKEN });
    }
  } catch (err) {
    // No se relanza: quien llama ya quitó el registro que apuntaba al archivo.
    // Pero sí se deja rastro, porque si la API key no tiene permiso de borrar,
    // cada documento reemplazado deja basura y en silencio nadie se entera
    // hasta que se acaba la cuota.
    console.error('[cloudinary] no se pudo borrar el archivo:',
      traducirErrorCloudinary(err).message);
  }
}
