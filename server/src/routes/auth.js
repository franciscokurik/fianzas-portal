import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken, requireAuth } from '../auth/middleware.js';
import { pedirRecuperacion, restablecer } from '../services/recuperacion.js';

const router = Router();

// De dónde sale el enlace que se manda por correo. Se prefiere APP_URL porque
// es lo único que no depende de por dónde entró la petición; si no está, se
// arma con la cabecera que puso el proxy de la plataforma.
function urlDelPortal(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const protocolo = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  return `${protocolo}://${req.get('host')}`;
}

// Los datos que el front necesita del usuario. La razón social viene de la
// empresa, no de la persona: el personal de Fortex no tiene.
const SELECT_USUARIO = `
  SELECT u.id, u.nombre, u.email, u.role, u.activo, u.password_hash,
         u.client_id, c.razon_social, c.rfc
  FROM users u
  LEFT JOIN clients c ON c.id = u.client_id
`;

const paraElFront = (u) => ({
  id: u.id,
  nombre: u.nombre,
  email: u.email,
  role: u.role,
  client_id: u.client_id,
  razon_social: u.razon_social,
  rfc: u.rfc,
});

// Se entra con el correo. El RFC se sigue aceptando como atajo, pero solo
// cuando la empresa tiene UNA cuenta activa: en cuanto hay varias personas, el
// RFC ya no identifica a nadie en particular. Los fiados que venían de antes
// tienen una sola cuenta, así que no pierden su forma de entrar de siempre.
async function buscarUsuario(identificador) {
  const porCorreo = await db
    .prepare(`${SELECT_USUARIO} WHERE lower(u.email) = lower(?) AND u.activo = 1 LIMIT 1`)
    .get(identificador);
  if (porCorreo) return porCorreo;

  const porRfc = await db
    .prepare(`${SELECT_USUARIO} WHERE upper(c.rfc) = upper(?) AND u.activo = 1`)
    .all(identificador);
  return porRfc.length === 1 ? porRfc[0] : null;
}

// POST /api/auth/login  { identificador, password }
router.post('/login', async (req, res) => {
  const { identificador, password } = req.body || {};
  if (!identificador || !password) {
    return res.status(400).json({ error: 'Faltan credenciales' });
  }

  const usuario = await buscarUsuario(String(identificador).trim());

  // El mismo mensaje falle lo que falle: distinguir "no existe" de "contraseña
  // incorrecta" le regala a cualquiera la lista de correos dados de alta.
  if (!usuario || !bcrypt.compareSync(password, usuario.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  res.json({ token: signToken(usuario), user: paraElFront(usuario) });
});

// POST /api/auth/recuperar  { email } -> manda el enlace para reponer la clave
//
// Responde lo MISMO exista o no la cuenta. Si contestara distinto, cualquiera
// podría ir probando correos para averiguar quiénes son clientes de Fortex.
router.post('/recuperar', async (req, res) => {
  const email = String(req.body?.email || '').trim();

  if (email) {
    try {
      await pedirRecuperacion(email, urlDelPortal(req));
    } catch (e) {
      // Si el correo saliente está mal configurado, el usuario no tiene cómo
      // saberlo ni cómo arreglarlo; queda en el log para quien sí puede.
      console.error('[recuperacion] no se pudo mandar el correo:', e.message);
    }
  }

  res.json({
    ok: true,
    mensaje: 'Si ese correo tiene una cuenta activa, te llegará un enlace en unos minutos.',
  });
});

// POST /api/auth/restablecer  { token, password }
router.post('/restablecer', async (req, res) => {
  await restablecer(req.body?.token, req.body?.password);
  res.json({ ok: true, mensaje: 'Contraseña actualizada. Ya puedes entrar con ella.' });
});

// GET /api/auth/me  -> datos del usuario autenticado
router.get('/me', requireAuth, async (req, res) => {
  const usuario = await db
    .prepare(`${SELECT_USUARIO} WHERE u.id = ? AND u.activo = 1`)
    .get(req.user.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: paraElFront(usuario) });
});

export default router;
