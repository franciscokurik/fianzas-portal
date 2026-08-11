import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET || 'dev-secret-cambiar';

// El token lleva QUIÉN es (id de usuario) y DE QUIÉN (client_id). Antes eran el
// mismo número porque la empresa era el usuario; ahora una constructora tiene
// varias cuentas y hay que distinguirlos: el id identifica a la persona y el
// client_id dice de qué fiado son los datos que puede ver.
export function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      client_id: user.client_id ?? null,
      nombre: user.nombre ?? user.razon_social ?? null,
    },
    SECRET,
    { expiresIn: '8h' }
  );
}

// Verifica el token Bearer y adjunta req.user
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Exige rol admin. Lo que solo puede hacer la administración de Fortex:
// dar de alta clientes y usuarios, mover líneas de crédito y tocar catálogos.
export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Requiere permisos de administrador' });
  }
  next();
}

// Personal de Fortex: admin o vendedor. Los dos entran al panel; lo que el
// vendedor alcanza lo acota su cartera (ver lib/cartera.js).
export function requireInterno(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'vendedor') {
    return res.status(403).json({ error: 'Requiere una cuenta de Fortex' });
  }
  next();
}

// Rutas del portal del fiado. Un admin o un vendedor no tienen empresa propia,
// así que aquí no van: sin esto, sus consultas saldrían vacías y parecería que
// el fiado no tiene nada, en vez de decir que se equivocaron de pantalla.
export function requireCliente(req, res, next) {
  if (!req.user?.client_id) {
    return res.status(403).json({
      error: 'Esta sección es para usuarios de un fiado. Entra al panel de Fortex.',
    });
  }
  next();
}
