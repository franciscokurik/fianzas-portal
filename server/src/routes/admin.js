import { Router } from 'express';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { UPLOADS_DIR } from '../lib/upload.js';
import { estadoFianza } from '../lib/dates.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// --- Clientes ---

// GET /api/admin/clientes -> todos los clientes con estatus general
router.get('/clientes', (req, res) => {
  const clientes = db
    .prepare(`SELECT id, razon_social, rfc, email FROM clients WHERE role = 'client' ORDER BY razon_social`)
    .all();

  const enriquecidos = clientes.map((c) => {
    const fianzas = db.prepare('SELECT fecha_vigencia FROM fianzas WHERE client_id = ?').all(c.id);
    const porVencer = fianzas.filter((f) => estadoFianza(f.fecha_vigencia) === 'por_vencer').length;
    const vencidas = fianzas.filter((f) => estadoFianza(f.fecha_vigencia) === 'vencida').length;

    const docsPendientes = db.prepare(
      `SELECT COUNT(*) c FROM document_types dt
       LEFT JOIN client_documents cd ON cd.document_type_id = dt.id AND cd.client_id = ?
       WHERE cd.id IS NULL`
    ).get(c.id).c;

    const papeleriaPend = db.prepare(
      `SELECT COUNT(*) c FROM papeleria_requests WHERE client_id = ? AND estado = 'pendiente'`
    ).get(c.id).c;

    return {
      ...c,
      total_fianzas: fianzas.length,
      fianzas_por_vencer: porVencer,
      fianzas_vencidas: vencidas,
      docs_pendientes: docsPendientes,
      papeleria_pendiente: papeleriaPend,
    };
  });

  res.json({ clientes: enriquecidos });
});

// POST /api/admin/clientes -> alta de cliente
router.post('/clientes', (req, res) => {
  const { razon_social, rfc, email, password, telefono } = req.body || {};
  if (!razon_social || !email || !password) {
    return res.status(400).json({ error: 'razon_social, email y password son obligatorios' });
  }
  try {
    const info = db.prepare(
      `INSERT INTO clients (razon_social, rfc, email, password_hash, telefono)
       VALUES (?, ?, ?, ?, ?)`
    ).run(razon_social, rfc || null, email, bcrypt.hashSync(password, 10), telefono || null);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'No se pudo crear (¿RFC o email duplicado?)', detail: e.message });
  }
});

// PUT /api/admin/clientes/:id -> actualizar datos básicos
router.put('/clientes/:id', (req, res) => {
  const { razon_social, telefono } = req.body || {};
  db.prepare(
    `UPDATE clients SET razon_social = COALESCE(?, razon_social),
       telefono = COALESCE(?, telefono)
     WHERE id = ?`
  ).run(razon_social ?? null, telefono ?? null, Number(req.params.id));
  res.json({ ok: true });
});

// PUT /api/admin/clientes/:id/lineas -> fijar/actualizar la línea de una afianzadora (upsert)
router.put('/clientes/:id/lineas', (req, res) => {
  const clientId = Number(req.params.id);
  const { afianzadora_id, linea_credito } = req.body || {};
  if (!afianzadora_id) return res.status(400).json({ error: 'afianzadora_id requerido' });
  db.prepare(
    `INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito)
     VALUES (?, ?, ?)
     ON CONFLICT(client_id, afianzadora_id)
       DO UPDATE SET linea_credito = excluded.linea_credito`
  ).run(clientId, Number(afianzadora_id), Number(linea_credito) || 0);
  res.json({ ok: true });
});

// DELETE /api/admin/clientes/:id/lineas/:afianzadoraId -> quitar línea de una afianzadora
router.delete('/clientes/:id/lineas/:afianzadoraId', (req, res) => {
  db.prepare(
    'DELETE FROM client_credit_lines WHERE client_id = ? AND afianzadora_id = ?'
  ).run(Number(req.params.id), Number(req.params.afianzadoraId));
  res.json({ ok: true });
});

// --- Afianzadoras ---

router.get('/afianzadoras', (req, res) => {
  res.json({ afianzadoras: db.prepare('SELECT * FROM afianzadoras ORDER BY nombre').all() });
});

// POST /api/admin/afianzadoras -> agregar nueva afianzadora (escalable)
router.post('/afianzadoras', (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const slug = String(nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    const info = db.prepare('INSERT INTO afianzadoras (nombre, slug) VALUES (?, ?)').run(nombre, slug);
    res.json({ ok: true, id: info.lastInsertRowid, slug });
  } catch (e) {
    res.status(400).json({ error: 'Afianzadora duplicada', detail: e.message });
  }
});

// --- Fianzas (pólizas) ---

