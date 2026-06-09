import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { signToken, requireAuth } from '../auth/middleware.js';

const router = Router();

// POST /api/auth/login  { identificador, password }
// identificador puede ser RFC o correo
router.post('/login', (req, res) => {
  const { identificador, password } = req.body || {};
  if (!identificador || !password) {
    return res.status(400).json({ error: 'Faltan credenciales' });
  }

  const id = String(identificador).trim();
  const user = db
    .prepare(
      `SELECT * FROM clients
       WHERE lower(email) = lower(?) OR upper(rfc) = upper(?)
       LIMIT 1`
    )
    .get(id, id);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      razon_social: user.razon_social,
      email: user.email,
      rfc: user.rfc,
      role: user.role,
    },
  });
});

// GET /api/auth/me  -> datos del usuario autenticado
router.get('/me', requireAuth, (req, res) => {
  const user = db
    .prepare('SELECT id, razon_social, email, rfc, role FROM clients WHERE id = ?')
    .get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ user });
});

export default router;
