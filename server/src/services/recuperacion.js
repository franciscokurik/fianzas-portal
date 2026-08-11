// Reponer la contraseña olvidada.
//
// Reglas que sostienen esto y conviene no aflojar:
//   1. En la base se guarda el HASH del token, nunca el token. El token en
//      claro solo vive dentro del correo.
//   2. Pedir el enlace responde igual exista o no la cuenta: si respondiera
//      distinto, cualquiera podría averiguar qué correos están dados de alta.
//   3. El enlace caduca y es de un solo uso.
//   4. Al usarlo se invalidan los demás enlaces de esa persona: si pidió tres
//      porque no le llegaba, los otros dos dejan de servir.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { sendEmail } from './email.js';

// Una hora alcanza para ir al correo y volver, y es poco para que el enlace
// ande vivo en una bandeja de entrada ajena.
const VIGENCIA_HORAS = 1;

// La hora la pone Postgres y no el proceso: en serverless cada invocación
// corre en una máquina distinta y los relojes no tienen por qué coincidir.
const AHORA = `to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')`;
const CADUCA = `to_char((now() AT TIME ZONE 'UTC') + interval '${VIGENCIA_HORAS} hour', 'YYYY-MM-DD HH24:MI:SS')`;

const hashDe = (token) => crypto.createHash('sha256').update(token).digest('hex');

function fallo(mensaje, status = 400) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Tumba los enlaces pendientes de una persona.
//
// Se llama al pedir uno nuevo, al usarlo, y también cuando le cambian la
// contraseña por otra vía (desde el panel): un enlace emitido antes seguiría
// sirviendo para volver a cambiarla, que es justo lo que se quiere cortar
// cuando se repone una cuenta por sospecha de que alguien más entró.
export async function invalidarEnlaces(userId) {
  await db.prepare(
    `UPDATE password_resets SET usado_el = ${AHORA}
     WHERE user_id = ? AND usado_el IS NULL`
  ).run(Number(userId));
}

// Genera el enlace y lo manda. Devuelve el token SOLO para que las pruebas
// puedan seguir el flujo; las rutas no lo exponen jamás.
export async function pedirRecuperacion(email, urlDelPortal) {
  const usuario = await db
    .prepare('SELECT id, nombre, email FROM users WHERE lower(email) = lower(?) AND activo = 1')
    .get(String(email || '').trim());

  // Sin cuenta no hay nada que hacer, pero quien preguntó recibe la misma
  // respuesta que si la hubiera (eso lo decide la ruta).
  if (!usuario) return null;

  // Los enlaces anteriores dejan de servir: solo el último vale.
  await invalidarEnlaces(usuario.id);

  const token = crypto.randomBytes(32).toString('base64url');
  await db.prepare(
    `INSERT INTO password_resets (user_id, token_hash, expira_el)
     VALUES (?, ?, ${CADUCA})`
  ).run(usuario.id, hashDe(token));

  const enlace = `${urlDelPortal}/restablecer?token=${encodeURIComponent(token)}`;
  await sendEmail({
    to: usuario.email,
    subject: 'Fortex · Restablece tu contraseña',
    text: [
      `Hola ${usuario.nombre}:`,
      '',
      'Alguien pidió reponer la contraseña de tu cuenta en el Portal de Fianzas.',
      `Para elegir una nueva, entra aquí (el enlace vence en ${VIGENCIA_HORAS} hora):`,
      '',
      enlace,
      '',
      'Si no fuiste tú, ignora este correo: tu contraseña sigue igual.',
      '',
      'Este buzón no recibe respuestas.',
    ].join('\n'),
  });

  return { token, enlace };
}

// Cambia la contraseña si el token sirve. Un token vencido, ya usado o
// inventado dan el mismo error a propósito: distinguirlos le diría a quien
// esté probando si va por buen camino.
export async function restablecer(token, password) {
  if (!token) throw fallo('Falta el enlace de recuperación');
  if (String(password || '').length < 8) {
    throw fallo('La contraseña debe tener al menos 8 caracteres');
  }

  const fila = await db.prepare(
    `SELECT pr.id, pr.user_id
     FROM password_resets pr
     JOIN users u ON u.id = pr.user_id AND u.activo = 1
     WHERE pr.token_hash = ?
       AND pr.usado_el IS NULL
       AND pr.expira_el > ${AHORA}`
  ).get(hashDe(token));

  if (!fila) {
    throw fallo('El enlace ya no sirve: pudo vencer o ya haberse usado. Pide uno nuevo.', 400);
  }

  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(password, 10), fila.user_id);

  // Se marca usado ESTE y se tumban los demás de la misma persona.
  await invalidarEnlaces(fila.user_id);

  return { user_id: fila.user_id };
}
