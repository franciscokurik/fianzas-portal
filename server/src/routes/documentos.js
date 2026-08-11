import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireCliente } from '../auth/middleware.js';
import { borrarArchivo } from '../lib/upload.js';
import { adoptarArchivo } from '../services/subidas.js';
import { guardarDocumentoCliente, exigirTipoDocumento } from '../services/documentos-cliente.js';
import { estadoDocumento, todayISO, daysUntil } from '../lib/dates.js';

const router = Router();

// GET /api/documentos -> lista de documentos estándar + estatus del cliente
router.get('/', requireAuth, requireCliente, async (req, res) => {
  const clientId = req.user.client_id;

  const tipos = await db
    .prepare('SELECT * FROM document_types ORDER BY orden, id')
    .all();

  const docs = await Promise.all(tipos.map(async (t) => {
    const subido = await db
      .prepare(
        'SELECT * FROM client_documents WHERE client_id = ? AND document_type_id = ?'
      )
      .get(clientId, t.id);

    const estado = estadoDocumento({
      uploaded: !!subido,
      vencimiento: subido?.vencimiento,
      alertaDias: t.alerta_dias,
    });

    return {
      document_type_id: t.id,
      nombre: t.nombre,
      slug: t.slug,
      periodicidad_meses: t.periodicidad_meses,
      alerta_dias: t.alerta_dias,
      estado,
      uploaded_at: subido?.uploaded_at || null,
      vencimiento: subido?.vencimiento || null,
      dias_para_vencer: subido?.vencimiento ? daysUntil(subido.vencimiento) : null,
      original_name: subido?.original_name || null,
      // Para que el fiado no vuelva a subir algo que Fortex ya cargó por él.
      subido_por: subido?.subido_por || null,
      has_file: !!subido,
    };
  }));

  res.json({ documentos: docs });
});

// POST /api/documentos/:typeId  { public_id, nombre }
//
// El archivo ya está en Cloudinary: el navegador lo subió directo con la firma
// de /api/subidas/firma y aquí solo llega dónde quedó. El mismo trabajo lo hace
// el admin desde /api/admin/clientes/:id/documentos/:typeId, así que la lógica
// vive en el servicio y aquí solo se fija de quién es el archivo.
router.post('/:typeId', requireAuth, requireCliente, async (req, res) => {
  // Primero lo barato: si el tipo no existe, se rechaza sin haber adoptado el
  // archivo, que ya está en Cloudinary y habría que ir a borrar.
  await exigirTipoDocumento(Number(req.params.typeId));

  const archivo = await adoptarArchivo({
    publicId: req.body?.public_id,
    clientId: req.user.client_id,
    nombre: req.body?.nombre,
  });

  const { vencimiento } = await guardarDocumentoCliente({
    clientId: req.user.client_id,
    typeId: Number(req.params.typeId),
    archivo,
    subidoPor: 'cliente',
  });
  res.json({ ok: true, vencimiento });
});

// --- Papelería específica por afianzadora/póliza ---

// GET /api/documentos/papeleria -> solicitudes para el cliente
router.get('/papeleria', requireAuth, requireCliente, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT p.*, a.nombre AS afianzadora_nombre, f.numero_poliza
       FROM papeleria_requests p
       LEFT JOIN afianzadoras a ON a.id = p.afianzadora_id
       LEFT JOIN fianzas f ON f.id = p.fianza_id
       WHERE p.client_id = ?
       ORDER BY (p.estado = 'entregado'), p.created_at DESC`
    )
    .all(req.user.client_id);
  res.json({ papeleria: rows });
});

// POST /api/documentos/papeleria/:id  { public_id, nombre } -> el fiado responde
router.post('/papeleria/:id', requireAuth, requireCliente, async (req, res) => {
  const id = Number(req.params.id);
  const sol = await db
    .prepare('SELECT * FROM papeleria_requests WHERE id = ? AND client_id = ?')
    .get(id, req.user.client_id);
  if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });

  const archivo = await adoptarArchivo({
    publicId: req.body?.public_id,
    clientId: req.user.client_id,
    nombre: req.body?.nombre,
  });

  await db.prepare(
    `UPDATE papeleria_requests
     SET estado = 'entregado', file_path = ?, original_name = ?, uploaded_at = ?
     WHERE id = ?`
  ).run(archivo.url, archivo.nombre, todayISO(), id);

  // El anterior se borra al final: si algo falla antes, la solicitud conserva el
  // archivo que ya tenía.
  if (sol.file_path && sol.file_path !== archivo.url) await borrarArchivo(sol.file_path);

  res.json({ ok: true });
});

// GET /api/documentos/descargar/:typeId -> redirige al archivo público del cliente
router.get('/descargar/:typeId', requireAuth, requireCliente, async (req, res) => {
  const doc = await db
    .prepare('SELECT * FROM client_documents WHERE client_id = ? AND document_type_id = ?')
    .get(req.user.client_id, Number(req.params.typeId));
  if (!doc || !/^https:\/\//.test(doc.file_path || '')) {
    return res.status(404).json({ error: 'Sin archivo' });
  }
  res.redirect(doc.file_path);
});

export default router;
