import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { requireAuth, requireAdmin } from '../auth/middleware.js';
import { estadoFianza, daysUntil, todayISO } from '../lib/dates.js';
import { centavos } from '../lib/dinero.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// --- Clientes ---

// GET /api/admin/clientes -> todos los clientes con estatus general
router.get('/clientes', async (req, res) => {
  const clientes = await db
    .prepare(`SELECT id, razon_social, rfc, email FROM clients WHERE role = 'client' ORDER BY razon_social`)
    .all();

  const enriquecidos = await Promise.all(clientes.map(async (c) => {
    const fianzas = await db.prepare(
      `SELECT fecha_vigencia, fecha_recordatorio, recordatorio_atendido_el
       FROM fianzas WHERE client_id = ?`
    ).all(c.id);
    const porVencer = fianzas.filter((f) => estadoFianza(f.fecha_vigencia) === 'por_vencer').length;
    const vencidas = fianzas.filter((f) => estadoFianza(f.fecha_vigencia) === 'vencida').length;
    const recordatorios = fianzas.filter((f) => {
      if (!f.fecha_recordatorio || f.recordatorio_atendido_el) return false;
      const d = daysUntil(f.fecha_recordatorio);
      return d !== null && d <= 7;
    }).length;

    const proyectos = (await db.prepare(
      'SELECT COUNT(*)::int c FROM proyectos WHERE client_id = ?'
    ).get(c.id)).c;

    const docsPendientes = (await db.prepare(
      `SELECT COUNT(*)::int c FROM document_types dt
       LEFT JOIN client_documents cd ON cd.document_type_id = dt.id AND cd.client_id = ?
       WHERE cd.id IS NULL`
    ).get(c.id)).c;

    const papeleriaPend = (await db.prepare(
      `SELECT COUNT(*)::int c FROM papeleria_requests WHERE client_id = ? AND estado = 'pendiente'`
    ).get(c.id)).c;

    return {
      ...c,
      total_proyectos: proyectos,
      total_fianzas: fianzas.length,
      fianzas_por_vencer: porVencer,
      fianzas_vencidas: vencidas,
      recordatorios_pendientes: recordatorios,
      docs_pendientes: docsPendientes,
      papeleria_pendiente: papeleriaPend,
    };
  }));

  res.json({ clientes: enriquecidos });
});

// POST /api/admin/clientes -> alta de cliente
router.post('/clientes', async (req, res) => {
  const { razon_social, rfc, email, password, telefono } = req.body || {};
  if (!razon_social || !email || !password) {
    return res.status(400).json({ error: 'razon_social, email y password son obligatorios' });
  }
  try {
    const row = await db.prepare(
      `INSERT INTO clients (razon_social, rfc, email, password_hash, telefono)
       VALUES (?, ?, ?, ?, ?) RETURNING id`
    ).get(razon_social, rfc || null, email, bcrypt.hashSync(password, 10), telefono || null);
    res.json({ ok: true, id: row.id });
  } catch (e) {
    res.status(400).json({ error: 'No se pudo crear (¿RFC o email duplicado?)', detail: e.message });
  }
});

// PUT /api/admin/clientes/:id -> actualizar datos básicos
router.put('/clientes/:id', async (req, res) => {
  const { razon_social, telefono } = req.body || {};
  await db.prepare(
    `UPDATE clients SET razon_social = COALESCE(?, razon_social),
       telefono = COALESCE(?, telefono)
     WHERE id = ?`
  ).run(razon_social ?? null, telefono ?? null, Number(req.params.id));
  res.json({ ok: true });
});

// PUT /api/admin/clientes/:id/lineas -> fijar/actualizar la línea de una afianzadora (upsert)
router.put('/clientes/:id/lineas', async (req, res) => {
  const clientId = Number(req.params.id);
  const { afianzadora_id, linea_credito } = req.body || {};
  if (!afianzadora_id) return res.status(400).json({ error: 'afianzadora_id requerido' });
  await db.prepare(
    `INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito)
     VALUES (?, ?, ?)
     ON CONFLICT(client_id, afianzadora_id)
       DO UPDATE SET linea_credito = excluded.linea_credito`
  ).run(clientId, Number(afianzadora_id), centavos(linea_credito));
  res.json({ ok: true });
});

