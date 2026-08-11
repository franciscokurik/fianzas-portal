// Comprobaciones que van SIEMPRE en el servidor, nunca escondiendo botones:
// ocultar algo en la pantalla no impide cambiar el id en la URL, y por estas
// rutas pasan estados financieros y pólizas de terceros.
//
// Hoy todo el personal de Fortex —admin y operador— ve a todos los fiados, así
// que lo único que queda aquí es validar que la cosa exista antes de tocarla.
// Las funciones siguen recibiendo el usuario a propósito: si mañana hay que
// acotar a alguien a un subconjunto de clientes, el filtro se agrega en estas
// tres funciones y lo heredan todas las rutas de golpe, en vez de andar
// buscando los treinta lugares que consultan la base a mano.
import db from '../db.js';

export const esAdmin = (user) => user?.role === 'admin';

function negar(mensaje, status) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Lanza 404 si el cliente no existe. Se comprueba aunque el usuario pueda verlo
// todo: sin esto, un id equivocado seguiría de largo y acabaría, por ejemplo,
// subiendo el archivo a Cloudinary para luego reventar al guardarlo, dejando
// basura en la cuenta.
export async function exigirCliente(user, clientId) {
  const fila = await db.prepare('SELECT id FROM clients WHERE id = ?').get(Number(clientId));
  if (!fila) throw negar('Cliente no encontrado', 404);
}

const TABLA = { proyecto: 'proyectos', fianza: 'fianzas', documento: 'documentos' };

// De qué fiado es un proyecto, una fianza o un archivo.
export async function clienteDe(entidad, id) {
  const fila = await db
    .prepare(`SELECT client_id FROM ${TABLA[entidad]} WHERE id = ?`)
    .get(Number(id));
  return fila?.client_id ?? null;
}

// Igual, partiendo de la entidad. Devuelve el client_id para que quien llama no
// lo vuelva a buscar.
export async function exigirEntidad(user, entidad, id) {
  const clientId = await clienteDe(entidad, id);
  if (clientId == null) throw negar(`No existe ese ${entidad}`, 404);
  return clientId;
}
