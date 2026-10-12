// /api/integracion — lo que otros sistemas de Fortex le leen al portal.
//
// Del otro lado no hay una PERSONA sino otro servidor: hoy, Fortex HRM, que
// arma el estado de cuenta de cada asesor y necesita las comisiones de sus
// fianzas. Por eso aquí no hay JWT ni roles: la puerta es una llave compartida
// (HRM_API_KEY) que llega en el encabezado Authorization: Bearer.
//
// Falla CERRADO. Sin la llave configurada no le contesta a nadie: si olvidar la
// variable dejara la puerta abierta, las comisiones de todos los vendedores
// quedarían a un GET de distancia. Y tampoco acepta una llave corta, que se
// adivina; se genera con `openssl rand -hex 32`.
//
// Solo lectura, a propósito. Si algún día HRM tiene que escribir aquí, va en
// otra ruta con otra llave, no colgado de esta.
import { Router } from 'express';
import crypto from 'node:crypto';
import { comisionesParaHrm, fechaISO } from '../services/comisiones.js';

const LARGO_MINIMO = 32;

const router = Router();

// Compara sin que el tiempo de respuesta delate cuántos caracteres se atinaron.
// Se comparan los hashes y no las llaves porque timingSafeEqual exige el mismo
// largo, y rechazar antes por largo distinto ya le diría el largo de la buena.
function mismaLlave(a, b) {
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
}

router.use((req, res, next) => {
  const llave = process.env.HRM_API_KEY || '';
  if (llave.length < LARGO_MINIMO) {
    return res.status(503).json({
      error: llave
        ? `La llave de integración es demasiado corta: HRM_API_KEY necesita al menos ${LARGO_MINIMO} caracteres.`
        : 'La integración con HRM no está configurada: falta HRM_API_KEY.',
    });
  }
  const header = req.headers.authorization || '';
  const recibida = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!recibida || !mismaLlave(recibida, llave)) {
    return res.status(401).json({ error: 'Llave de integración inválida' });
  }
  next();
});

// GET /api/integracion/comisiones?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
//   -> las comisiones CONCILIADAS en ese periodo, con el correo del vendedor.
// Las dos fechas son obligatorias: sin ellas la respuesta crecería con cada
// año de historia, y HRM siempre pregunta por un año concreto.
router.get('/comisiones', async (req, res) => {
  const desde = fechaISO(req.query.desde);
  const hasta = fechaISO(req.query.hasta);
  if (!desde || !hasta) {
    return res.status(400).json({ error: 'Indica el periodo: desde y hasta, como AAAA-MM-DD.' });
  }
  if (desde > hasta) {
    return res.status(400).json({ error: 'El periodo está al revés: desde es posterior a hasta.' });
  }
  res.json({ desde, hasta, comisiones: await comisionesParaHrm({ desde, hasta }) });
});

export default router;