// DELETE /api/admin/clientes/:id/lineas/:afianzadoraId -> quitar línea de una afianzadora
router.delete('/clientes/:id/lineas/:afianzadoraId', async (req, res) => {
  await db.prepare(
    'DELETE FROM client_credit_lines WHERE client_id = ? AND afianzadora_id = ?'
  ).run(Number(req.params.id), Number(req.params.afianzadoraId));
  res.json({ ok: true });
});

// --- Afianzadoras ---

router.get('/afianzadoras', async (req, res) => {
  res.json({ afianzadoras: await db.prepare('SELECT * FROM afianzadoras ORDER BY nombre').all() });
});

// POST /api/admin/afianzadoras -> agregar nueva afianzadora (escalable)
router.post('/afianzadoras', async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const slug = String(nombre).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    const row = await db.prepare('INSERT INTO afianzadoras (nombre, slug) VALUES (?, ?) RETURNING id').get(nombre, slug);
    res.json({ ok: true, id: row.id, slug });
  } catch (e) {
    res.status(400).json({ error: 'Afianzadora duplicada', detail: e.message });
  }
});

// --- Catálogo de tipos de fianza ---

router.get('/tipos-fianza', async (req, res) => {
  const tipos = await db
    .prepare('SELECT id, nombre, orden, activo FROM tipos_fianza WHERE activo = 1 ORDER BY orden, nombre')
    .all();
  res.json({ tipos });
});

router.post('/tipos-fianza', async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    // Si el tipo existía y estaba desactivado, se reactiva en vez de duplicarlo.
    const row = await db.prepare(
      `INSERT INTO tipos_fianza (nombre, orden) VALUES (?, 500)
       ON CONFLICT (nombre) DO UPDATE SET activo = 1
       RETURNING id`
    ).get(nombre);
    res.json({ ok: true, id: row.id });
  } catch (e) {
    res.status(400).json({ error: 'No se pudo agregar el tipo', detail: e.message });
  }
});

