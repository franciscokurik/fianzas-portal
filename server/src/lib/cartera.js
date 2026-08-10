// Quién alcanza a qué fiado.
//
// El admin ve todo; el vendedor, solo los clientes que tiene asignados. Esa
// comprobación va SIEMPRE en el servidor y por cada ruta: esconder un botón en
// la pantalla no impide que alguien cambie el id en la URL, y aquí lo que se
// filtra son los estados financieros y las pólizas de terceros.
import db from '../db.js';

export const esAdmin = (user) => user?.role === 'admin';

function negar(mensaje, status) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Lanza 404 si el cliente no existe y 403 si existe pero no le toca.
//
// La existencia se comprueba SIEMPRE, también para el admin: si se saltara ese
// caso, un id equivocado seguiría de largo y acabaría subiendo el archivo a
// Cloudinary para luego reventar al guardarlo, dejando basura en la cuenta.
export async function exigirCliente(user, clientId) {
  const fila = await db.prepare('SELECT vendedor_id FROM clients WHERE id = ?').get(Number(clientId));
  if (!fila) throw negar('Cliente no encontrado', 404);

  if (esAdmin(user)) return;
  if (fila.vendedor_id !== user.id) {
    throw negar('Ese cliente no está en tu cartera', 403);
  }
}

const TABLA = { proyecto: 'proyectos', fianza: 'fianzas', documento: 'documentos' };

// De qué fiado es un proyecto, una fianza o un archivo.
export async function clienteDe(entidad, id) {
  const fila = await db
    .prepare(`SELECT client_id FROM ${TABLA[entidad]} WHERE id = ?`)
    .get(Number(id));
  return fila?.client_id ?? null;
}

// Igual que exigirCliente pero partiendo de la entidad: primero averigua de
// quién es. Devuelve el client_id para que quien llama no lo vuelva a buscar.
export async function exigirEntidad(user, entidad, id) {
  const clientId = await clienteDe(entidad, id);
  if (clientId == null) throw negar(`No existe ese ${entidad}`, 404);
  await exigirCliente(user, clientId);
  return clientId;
}

// Trozo de WHERE para las listas: el admin ve todo, el vendedor solo lo suyo.
// Se devuelve el fragmento y sus parámetros para no armar SQL a mano en cada
// consulta ni, peor, olvidarlo en alguna.
export function filtroCartera(user, columna = 'vendedor_id') {
  return esAdmin(user)
    ? { sql: '', params: [] }
    : { sql: ` AND ${columna} = ?`, params: [user.id] };
}
