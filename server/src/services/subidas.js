// Adopta un archivo que el navegador ya subió directo a Cloudinary.
//
// El navegador solo dice DÓNDE subió (el public_id que este servidor firmó). La
// URL y el peso los da Cloudinary, no el cliente: si se le creyera al navegador,
// cualquiera podría registrar la URL que quisiera —o mentir sobre el tamaño— y
// quedaría colgada del expediente de un fiado.
import { consultarArchivo, prefijoDe, borrarArchivo, MAXIMO_MB } from '../lib/upload.js';

function fallo(mensaje, status = 400) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

export async function adoptarArchivo({ publicId, clientId, nombre }) {
  const id = String(publicId || '').trim();
  if (!id) throw fallo('Falta indicar el archivo subido');

  // Una firma pedida para un cliente no sirve para colgarle el archivo a otro:
  // todos los archivos de un fiado viven bajo su propio prefijo.
  if (!id.startsWith(prefijoDe(clientId))) {
    throw fallo('Ese archivo no corresponde a este cliente', 403);
  }

  const archivo = await consultarArchivo(id);
  if (!archivo) {
    throw fallo('No se encontró el archivo en Cloudinary. Vuelve a subirlo.', 404);
  }

  const mb = archivo.bytes / (1024 * 1024);
  if (mb > MAXIMO_MB) {
    // Se limpia lo que ya subió: si se dejara, ocuparía cuota sin que nada lo
    // apunte y nadie se enteraría.
    await borrarArchivo(archivo.url);
    throw fallo(`El archivo pesa ${mb.toFixed(1)} MB y el máximo es ${MAXIMO_MB} MB`, 413);
  }

  return {
    url: archivo.url,
    bytes: archivo.bytes,
    // El nombre original lo pone el navegador porque Cloudinary no lo guarda; es
    // solo para mostrar, así que no hay nada que verificar.
    nombre: String(nombre || id.split('/').pop()).slice(0, 200),
  };
}
