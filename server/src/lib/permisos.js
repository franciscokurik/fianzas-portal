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
// La cartera vive en clients.vendedor_id —el vendedor titular de cada cuenta— y
// puede apuntar a cualquier cuenta interna: un admin o un operador también
// llevan cuentas propias. Para ellos el campo no limita nada, porque de todas
// formas ven todo; para el vendedor es justo lo que lo acota.
//
// Y hay dos clases de empresa (clients.tipo), que no son dos niveles de
// permiso sino dos negocios:
//   FIADO       -> compra fianzas. Todo lo de arriba es sobre él.
//   CONTRATANTE -> el desarrollador que EXIGE la fianza a sus proveedores.
//                  Solo lee, y lo que alcanza está al final de este archivo.
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
// Los roles que alcanzan a TODOS los fiados. Se dice quién SÍ y nunca quién no:
// con una lista de excepciones, el rol o el tipo de cuenta que se agregue mañana
// —un contratante, un auditor— nacería viendo el expediente de todo el mundo por
// el solo hecho de que nadie se acordó de escribirlo en la excepción.
const VEN_TODO = ['admin', 'operador'];

export async function exigirCliente(user, clientId) {
  const fila = await db.prepare('SELECT vendedor_id FROM clients WHERE id = ?').get(Number(clientId));
  if (!fila) throw negar('Cliente no encontrado', 404);

  if (VEN_TODO.includes(user?.role)) return;
  if (esVendedor(user) && fila.vendedor_id === user.id) return;

  // Un usuario de portal NO pasa por aquí ni para su propia empresa, y no es un
  // descuido: esta función contesta "¿este fiado es tuyo de atender?", que es
  // una pregunta de Fortex. Lo del portal se acota con req.user.client_id, sin
  // preguntarle a nadie. Antes solo se frenaba al vendedor, así que cualquier
  // otro rol pasaba para cualquier id — inofensivo mientras ninguna ruta de
  // portal la llamara, y una fuga en cuanto alguien la llamara.
  throw negar('Ese cliente no está en tu cartera', 403);
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
  // El fragmento VACÍO solo para quien de verdad ve todo: aquí "sin filtro" no
  // significa "ve lo suyo", significa "ve la lista completa de clientes".
  if (VEN_TODO.includes(user?.role)) return { sql: '', params: [] };
  if (esVendedor(user)) return { sql: ` AND ${columna} = ?`, params: [user.id] };
  throw negar('Esta lista es del personal de Fortex', 403);
}

// ---------------------------------------------------------------------------
// Contratantes
//
// Un contratante es un TERCERO respecto a su proveedor: otra empresa, con su
// propio interés comercial. Todo lo que sigue es de LECTURA y lo más angosto
// que se pudo, porque una fuga aquí no le enseña a alguien de más sobre su
// propia empresa —eso sería nada más molesto— sino los números de otra.
// ---------------------------------------------------------------------------

// LAS DOS CONDICIONES DEL ALCANCE, pegadas a propósito para que ninguna consulta
// pueda aplicar solo la mitad:
//
//   - Solo la de la obra deja ver las obras de un proveedor ya suspendido: se le
//     quita del padrón y sigue viendo sus pólizas.
//   - Solo la del padrón abre TODAS las obras del proveedor, las que hace para
//     la competencia del contratante incluidas. Ese es exactamente el error que
//     este archivo existe para no cometer.
//
// Toda consulta del contratante lleva las dos. La tabla del proyecto tiene que
// venir aliaseada como 'p'.
export const ALCANCE = 'p.contratante_id = ?';
export const JOIN_PADRON = `
  JOIN client_proveedores cp
    ON cp.proveedor_id   = p.client_id
   AND cp.contratante_id = p.contratante_id
   AND cp.activo = 1`;

// Los ids llegan de la URL, así que pueden traer cualquier cosa. Sin esto, un
// 'abc' o un número más grande que un int4 hacía que Postgres reventara con su
// propio mensaje —"invalid input syntax for type integer"— y el manejador de
// errores de app.js se lo devolvía TAL CUAL, con el código del motor, a la
// cuenta de otra empresa. Donde correspondía un 404 salía un 500 con detalle
// interno.
const idValido = (valor) => {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 && n <= 2147483647 ? n : null;
};

// De qué clase es una empresa. Se pregunta a la base y NO se guarda en el
// token: el token vive ocho horas y esto decide qué se puede leer.
export async function tipoDeCliente(clientId) {
  const fila = await db.prepare('SELECT tipo FROM clients WHERE id = ?').get(Number(clientId));
  return fila?.tipo ?? null;
}

// Que ese proveedor esté en el padrón del contratante.
//
// Se contesta 404 y no 403 a propósito: decir "existe, pero no es tuyo" ya le
// confirma a quien va probando ids que esa empresa es cliente de Fortex.
export async function exigirProveedor(contratanteId, proveedorId) {
  const id = idValido(proveedorId);
  if (id === null) throw negar('Ese proveedor no está en tu padrón', 404);

  const fila = await db.prepare(
    `SELECT alias, notas FROM client_proveedores
     WHERE contratante_id = ? AND proveedor_id = ? AND activo = 1`
  ).get(Number(contratanteId), id);
  if (!fila) throw negar('Ese proveedor no está en tu padrón', 404);
  return fila;
}

