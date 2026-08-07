// Subida de archivos a Cloudinary. En serverless no hay disco persistente, así
// que el archivo viaja en memoria (buffer de multer) y de ahí se manda al CDN;
// en la base solo se guarda la URL.
//
// Los archivos que se subieron antes de esta migración siguen en Vercel Blob:
// su URL sigue en la base y se sirve igual, así que aquí solo hay que saber
// borrarlos cuando se reemplazan.
// Los SDK de almacenamiento se cargan con import() PEREZOSO, no arriba. En
// serverless, un import de arriba que falle (versión de Node incompatible,
// paquete que no quedó en el bundle, interop CommonJS) tumba TODA la función:
// deja de responder hasta /api/health y el portal completo se cae por algo que
// solo hacía falta para subir un archivo. Así, en el peor caso, lo único que
// falla es subir o borrar, y con un mensaje que dice qué pasó.
import multer from 'multer';

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
export const MAXIMO_MB = 10; // el plan gratuito de Cloudinary corta ahí

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAXIMO_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (PERMITIDOS.has(file.mimetype)) return cb(null, true);
    cb(new Error(`Tipo de archivo no permitido. Usa ${FORMATOS_PERMITIDOS.join(', ')}.`));
  },
});

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

// Sube el buffer de multer y devuelve la URL https del archivo.
export async function subirArchivo(file, clientId) {
  const cloudinary = await configurar();

  // resource_type 'raw' y no 'auto': el portal solo guarda y devuelve archivos,
  // no los transforma. Con 'auto' un PDF entra como imagen y su entrega depende
  // del interruptor "PDF and ZIP files delivery", que Cloudinary trae APAGADO
  // en las cuentas nuevas — el archivo se sube bien y al abrirlo da 401.
  const nombre = file.originalname.replace(/[^\w.\-]+/g, '_');
  const publicId = `${carpeta()}/client_${clientId}/${Date.now()}_${nombre}`;

  const subida = await new Promise((resolve, reject) => {
    const flujo = cloudinary.uploader.upload_stream(
      { public_id: publicId, resource_type: 'raw', overwrite: false },
      (err, resultado) => (err ? reject(err) : resolve(resultado)),
    );
    flujo.end(file.buffer);
  });

  return subida.secure_url;
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
  } catch { /* noop */ }
}
