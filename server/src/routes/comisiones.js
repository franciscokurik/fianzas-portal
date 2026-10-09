// /api/comisiones — lo que gana Fortex por cada póliza.
//
// Quién entra, y es la decisión de negocio más delicada del panel:
//
//   admin     -> ve TODAS, las captura una por una o desde Excel, las corrige y
//                las borra.
//   vendedor  -> ve SOLO las suyas (las que se le guardaron al capturarlas) y
//                no puede tocarlas.
//   operador  -> NADA. Ni ver: opera todas las cuentas, pero lo que gana cada
//                vendedor no es asunto de la operación.
//   clientes  -> nada, nunca. requireInterno los deja fuera antes de llegar.
//
// Se dice quién SÍ entra, no quién no: un rol nuevo mañana nace sin acceso.
// Y nada de esto se resuelve escondiendo botones: cada ruta se autentica sola.
import { Router } from 'express';
import { requireAuth, requireInterno, requireAdmin } from '../auth/middleware.js';
import { esAdmin, esVendedor } from '../lib/permisos.js';
import {
  listarComisiones, resumenComisiones, buscarPolizas,
  crearComision, actualizarComision, borrarComision,
  baseParaDescargar, analizarImportacion, aplicarImportacion,
} from '../services/comisiones.js';

const router = Router();

router.use(requireAuth, requireInterno, (req, res, next) => {
  if (esAdmin(req.user) || esVendedor(req.user)) return next();
  return res.status(403).json({
    error: 'Las comisiones solo las ven el administrador y el vendedor de cada póliza.',
  });
});

// El alcance de lectura: null para el admin (todas), el propio id para el
// vendedor. Todas las lecturas pasan por aquí y el servicio lo aplica siempre.
const alcanceDe = (user) => (esAdmin(user) ? null : user.id);

// GET /api/comisiones -> el listado con los filtros de la pantalla
router.get('/', async (req, res) => {
  const { desde, hasta, afianzadora_id, vendedor_id, estado, q } = req.query;
  const comisiones = await listarComisiones(alcanceDe(req.user), {
    desde, hasta, afianzadora_id, estado, q,
    // El filtro de vendedor es del admin. Al vendedor se le ignora: su alcance
    // ya es él mismo, y dejarlo pasar solo serviría para tantear ids ajenos.
    vendedor_id: esAdmin(req.user) ? vendedor_id : undefined,
  });
  res.json({ comisiones });
});

// GET /api/comisiones/resumen -> las cifras de arriba de la pantalla
router.get('/resumen', async (req, res) => {
  res.json(await resumenComisiones(alcanceDe(req.user)));
});

// Lo demás es del administrador.

// GET /api/comisiones/polizas?q= -> buscador para el alta individual
router.get('/polizas', requireAdmin, async (req, res) => {
  res.json({ polizas: await buscarPolizas(req.query.q) });
});

router.post('/', requireAdmin, async (req, res) => {
  const id = await crearComision(req.body || {}, req.user.id);
  res.status(201).json({ ok: true, id });
});

router.put('/:id(\\d+)', requireAdmin, async (req, res) => {
  await actualizarComision(req.params.id, req.body || {});
  res.json({ ok: true });
});

router.delete('/:id(\\d+)', requireAdmin, async (req, res) => {
  await borrarComision(req.params.id);
  res.json({ ok: true });
});

// GET /api/comisiones/base -> los renglones del Excel para la carga masiva.
// Va en JSON y el navegador arma el .xlsx: así el servidor no carga con una
// librería de Excel solo para esto, y el archivo no pasa por el límite de
// tamaño de Vercel.
router.get('/base', requireAdmin, async (req, res) => {
  res.json({ filas: await baseParaDescargar({ afianzadora_id: req.query.afianzadora_id }) });
});

// POST /api/comisiones/importar  { filas, aplicar }
//   aplicar = false -> solo dice qué pasaría (la vista previa).
//   aplicar = true  -> lo guarda, todo o nada.
// Los renglones los lee el navegador del Excel, pero aquí se vuelve a validar
// TODO: no se le cree al navegador ni qué póliza es ni cuánto vale.
router.post('/importar', requireAdmin, async (req, res) => {
  const { filas, aplicar } = req.body || {};
  if (!aplicar) return res.json({ aplicado: false, ...(await analizarImportacion(filas)) });
  try {
    const r = await aplicarImportacion(filas, req.user.id);
    res.json({ aplicado: true, ...r });
  } catch (e) {
    // El 422 trae el análisis completo para que la pantalla diga qué renglones.
    if (e.analisis) return res.status(422).json({ error: e.message, aplicado: false, ...e.analisis });
    throw e;
  }
});

export default router;