// Que esa obra esté dentro del alcance del contratante. Es la puerta de todo lo
// que se hace SOBRE una obra: subirle un archivo, listarlo, borrarlo.
//
// Devuelve el client_id del PROVEEDOR (el dueño de la obra) y el nombre lo dice
// para que no se confunda: ese id sirve para leer la obra, JAMÁS para firmar una
// subida. Lo que el contratante sube va a su PROPIA carpeta.
export async function exigirObraDelContratante(contratanteId, obraId) {
  const id = idValido(obraId);
  if (id === null) throw negar('No existe esa obra', 404);

  const fila = await db.prepare(
    `SELECT p.client_id AS proveedor_id
     FROM proyectos p
     ${JOIN_PADRON}
     WHERE p.id = ? AND ${ALCANCE}`
  ).get(id, Number(contratanteId));
  // 404 y no 403, por lo mismo que en exigirProveedor.
  if (!fila) throw negar('No existe esa obra', 404);
  return fila.proveedor_id;
}

// Los papeles que ACREDITAN LA GARANTÍA, y nada más. La lista es blanca, no
// negra, por la misma razón que VEN_TODO: el tipo de documento que se agregue
// mañana nace cerrado.
//
// Lo que queda fuera y por qué:
//   - 'recibo_prima' dice cuánto le cobró la afianzadora al proveedor. Es su
//     estructura de precio, y es justo el dato con el que el desarrollador le
//     negociaría a la baja. Sin esta lista, la carátula y el recibo se bajaban
//     por la misma puerta.
//   - 'otro' es, por definición, un archivo que nadie clasificó.
//   - Los del PROYECTO (contrato, convenios modificatorios, actas de
//     entrega-recepción) son papeles del proveedor y pueden traer condiciones
//     que el desarrollador no tiene por qué leer.
//
// Si algún día se decide abrir alguno, se abre aquí, en un solo lugar.
export const DOCS_QUE_VE_EL_CONTRATANTE = ['caratula', 'endoso', 'carta_liberacion'];

// Se arma como literal y no como parámetro de arreglo (`= ANY(?)`) porque los
// dos drivers —el HTTP de Neon y el PGlite de las pruebas— tratan los arreglos
// de JavaScript distinto, y aquí no hay riesgo de inyección: son constantes de
// este módulo, no algo que llegue de una petición.
export const SQL_DOCS_DEL_CONTRATANTE = DOCS_QUE_VE_EL_CONTRATANTE
  .map((t) => `'${t}'`)
  .join(', ');

// La URL del archivo de una fianza que el contratante SÍ alcanza. La liga es la
// OBRA: el documento cuelga de una fianza, la fianza de un proyecto, y ese
// proyecto tiene que estar ligado a este contratante y a un padrón activo.
//
// Ojo: documentos.client_id NO sirve para autorizar esto. Está denormalizado
// para filtrar por DUEÑO, y usarlo aquí entregaría los papeles de las obras que
// el proveedor hace para otros. Hay que subir por el proyecto, como esta
// consulta.
export async function urlDeDocumentoParaContratante(contratanteId, documentoId) {
  // null hace que la ruta conteste el 404 "Documento no disponible" que ya está
  // escrito, que es la respuesta correcta para un id que no existe.
  const id = idValido(documentoId);
  if (id === null) return null;

  // 1) Los papeles de la GARANTÍA, que son del proveedor: solo los de la lista
  //    blanca, y solo si cuelgan de una obra que este contratante alcanza.
  const deLaGarantia = await db.prepare(
    `SELECT d.url
     FROM documentos d
     JOIN fianzas f   ON f.id = d.entidad_id AND d.entidad_tipo = 'fianza'
     JOIN proyectos p ON p.id = f.proyecto_id
     ${JOIN_PADRON}
     WHERE d.id = ? AND ${ALCANCE}
       AND d.tipo_doc IN (${SQL_DOCS_DEL_CONTRATANTE})`
  ).get(id, Number(contratanteId));
  if (deLaGarantia) return deLaGarantia.url;

  // 2) Lo de su PROPIA carpeta: lo que él subió, o Fortex por él, sobre una de
  //    sus obras. Aquí no hace falta lista blanca de tipos porque el archivo es
  //    suyo —d.client_id es él—, pero sí se exige que la obra siga en su
  //    alcance: si le suspendieron al proveedor, esa obra ya no existe para él y
  //    no tiene por dónde pedirla (la sigue teniendo Fortex).
  const propio = await db.prepare(
    `SELECT d.url
     FROM documentos d
     JOIN proyectos p ON p.id = d.entidad_id AND d.entidad_tipo = 'proyecto'
     ${JOIN_PADRON}
     WHERE d.id = ? AND d.client_id = ? AND ${ALCANCE}`
  ).get(id, Number(contratanteId), Number(contratanteId));
  return propio?.url ?? null;
}
