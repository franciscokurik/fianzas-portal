// El portal del CONTRATANTE: el desarrollador que no compra fianzas, las exige.
//
// Es el hermano de routes/dashboard.js + routes/fianzas.js, pero para la otra
// clase de empresa (clients.tipo = 'contratante'). Todo aquí es de LECTURA: un
// contratante no captura nada en el portal. Lo que ve de cada proveedor lo
// acota el servicio, y lo poco que se descarga vuelve a comprobarse en
// lib/permisos.js.
import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireContratante } from '../auth/middleware.js';
import { exigirProveedor, urlDeDocumentoParaContratante } from '../lib/permisos.js';
import { panoramaDelContratante } from '../services/proveedores.js';
import { nombreTipoDoc } from '../lib/documentos.js';

const router = Router();

// Le pone nombre legible al tipo de documento, igual que en el portal del fiado.
const conNombres = (documentos = []) =>
  documentos.map((d) => ({ ...d, tipo_doc_nombre: nombreTipoDoc('fianza', d.tipo_doc) }));

// GET /api/proveedores -> el padrón con el cumplimiento de cada proveedor
router.get('/', requireAuth, requireContratante, async (req, res) => {
  const contratanteId = req.user.client_id;

  const empresa = await db
    .prepare('SELECT razon_social FROM clients WHERE id = ?')
    .get(contratanteId);
  if (!empresa) return res.status(404).json({ error: 'Cliente no encontrado' });

  // Van también las obras con sus fianzas: es la MISMA carga que ya se armó, y
  // así la pantalla puede abrir un proveedor sin otro viaje a la API.
  const { proveedores, obras, metricas } = await panoramaDelContratante(contratanteId);

  res.json({
    razon_social: empresa.razon_social,
    metricas,
    proveedores,
    obras: obras.map((o) => ({
      ...o,
      fianzas: o.fianzas.map((f) => ({ ...f, documentos: conNombres(f.documentos) })),
    })),
  });
});

// GET /api/proveedores/:id -> las obras que ese proveedor ejecuta PARA MÍ,
// con sus fianzas. Nada de sus otras obras, ni de su expediente, ni sus primas.
router.get('/:id(\\d+)', requireAuth, requireContratante, async (req, res) => {
  const contratanteId = req.user.client_id;
  const proveedorId = Number(req.params.id);

  // Que esté en el padrón. Si no, 404: decir "existe pero no es tuyo" ya le
  // confirmaría a quien va probando ids que esa empresa es cliente de Fortex.
  await exigirProveedor(contratanteId, proveedorId);

  const { proveedores, obras } = await panoramaDelContratante(contratanteId);
  const proveedor = proveedores.find((p) => p.id === proveedorId);

  const suyas = obras
    .filter((o) => o.client_id === proveedorId)
    .map((o) => ({ ...o, fianzas: o.fianzas.map((f) => ({ ...f, documentos: conNombres(f.documentos) })) }));

  res.json({ proveedor, obras: suyas });
});

// GET /api/proveedores/documentos/:id -> descarga la carátula de una fianza.
//
// La comprobación es la que importa: sin ella, cambiar el id en la URL dejaría
// bajar el papel de una obra que este contratante no tiene por qué ver — la que
// el mismo proveedor hace para su competencia, por ejemplo.
router.get('/documentos/:id', requireAuth, requireContratante, async (req, res) => {
  const url = await urlDeDocumentoParaContratante(req.user.client_id, req.params.id);
  if (!url || !/^https:\/\//.test(url)) {
    return res.status(404).json({ error: 'Documento no disponible' });
  }
  res.redirect(url);
});

export default router;
