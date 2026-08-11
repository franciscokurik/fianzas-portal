// Quién alcanza a qué fiado.
//
// Va SIEMPRE en el servidor y por cada ruta: esconder un botón en la pantalla no
// impide cambiar el id en la URL, y por aquí pasan los estados financieros y las
// pólizas de terceros.
//
// Hay tres niveles internos:
//   admin     -> todos los clientes, más las cuentas de acceso y la baja de
//                empresas (eso último no se decide aquí, ver routes/admin.js).
//   operador  -> todos los clientes; toda la operación.
//   vendedor  -> SOLO los clientes que tenga asignados, y solo sobre ellos.
//
// La cartera vive en clients.vendedor_id y puede apuntar a cualquier cuenta
// interna: un admin o un operador también atienden clientes. Para ellos el
// campo es informativo, porque de todas formas ven todo; para el vendedor es lo
// que lo limita.
import db from '../db.js';

export const esAdmin = (user) => user?.role === 'admin';

// El único rol interno acotado. Se pregunta por él y no por "los que ven todo"
// a propósito: si mañana se agrega otro rol, lo seguro es que nazca sin acceso
// a nada y haya que abrirle la puerta a mano, no que la herede por descuido.
export const esVendedor = (user) => user?.role === 'vendedor';

function negar(mensaje, status) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Lanza 404 si el cliente no existe y 403 si existe pero no le toca.
//
// La existencia se comprueba SIEMPRE, también para quien ve todo: si se saltara
// ese caso, un id equivocado seguiría de largo y acabaría subiendo el archivo a
// Cloudinary para luego reventar al guardarlo, dejando basura en la cuenta.
export async function exigirCliente(user, clientId) {
  const fila = await db.prepare('SELECT vendedor_id FROM clients WHERE id = ?').get(Number(clientId));
  if (!fila) throw negar('Cliente no encontrado', 404);

  if (esVendedor(user) && fila.vendedor_id !== user.id) {
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

// Trozo de WHERE para las listas. Se devuelve el fragmento con sus parámetros
// para no armar SQL a mano en cada consulta ni, peor, olvidarlo en alguna.
export function filtroCartera(user, columna = 'vendedor_id') {
  return esVendedor(user)
    ? { sql: ` AND ${columna} = ?`, params: [user.id] }
    : { sql: '', params: [] };
}
