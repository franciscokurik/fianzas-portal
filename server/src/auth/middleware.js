import jwt from 'jsonwebtoken';
import { tipoDeCliente } from '../lib/permisos.js';

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

const ROLES_INTERNOS = ['admin', 'operador', 'vendedor'];

// Personal de Fortex: los tres niveles entran al panel. Lo que cada uno alcanza
// se decide después: el vendedor solo su cartera (lib/permisos.js) y las rutas
// que ni siquiera le tocan van marcadas con requireOperador o requireAdmin.
export function requireInterno(req, res, next) {
  if (!ROLES_INTERNOS.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Requiere una cuenta de Fortex' });
  }
  next();
}

// Deja fuera al vendedor. Es para lo que no es "de un cliente" sino de la casa:
// dar de alta empresas, mover líneas de crédito y cambiar los catálogos que ven
// TODOS los fiados. El vendedor solo puede con lo suyo, y esto no es suyo.
export function requireOperador(req, res, next) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'operador') {
    return res.status(403).json({
      error: 'Solo un operador o un administrador puede hacer esto',
    });
  }
  next();
}

// Las dos mitades del portal del cliente. Un fiado y un contratante entran por
// la misma puerta pero a pantallas distintas, y sus rutas NO se cruzan: sin
// esto, un contratante que abriera /api/dashboard vería todo en ceros y
// parecería que se le perdió la información, en vez de decirle que se equivocó
// de pantalla.
//
// El personal de Fortex tampoco va aquí: no tiene empresa propia.
//
// El tipo se pregunta a la base en cada petición y no se lee del token, que
// vive ocho horas: de esto depende qué se puede leer.
function exigirTipoDeCliente(esperado, siNoEs) {
  return async function (req, res, next) {
    if (!req.user?.client_id) {
      return res.status(403).json({
        error: 'Esta sección es para usuarios de un cliente. Entra al panel de Fortex.',
      });
    }
    if ((await tipoDeCliente(req.user.client_id)) !== esperado) {
      return res.status(403).json({ error: siNoEs });
    }
    next();
  };
}

// El portal de siempre: sus fianzas, su expediente, su papelería.
export const requireFiado = exigirTipoDeCliente(
  'fiado',
  'Tu cuenta es de un contratante. Tus fianzas no están aquí: entra a "Mis proveedores".'
);

// El portal del desarrollador: el padrón de proveedores y su cumplimiento.
export const requireContratante = exigirTipoDeCliente(
  'contratante',
  'Esta sección es para contratantes que vigilan la fianza de sus proveedores.'
);