// POST /api/admin/fianzas -> cargar/actualizar póliza de un cliente
router.post('/fianzas', (req, res) => {
  const { client_id, afianzadora_id, numero_poliza, tipo_fianza,
          prima_neta, monto_afianzado, fecha_inicio, fecha_vigencia } = req.body || {};
  if (!client_id || !afianzadora_id || !numero_poliza || !tipo_fianza) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  const info = db.prepare(
    `INSERT INTO fianzas
       (client_id, afianzadora_id, numero_poliza, tipo_fianza, prima_neta, monto_afianzado, fecha_inicio, fecha_vigencia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(client_id, afianzadora_id, numero_poliza, tipo_fianza,
        Number(prima_neta) || 0, Number(monto_afianzado) || 0,
        fecha_inicio || null, fecha_vigencia || null);
  res.json({ ok: true, id: info.lastInsertRowid });
});

router.put('/fianzas/:id', (req, res) => {
  const f = req.body || {};
  db.prepare(
    `UPDATE fianzas SET
       numero_poliza = COALESCE(?, numero_poliza),
       tipo_fianza   = COALESCE(?, tipo_fianza),
       prima_neta    = COALESCE(?, prima_neta),
       monto_afianzado = COALESCE(?, monto_afianzado),
       fecha_inicio  = COALESCE(?, fecha_inicio),
       fecha_vigencia = COALESCE(?, fecha_vigencia)
     WHERE id = ?`
  ).run(f.numero_poliza ?? null, f.tipo_fianza ?? null, f.prima_neta ?? null,
        f.monto_afianzado ?? null, f.fecha_inicio ?? null, f.fecha_vigencia ?? null,
        Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/fianzas/:id', (req, res) => {
  db.prepare('DELETE FROM fianzas WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- Papelería específica (solicitudes que crea Fortex) ---

// POST /api/admin/papeleria -> crear solicitud puntual para un cliente
router.post('/papeleria', (req, res) => {
  const { client_id, afianzadora_id, fianza_id, descripcion } = req.body || {};
  if (!client_id || !descripcion) {
    return res.status(400).json({ error: 'client_id y descripcion requeridos' });
  }
  const info = db.prepare(
    `INSERT INTO papeleria_requests (client_id, afianzadora_id, fianza_id, descripcion)
     VALUES (?, ?, ?, ?)`
  ).run(client_id, afianzadora_id || null, fianza_id || null, descripcion);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// GET /api/admin/clientes/:id/detalle -> fianzas, documentos y papelería de un cliente
router.get('/clientes/:id/detalle', (req, res) => {
  const id = Number(req.params.id);
  const cliente = db.prepare('SELECT id, razon_social, rfc, email, telefono FROM clients WHERE id = ?').get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  const fianzas = db.prepare(
    `SELECT f.*, a.nombre AS afianzadora_nombre FROM fianzas f
     JOIN afianzadoras a ON a.id = f.afianzadora_id WHERE f.client_id = ? ORDER BY f.fecha_vigencia`
  ).all(id).map((f) => ({ ...f, estado: estadoFianza(f.fecha_vigencia) }));

  // Comprometido por afianzadora (fianzas no vencidas)
  const comprometidoPorAfi = new Map();
  for (const f of fianzas) {
    if (f.estado === 'vencida') continue;
    comprometidoPorAfi.set(
      f.afianzadora_id,
      (comprometidoPorAfi.get(f.afianzadora_id) || 0) + (f.monto_afianzado || 0)
    );
  }

  const lineas = db.prepare(
    `SELECT cl.afianzadora_id, a.nombre AS afianzadora_nombre, cl.linea_credito
     FROM client_credit_lines cl
     JOIN afianzadoras a ON a.id = cl.afianzadora_id
     WHERE cl.client_id = ? ORDER BY a.nombre`
  ).all(id).map((l) => {
    const comprometido = comprometidoPorAfi.get(l.afianzadora_id) || 0;
    return {
      ...l,
      linea_credito: l.linea_credito || 0,
      comprometido,
      disponible: (l.linea_credito || 0) - comprometido,
    };
  });

  const documentos = db.prepare(
    `SELECT dt.nombre, dt.id AS document_type_id, cd.uploaded_at, cd.vencimiento, cd.original_name, cd.file_path
     FROM document_types dt
     LEFT JOIN client_documents cd ON cd.document_type_id = dt.id AND cd.client_id = ?
     ORDER BY dt.orden, dt.id`
  ).all(id);

  const papeleria = db.prepare(
    `SELECT p.*, a.nombre AS afianzadora_nombre, f.numero_poliza
     FROM papeleria_requests p
     LEFT JOIN afianzadoras a ON a.id = p.afianzadora_id
     LEFT JOIN fianzas f ON f.id = p.fianza_id
     WHERE p.client_id = ? ORDER BY p.created_at DESC`
  ).all(id);

  res.json({ cliente, lineas, fianzas, documentos, papeleria });
});

// GET /api/admin/descargar?path=client_1/archivo.pdf -> descarga doc subido por cliente
router.get('/descargar', (req, res) => {
  const rel = String(req.query.path || '');
  // Evita path traversal
  const abs = path.normalize(path.join(UPLOADS_DIR, rel));
  if (!abs.startsWith(UPLOADS_DIR)) return res.status(400).json({ error: 'Ruta inválida' });
  res.download(abs);
});

export default router;
