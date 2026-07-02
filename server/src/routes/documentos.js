import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { upload, subirArchivo, borrarArchivo } from '../lib/upload.js';
import { estadoDocumento, todayISO, addMonths, daysUntil } from '../lib/dates.js';

const router = Router();

// GET /api/documentos -> lista de documentos estándar + estatus del cliente
router.get('/', requireAuth, async (req, res) => {
  const clientId = req.user.id;

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
      has_file: !!subido,
    };
  }));

  res.json({ documentos: docs });
});

// POST /api/documentos/:typeId  (multipart: archivo)
router.post('/:typeId', requireAuth, upload.single('archivo'), async (req, res) => {
  const clientId = req.user.id;
  const typeId = Number(req.params.typeId);

  const tipo = await db.prepare('SELECT * FROM document_types WHERE id = ?').get(typeId);
  if (!tipo) return res.status(404).json({ error: 'Tipo de documento no válido' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

  const hoy = todayISO();
  const vencimiento = tipo.periodicidad_meses
    ? addMonths(hoy, tipo.periodicidad_meses)
    : null;

  // Borra el archivo anterior si existía (reemplazo)
  const prev = await db
    .prepare('SELECT file_path FROM client_documents WHERE client_id = ? AND document_type_id = ?')
    .get(clientId, typeId);
  if (prev?.file_path) await borrarArchivo(prev.file_path);

  const url = await subirArchivo(req.file, clientId);

  await db.prepare(
    `INSERT INTO client_documents
       (client_id, document_type_id, file_path, original_name, mime_type, size_bytes, uploaded_at, vencimiento)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id, document_type_id) DO UPDATE SET
       file_path = excluded.file_path,
       original_name = excluded.original_name,
       mime_type = excluded.mime_type,
       size_bytes = excluded.size_bytes,
       uploaded_at = excluded.uploaded_at,
       vencimiento = excluded.vencimiento`
  ).run(
    clientId, typeId, url, req.file.originalname,
    req.file.mimetype, req.file.size, hoy, vencimiento
  );

  res.json({ ok: true, vencimiento });
});

// --- Papelería específica por afianzadora/póliza ---

// GET /api/documentos/papeleria -> solicitudes para el cliente
router.get('/papeleria', requireAuth, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT p.*, a.nombre AS afianzadora_nombre, f.numero_poliza
       FROM papeleria_requests p
       LEFT JOIN afianzadoras a ON a.id = p.afianzadora_id
       LEFT JOIN fianzas f ON f.id = p.fianza_id
       WHERE p.client_id = ?
       ORDER BY (p.estado = 'entregado'), p.created_at DESC`
    )
    .all(req.user.id);
  res.json({ papeleria: rows });
});

// POST /api/documentos/papeleria/:id  (multipart: archivo) -> cliente responde
router.post('/papeleria/:id', requireAuth, upload.single('archivo'), async (req, res) => {
  const id = Number(req.params.id);
  const sol = await db
    .prepare('SELECT * FROM papeleria_requests WHERE id = ? AND client_id = ?')
    .get(id, req.user.id);
  if (!sol) return res.status(404).json({ error: 'Solicitud no encontrada' });
  if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });

  if (sol.file_path) await borrarArchivo(sol.file_path);
  const url = await subirArchivo(req.file, req.user.id);

  await db.prepare(
    `UPDATE papeleria_requests
     SET estado = 'entregado', file_path = ?, original_name = ?, uploaded_at = ?
     WHERE id = ?`
  ).run(url, req.file.originalname, todayISO(), id);

  res.json({ ok: true });
});

// GET /api/documentos/descargar/:typeId -> redirige al archivo público del cliente
router.get('/descargar/:typeId', requireAuth, async (req, res) => {
  const doc = await db
    .prepare('SELECT * FROM client_documents WHERE client_id = ? AND document_type_id = ?')
    .get(req.user.id, Number(req.params.typeId));
  if (!doc || !/^https:\/\//.test(doc.file_path || '')) {
    return res.status(404).json({ error: 'Sin archivo' });
  }
  res.redirect(doc.file_path);
});

export default router;
