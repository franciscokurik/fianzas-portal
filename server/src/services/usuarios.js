// Alta y baja de las cuentas de acceso.
//
// Hay dos familias de usuarios y no se mezclan: los del fiado (client_id lleno,
// rol 'client') y los de Fortex (client_id nulo, rol 'operador' o 'admin').
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { invalidarEnlaces } from './recuperacion.js';

// Los correos de Fortex tienen que ser del dominio de Fortex. A los fiados NO
// se les exige dominio a propósito: muchos contratistas usan Gmail o el correo
// personal del dueño, y amarrarlos dejaría fuera a clientes legítimos.
export const DOMINIO_INTERNO = (process.env.DOMINIO_INTERNO || 'fortex.mx').toLowerCase();

// De menos a más permisos. El orden importa para la pantalla: así se listan.
export const ROLES_INTERNOS = ['vendedor', 'operador', 'admin'];

function fallo(mensaje, status = 400) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validarCorreo(email, role) {
  const limpio = String(email || '').trim().toLowerCase();
  if (!CORREO.test(limpio)) throw fallo('El correo no tiene un formato válido');

  if (ROLES_INTERNOS.includes(role) && !limpio.endsWith(`@${DOMINIO_INTERNO}`)) {
    throw fallo(
      `Las cuentas de Fortex deben usar un correo @${DOMINIO_INTERNO}. `
      + 'Así nadie se da de alta como operador con un correo de fuera.'
    );
  }
  return limpio;
}

// Contraseña inicial: la fija Fortex y se la pasa a la persona. No es el
// esquema ideal (falta que cada quien pueda cambiarla), pero exigir algo
// mínimo evita las de tres letras.
function validarPassword(password) {
  const p = String(password || '');
  if (p.length < 8) throw fallo('La contraseña debe tener al menos 8 caracteres');
  return p;
}

export async function crearUsuario({ nombre, email, password, role = 'client', clientId = null }) {
  if (!String(nombre || '').trim()) throw fallo('El nombre es obligatorio');
  if (!['client', ...ROLES_INTERNOS].includes(role)) throw fallo('Rol no válido');

  // Un usuario de fiado sin empresa no vería nada, y un operador amarrado a una
  // empresa vería su portal en vez del panel. Ninguno de los dos tiene sentido.
  if (role === 'client' && !clientId) throw fallo('Falta indicar de qué cliente es el usuario');
  if (role !== 'client' && clientId) throw fallo('Las cuentas de Fortex no pertenecen a un cliente');

  const correo = validarCorreo(email, role);
  const hash = bcrypt.hashSync(validarPassword(password), 10);

  try {
    return await db.prepare(
      `INSERT INTO users (client_id, nombre, email, password_hash, role)
       VALUES (?, ?, ?, ?, ?) RETURNING id`
    ).get(clientId, String(nombre).trim(), correo, hash, role);
  } catch (e) {
    throw fallo(`Ya hay una cuenta con el correo ${correo}`, 409);
  }
}

// Dejar el portal sin ningún admin activo lo cierra para siempre: no queda por
// dónde volver a entrar a repartir permisos.
async function exigirQueQuedeUnAdmin(usuario) {
  if (usuario.role !== 'admin') return;
  const { total } = await db
    .prepare(`SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin' AND activo = 1`)
    .get();
  if (total <= 1) {
    throw fallo('Es la única cuenta de administrador activa: no se puede desactivar');
  }
}

// Cambia el nombre, el correo, repone la contraseña o reactiva la cuenta. El
// rol y la empresa NO se tocan: mover a alguien de un fiado a otro (o volverlo
// operador) cambiaría de golpe todo lo que ve, y es más claro darlo de baja y
// crearlo de nuevo que arriesgarse a dejarlo viendo lo que no le toca.
export async function actualizarUsuario(id, { nombre, email, password, activo }) {
  const usuario = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(Number(id));
  if (!usuario) throw fallo('Usuario no encontrado', 404);

  const sets = [];
  const valores = [];

  if (nombre !== undefined) {
    if (!String(nombre).trim()) throw fallo('El nombre es obligatorio');
    sets.push('nombre = ?');
    valores.push(String(nombre).trim());
  }
  if (email !== undefined) {
    // Se valida contra el rol que YA tiene: una cuenta de Fortex no puede
    // mudarse a un correo de fuera cambiándole la dirección.
    sets.push('email = ?');
    valores.push(validarCorreo(email, usuario.role));
  }
  if (password !== undefined) {
    sets.push('password_hash = ?');
    valores.push(bcrypt.hashSync(validarPassword(password), 10));
  }
  if (activo !== undefined) {
    if (!activo) await exigirQueQuedeUnAdmin(usuario);
    sets.push('activo = ?');
    valores.push(activo ? 1 : 0);
  }

  if (!sets.length) throw fallo('Nada que actualizar');
  try {
    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...valores, Number(id));
  } catch {
    throw fallo('Ya hay otra cuenta con ese correo', 409);
  }

  // Al reponer la contraseña por aquí, los enlaces de recuperación que ya se
  // hubieran mandado dejan de servir. Si no, reponer la cuenta de alguien por
  // sospecha de que le entraron no serviría de nada: un enlace viejo todavía
  // en su correo alcanzaría para volver a cambiarla.
  if (password !== undefined) await invalidarEnlaces(id);
}

// Baja lógica: el usuario deja de entrar pero sigue en la lista, marcado como
// inactivo. Es lo correcto para alguien que sí trabajó: queda el rastro de que
// existió y se puede reactivar.
export async function desactivarUsuario(id) {
  const usuario = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(Number(id));
  if (!usuario) throw fallo('Usuario no encontrado', 404);

  await exigirQueQuedeUnAdmin(usuario);
  await db.prepare('UPDATE users SET activo = 0 WHERE id = ?').run(Number(id));
}

// Baja definitiva: para cuentas que nunca debieron existir (las de demostración,
// o una creada con el correo equivocado). Desactivarlas las deja estorbando en
// la lista para siempre.
//
// Si era titular de alguna cuenta, esa queda sin vendedor en vez de perderse
// (clients.vendedor_id es ON DELETE SET NULL).
export async function eliminarUsuario(id, { solicitanteId } = {}) {
  const usuario = await db.prepare('SELECT id, role FROM users WHERE id = ?').get(Number(id));
  if (!usuario) throw fallo('Usuario no encontrado', 404);

  // Borrarse a sí mismo deja al portal sin quien lo administre en cuanto expire
  // la sesión que se está usando para hacerlo.
  if (Number(id) === Number(solicitanteId)) {
    throw fallo('No puedes borrar tu propia cuenta. Pídeselo a otro administrador.');
  }
  await exigirQueQuedeUnAdmin(usuario);

  await db.prepare('DELETE FROM users WHERE id = ?').run(Number(id));
}
