import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken, requireAuth } from '../auth/middleware.js';

const router = Router();

// Los datos que el front necesita del usuario. La razón social viene de la
// empresa, no de la persona: el admin y los vendedores no tienen.
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

// GET /api/auth/me  -> datos del usuario autenticado
router.get('/me', requireAuth, async (req, res) => {
  const usuario = await db
    .prepare(`${SELECT_USUARIO} WHERE u.id = ? AND u.activo = 1`)
    .get(req.user.id);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user: paraElFront(usuario) });
});

export default router;