// Baja lógica: las fianzas que ya lo usan conservan su tipo.
router.delete('/tipos-fianza/:id', async (req, res) => {
  await db.prepare('UPDATE tipos_fianza SET activo = 0 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- Proyectos (obras) ---

const CAMPOS_PROYECTO = ['nombre', 'numero_contrato', 'beneficiario', 'monto_contrato',
                         'fecha_inicio', 'fecha_termino', 'estatus', 'notas'];

router.post('/proyectos', async (req, res) => {
  const { client_id } = req.body || {};
  const nombre = String(req.body?.nombre || '').trim();
  if (!client_id || !nombre) {
    return res.status(400).json({ error: 'client_id y nombre son obligatorios' });
  }
  const row = await db.prepare(
    `INSERT INTO proyectos (client_id, nombre, numero_contrato, beneficiario, monto_contrato,
                            fecha_inicio, fecha_termino, estatus, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(Number(client_id), nombre,
        req.body.numero_contrato || null, req.body.beneficiario || null,
        centavos(req.body.monto_contrato),
        req.body.fecha_inicio || null, req.body.fecha_termino || null,
        req.body.estatus || 'en_proceso', req.body.notas || null);
  res.json({ ok: true, id: row.id });
});

router.put('/proyectos/:id', async (req, res) => {
  const body = { ...(req.body || {}) };
  if ('monto_contrato' in body) body.monto_contrato = centavos(body.monto_contrato);
  const { sets, valores } = camposAActualizar(body, CAMPOS_PROYECTO);
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  await db.prepare(`UPDATE proyectos SET ${sets.join(', ')} WHERE id = ?`)
    .run(...valores, Number(req.params.id));
  res.json({ ok: true });
});

// Solo se permite borrar proyectos sin fianzas: si tiene, hay que moverlas antes.
router.delete('/proyectos/:id', async (req, res) => {
  const id = Number(req.params.id);
  const { c } = await db.prepare('SELECT COUNT(*)::int c FROM fianzas WHERE proyecto_id = ?').get(id);
  if (c > 0) {
    return res.status(400).json({
      error: `El proyecto tiene ${c} fianza(s). Reasígnalas a otro proyecto antes de eliminarlo.`,
    });
  }
  await db.prepare('DELETE FROM proyectos WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Fianzas (pólizas) ---

const CAMPOS_FIANZA = ['proyecto_id', 'afianzadora_id', 'numero_poliza', 'tipo_fianza_id',
                       'prima_neta', 'monto_afianzado', 'fecha_inicio', 'fecha_vigencia',
                       'fecha_recordatorio', 'nota_recordatorio'];

// Construye el SET de un UPDATE solo con los campos que vienen en el body.
// A diferencia de COALESCE, esto sí permite vaciar un campo mandando null.
function camposAActualizar(body, permitidos) {
  const sets = [];
  const valores = [];
  for (const campo of permitidos) {
    if (!(campo in (body || {}))) continue;
    const v = body[campo];
    sets.push(`${campo} = ?`);
    valores.push(v === '' ? null : v);
  }
  return { sets, valores };
}

// Valida que el proyecto exista y sea del cliente; devuelve el error o null.
async function validarProyecto(proyectoId, clientId) {
  if (!proyectoId) return 'Toda fianza debe pertenecer a un proyecto';
  const p = await db.prepare('SELECT client_id FROM proyectos WHERE id = ?').get(Number(proyectoId));
  if (!p) return 'El proyecto no existe';
  if (clientId != null && p.client_id !== Number(clientId)) {
    return 'El proyecto pertenece a otro cliente';
  }
  return null;
}

// El tipo lo manda el catálogo; la fianza solo guarda la referencia.
async function tipoExiste(tipoId) {
  if (!tipoId) return false;
  const t = await db.prepare('SELECT id FROM tipos_fianza WHERE id = ?').get(Number(tipoId));
  return Boolean(t);
}

// POST /api/admin/fianzas -> alta de póliza dentro de un proyecto
router.post('/fianzas', async (req, res) => {
  const { client_id, proyecto_id, afianzadora_id, numero_poliza, tipo_fianza_id,
          prima_neta, monto_afianzado, fecha_inicio, fecha_vigencia,
          fecha_recordatorio, nota_recordatorio } = req.body || {};

  if (!client_id || !afianzadora_id || !numero_poliza) {
    return res.status(400).json({ error: 'Cliente, afianzadora y número de póliza son obligatorios' });
  }
  const errProyecto = await validarProyecto(proyecto_id, client_id);
  if (errProyecto) return res.status(400).json({ error: errProyecto });

  if (!(await tipoExiste(tipo_fianza_id))) {
    return res.status(400).json({ error: 'Selecciona un tipo de fianza del catálogo' });
  }

  const row = await db.prepare(
    `INSERT INTO fianzas
       (client_id, proyecto_id, afianzadora_id, numero_poliza, tipo_fianza_id,
        prima_neta, monto_afianzado, fecha_inicio, fecha_vigencia,
        fecha_recordatorio, nota_recordatorio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(Number(client_id), Number(proyecto_id), Number(afianzadora_id), numero_poliza,
        Number(tipo_fianza_id),
        centavos(prima_neta), centavos(monto_afianzado),
        fecha_inicio || null, fecha_vigencia || null,
        fecha_recordatorio || null, nota_recordatorio || null);
  res.json({ ok: true, id: row.id });
});

// PUT /api/admin/fianzas/:id -> edición completa de la póliza
router.put('/fianzas/:id', async (req, res) => {
  const id = Number(req.params.id);
  const actual = await db
    .prepare('SELECT client_id, fecha_recordatorio FROM fianzas WHERE id = ?')
    .get(id);
  if (!actual) return res.status(404).json({ error: 'Fianza no encontrada' });

  const body = { ...(req.body || {}) };

  if ('proyecto_id' in body) {
    const err = await validarProyecto(body.proyecto_id, actual.client_id);
    if (err) return res.status(400).json({ error: err });
    body.proyecto_id = Number(body.proyecto_id);
  }

  if ('tipo_fianza_id' in body) {
    if (!(await tipoExiste(body.tipo_fianza_id))) {
      return res.status(400).json({ error: 'Selecciona un tipo de fianza del catálogo' });
    }
    body.tipo_fianza_id = Number(body.tipo_fianza_id);
  }

  // Los montos llegan en centavos; se normalizan a entero por si acaso.
  for (const campo of ['prima_neta', 'monto_afianzado']) {
    if (campo in body) body[campo] = centavos(body[campo]);
  }

  const { sets, valores } = camposAActualizar(body, CAMPOS_FIANZA);
  // Si le ponen una fecha de recordatorio distinta, el aviso vuelve a estar vivo
  // aunque el anterior ya se hubiera marcado como atendido.
  if ('fecha_recordatorio' in body && (body.fecha_recordatorio || null) !== actual.fecha_recordatorio) {
    sets.push('recordatorio_atendido_el = NULL');
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

  await db.prepare(`UPDATE fianzas SET ${sets.join(', ')} WHERE id = ?`).run(...valores, id);
  res.json({ ok: true });
});

// Marca el recordatorio como atendido sin borrar la fecha (queda el histórico).
router.put('/fianzas/:id/recordatorio', async (req, res) => {
  const atendido = req.body?.atendido !== false;
  await db.prepare('UPDATE fianzas SET recordatorio_atendido_el = ? WHERE id = ?')
    .run(atendido ? todayISO() : null, Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/fianzas/:id', async (req, res) => {
  await db.prepare('DELETE FROM fianzas WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// GET /api/admin/recordatorios -> avisos internos vencidos o próximos (7 días)
router.get('/recordatorios', async (req, res) => {
  const dias = Number(req.query.dias) || 7;
  const rows = await db.prepare(
    `SELECT f.id, f.numero_poliza, t.nombre AS tipo_fianza,
            f.fecha_recordatorio, f.nota_recordatorio,
            f.monto_afianzado, c.id AS client_id, c.razon_social,
            a.nombre AS afianzadora_nombre, p.nombre AS proyecto_nombre
     FROM fianzas f
     JOIN clients c ON c.id = f.client_id
     JOIN afianzadoras a ON a.id = f.afianzadora_id
     LEFT JOIN tipos_fianza t ON t.id = f.tipo_fianza_id
     LEFT JOIN proyectos p ON p.id = f.proyecto_id
     WHERE f.fecha_recordatorio IS NOT NULL
       AND f.recordatorio_atendido_el IS NULL
     ORDER BY f.fecha_recordatorio`
  ).all();

  const recordatorios = rows
    .map((r) => ({ ...r, dias_restantes: daysUntil(r.fecha_recordatorio) }))
    .filter((r) => r.dias_restantes !== null && r.dias_restantes <= dias);

  res.json({ recordatorios });
});

// --- Papelería específica (solicitudes que crea Fortex) ---

// POST /api/admin/papeleria -> crear solicitud puntual para un cliente
router.post('/papeleria', async (req, res) => {
  const { client_id, afianzadora_id, fianza_id, descripcion } = req.body || {};
  if (!client_id || !descripcion) {
    return res.status(400).json({ error: 'client_id y descripcion requeridos' });
  }
  const row = await db.prepare(
    `INSERT INTO papeleria_requests (client_id, afianzadora_id, fianza_id, descripcion)
     VALUES (?, ?, ?, ?) RETURNING id`
  ).get(client_id, afianzadora_id || null, fianza_id || null, descripcion);
  res.json({ ok: true, id: row.id });
});

// GET /api/admin/clientes/:id/detalle -> fianzas, documentos y papelería de un cliente
router.get('/clientes/:id/detalle', async (req, res) => {
  const id = Number(req.params.id);
  const cliente = await db.prepare('SELECT id, razon_social, rfc, email, telefono FROM clients WHERE id = ?').get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  const fianzasRows = await db.prepare(
    `SELECT f.*, a.nombre AS afianzadora_nombre,
            t.nombre AS tipo_fianza,
            p.nombre AS proyecto_nombre
     FROM fianzas f
     JOIN afianzadoras a ON a.id = f.afianzadora_id
     LEFT JOIN tipos_fianza t ON t.id = f.tipo_fianza_id
     LEFT JOIN proyectos p ON p.id = f.proyecto_id
     WHERE f.client_id = ? ORDER BY f.fecha_vigencia`
  ).all(id);
  const fianzas = fianzasRows.map((f) => ({
    ...f,
    estado: estadoFianza(f.fecha_vigencia),
    dias_para_recordatorio: daysUntil(f.fecha_recordatorio),
  }));

  // Comprometido por afianzadora (fianzas no vencidas)
  const comprometidoPorAfi = new Map();
  for (const f of fianzas) {
    if (f.estado === 'vencida') continue;
    comprometidoPorAfi.set(
      f.afianzadora_id,
      (comprometidoPorAfi.get(f.afianzadora_id) || 0) + (f.monto_afianzado || 0)
    );
  }

  const lineasRows = await db.prepare(
    `SELECT cl.afianzadora_id, a.nombre AS afianzadora_nombre, cl.linea_credito
     FROM client_credit_lines cl
     JOIN afianzadoras a ON a.id = cl.afianzadora_id
     WHERE cl.client_id = ? ORDER BY a.nombre`
  ).all(id);
  const lineas = lineasRows.map((l) => {
    const comprometido = comprometidoPorAfi.get(l.afianzadora_id) || 0;
    return {
      ...l,
      linea_credito: l.linea_credito || 0,
      comprometido,
      disponible: (l.linea_credito || 0) - comprometido,
    };
  });

  const documentos = await db.prepare(
    `SELECT dt.nombre, dt.id AS document_type_id, cd.uploaded_at, cd.vencimiento, cd.original_name, cd.file_path
     FROM document_types dt
     LEFT JOIN client_documents cd ON cd.document_type_id = dt.id AND cd.client_id = ?
     ORDER BY dt.orden, dt.id`
  ).all(id);

  const papeleria = await db.prepare(
    `SELECT p.*, a.nombre AS afianzadora_nombre, f.numero_poliza
     FROM papeleria_requests p
     LEFT JOIN afianzadoras a ON a.id = p.afianzadora_id
     LEFT JOIN fianzas f ON f.id = p.fianza_id
     WHERE p.client_id = ? ORDER BY p.created_at DESC`
  ).all(id);

  // Proyectos con sus fianzas dentro. Es la agrupación que ve el admin.
  const proyectosRows = await db.prepare(
    `SELECT * FROM proyectos WHERE client_id = ? ORDER BY estatus, nombre`
  ).all(id);

  const proyectos = proyectosRows.map((p) => {
    const suyas = fianzas.filter((f) => f.proyecto_id === p.id);
    const afianzado = suyas
      .filter((f) => f.estado !== 'vencida')
      .reduce((s, f) => s + (f.monto_afianzado || 0), 0);
    return {
      ...p,
      fianzas: suyas,
      total_fianzas: suyas.length,
      monto_afianzado: afianzado,
      prima_total: suyas.reduce((s, f) => s + (f.prima_neta || 0), 0),
      // Qué tanto del contrato está respaldado por fianzas vigentes.
      pct_contrato_afianzado: p.monto_contrato > 0
        ? Math.round((afianzado / p.monto_contrato) * 100)
        : null,
    };
  });

  res.json({ cliente, lineas, proyectos, fianzas, documentos, papeleria });
});

// GET /api/admin/descargar?path=<url-del-blob> -> redirige al archivo público (Vercel Blob)
router.get('/descargar', (req, res) => {
  const url = String(req.query.path || '');
  if (!/^https:\/\//.test(url)) {
    return res.status(404).json({ error: 'Archivo no disponible' });
  }
  res.redirect(url);
});

export default router;
