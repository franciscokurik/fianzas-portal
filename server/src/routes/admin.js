import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin, requireInterno } from '../auth/middleware.js';
import { estadoFianza, daysUntil, todayISO } from '../lib/dates.js';
import { centavos } from '../lib/dinero.js';
import { slugify } from '../lib/slug.js';
import { upload, subirArchivo, borrarArchivo } from '../lib/upload.js';
import { TIPOS_DOC, esTipoValido, agruparPorEntidad, deEntidad } from '../lib/documentos.js';
import { guardarDocumentoCliente, borrarDocumentoCliente } from '../services/documentos-cliente.js';
import { esAdmin, exigirCliente, exigirEntidad, filtroCartera } from '../lib/cartera.js';
import {
  crearUsuario, actualizarUsuario, desactivarUsuario, DOMINIO_INTERNO,
} from '../services/usuarios.js';
import { eliminarCliente } from '../services/clientes.js';

const router = Router();

// Al panel entra todo el personal de Fortex, pero el vendedor solo alcanza los
// clientes de su cartera. Cada ruta que toca un fiado lo comprueba de nuevo
// contra la base: la lista que se le mandó a la pantalla no es una autorización.
router.use(requireAuth, requireInterno);

// Lo que solo puede Home Office: dar de alta clientes y usuarios, mover líneas
// de crédito y cambiar los catálogos que ven todos los fiados.
const soloAdmin = requireAdmin;

// --- Clientes ---

// GET /api/admin/clientes -> los clientes que puede ver quien pregunta
router.get('/clientes', async (req, res) => {
  const cartera = filtroCartera(req.user);
  const clientes = await db
    .prepare(
      `SELECT c.id, c.razon_social, c.rfc, c.vendedor_id, v.nombre AS vendedor_nombre,
              (SELECT COUNT(*)::int FROM users u WHERE u.client_id = c.id AND u.activo = 1) AS total_usuarios
       FROM clients c
       LEFT JOIN users v ON v.id = c.vendedor_id
       WHERE 1 = 1${cartera.sql.replace('vendedor_id', 'c.vendedor_id')}
       ORDER BY c.razon_social`
    )
    .all(...cartera.params);

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

// POST /api/admin/clientes -> alta de la empresa y, de una vez, su primer acceso
router.post('/clientes', soloAdmin, async (req, res) => {
  const { razon_social, rfc, telefono, vendedor_id, email, password, nombre_contacto } = req.body || {};
  if (!razon_social || !email || !password) {
    return res.status(400).json({ error: 'Razón social, correo y contraseña son obligatorios' });
  }

  let clienteId;
  try {
    const row = await db.prepare(
      `INSERT INTO clients (razon_social, rfc, telefono, vendedor_id)
       VALUES (?, ?, ?, ?) RETURNING id`
    ).get(razon_social, rfc || null, telefono || null, vendedor_id ? Number(vendedor_id) : null);
    clienteId = row.id;
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo crear (¿RFC duplicado?)', detail: e.message });
  }

  // El alta son dos inserciones y el driver HTTP no da transacciones. Si la
  // segunda falla (correo repetido, casi siempre), se deshace la primera: una
  // empresa sin ninguna cuenta con la que entrar no le sirve a nadie y encima
  // le bloquea el RFC al siguiente intento.
  try {
    await crearUsuario({
      nombre: nombre_contacto || razon_social,
      email,
      password,
      role: 'client',
      clientId: clienteId,
    });
  } catch (e) {
    await db.prepare('DELETE FROM clients WHERE id = ?').run(clienteId);
    return res.status(e.status || 400).json({ error: e.message });
  }

  res.json({ ok: true, id: clienteId });
});

// PUT /api/admin/clientes/:id -> actualizar datos básicos
router.put('/clientes/:id', soloAdmin, async (req, res) => {
  const { razon_social, telefono } = req.body || {};
  await db.prepare(
    `UPDATE clients SET razon_social = COALESCE(?, razon_social),
       telefono = COALESCE(?, telefono)
     WHERE id = ?`
  ).run(razon_social ?? null, telefono ?? null, Number(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/admin/clientes/:id  { confirmar: "<razón social>" }
//
// Se lleva el historial completo del fiado y no hay deshacer, así que se pide
// teclear la razón social. Un `confirm()` del navegador no basta: se acepta sin
// leerlo, y aquí el clic equivocado borra las pólizas de un cliente real.
router.delete('/clientes/:id', soloAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const cliente = await db.prepare('SELECT razon_social FROM clients WHERE id = ?').get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  if (String(req.body?.confirmar || '').trim() !== cliente.razon_social) {
    return res.status(400).json({
      error: `Para eliminarlo hay que escribir su razón social exactamente: "${cliente.razon_social}".`,
    });
  }

  const borrado = await eliminarCliente(id);
  res.json({ ok: true, cliente: cliente.razon_social, borrado });
});

// PUT /api/admin/clientes/:id/vendedor -> mover el cliente de cartera
// (vendedor_id null = sin asignar, lo ve solo Home Office)
router.put('/clientes/:id/vendedor', soloAdmin, async (req, res) => {
  const vendedorId = req.body?.vendedor_id ? Number(req.body.vendedor_id) : null;

  if (vendedorId) {
    const v = await db
      .prepare(`SELECT id FROM users WHERE id = ? AND role = 'vendedor' AND activo = 1`)
      .get(vendedorId);
    if (!v) return res.status(400).json({ error: 'Ese vendedor no existe o está dado de baja' });
  }

  await db.prepare('UPDATE clients SET vendedor_id = ? WHERE id = ?')
    .run(vendedorId, Number(req.params.id));
  res.json({ ok: true });
});

// PUT /api/admin/clientes/:id/lineas -> fijar/actualizar la línea de una afianzadora (upsert)
router.put('/clientes/:id/lineas', soloAdmin, async (req, res) => {
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
router.delete('/clientes/:id/lineas/:afianzadoraId', soloAdmin, async (req, res) => {
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
router.post('/afianzadoras', soloAdmin, async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const slug = slugify(nombre);
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

router.post('/tipos-fianza', soloAdmin, async (req, res) => {
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
router.delete('/tipos-fianza/:id', soloAdmin, async (req, res) => {
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
  await exigirCliente(req.user, client_id);

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
  await exigirEntidad(req.user, 'proyecto', req.params.id);

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
  await exigirEntidad(req.user, 'proyecto', id);

  const { c } = await db.prepare('SELECT COUNT(*)::int c FROM fianzas WHERE proyecto_id = ?').get(id);
  if (c > 0) {
    return res.status(400).json({
      error: `El proyecto tiene ${c} fianza(s). Reasígnalas a otro proyecto antes de eliminarlo.`,
    });
  }
  await borrarDocumentosDe('proyecto', id);
  await db.prepare('DELETE FROM proyectos WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Fianzas (pólizas) ---

const CAMPOS_FIANZA = ['proyecto_id', 'afianzadora_id', 'numero_poliza', 'tipo_fianza_id',
                       'prima_neta', 'prima_total', 'monto_afianzado',
                       'fecha_inicio', 'fecha_vigencia',
                       'fecha_recordatorio', 'nota_recordatorio'];

// Todo lo que es dinero y puede venir en el body de una fianza.
const MONTOS_FIANZA = ['prima_neta', 'prima_total', 'monto_afianzado'];

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
          prima_neta, prima_total, monto_afianzado, fecha_inicio, fecha_vigencia,
          fecha_recordatorio, nota_recordatorio } = req.body || {};

  if (!client_id || !afianzadora_id || !numero_poliza) {
    return res.status(400).json({ error: 'Cliente, afianzadora y número de póliza son obligatorios' });
  }
  await exigirCliente(req.user, client_id);

  const errProyecto = await validarProyecto(proyecto_id, client_id);
  if (errProyecto) return res.status(400).json({ error: errProyecto });

  if (!(await tipoExiste(tipo_fianza_id))) {
    return res.status(400).json({ error: 'Selecciona un tipo de fianza del catálogo' });
  }

  const row = await db.prepare(
    `INSERT INTO fianzas
       (client_id, proyecto_id, afianzadora_id, numero_poliza, tipo_fianza_id,
        prima_neta, prima_total, monto_afianzado, fecha_inicio, fecha_vigencia,
        fecha_recordatorio, nota_recordatorio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(Number(client_id), Number(proyecto_id), Number(afianzadora_id), numero_poliza,
        Number(tipo_fianza_id),
        centavos(prima_neta), centavos(prima_total), centavos(monto_afianzado),
        fecha_inicio || null, fecha_vigencia || null,
        fecha_recordatorio || null, nota_recordatorio || null);
  res.json({ ok: true, id: row.id });
});

// PUT /api/admin/fianzas/:id -> edición completa de la póliza
router.put('/fianzas/:id', async (req, res) => {
  const id = Number(req.params.id);
  await exigirEntidad(req.user, 'fianza', id);

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
  for (const campo of MONTOS_FIANZA) {
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
  await exigirEntidad(req.user, 'fianza', req.params.id);

  const atendido = req.body?.atendido !== false;
  await db.prepare('UPDATE fianzas SET recordatorio_atendido_el = ? WHERE id = ?')
    .run(atendido ? todayISO() : null, Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/fianzas/:id', async (req, res) => {
  const id = Number(req.params.id);
  await exigirEntidad(req.user, 'fianza', id);

  await borrarDocumentosDe('fianza', id);
  await db.prepare('DELETE FROM fianzas WHERE id = ?').run(id);
  res.json({ ok: true });
});

// GET /api/admin/recordatorios -> avisos internos vencidos o próximos (7 días)
router.get('/recordatorios', async (req, res) => {
  const dias = Number(req.query.dias) || 7;
  const cartera = filtroCartera(req.user, 'c.vendedor_id');
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
       AND f.recordatorio_atendido_el IS NULL${cartera.sql}
     ORDER BY f.fecha_recordatorio`
  ).all(...cartera.params);

  const recordatorios = rows
    .map((r) => ({ ...r, dias_restantes: daysUntil(r.fecha_recordatorio) }))
    .filter((r) => r.dias_restantes !== null && r.dias_restantes <= dias);

  res.json({ recordatorios });
});

// --- Documentos de proyectos y fianzas ---

router.get('/tipos-documento', (req, res) => res.json({ tipos: TIPOS_DOC }));

// La tabla es polimórfica, así que no hay llave foránea que limpie sola:
// al borrar la entidad hay que llevarse sus archivos a mano.
async function borrarDocumentosDe(entidadTipo, entidadId) {
  const docs = await db.prepare(
    'SELECT url FROM documentos WHERE entidad_tipo = ? AND entidad_id = ?'
  ).all(entidadTipo, entidadId);
  if (!docs.length) return;

  await db.prepare('DELETE FROM documentos WHERE entidad_tipo = ? AND entidad_id = ?')
    .run(entidadTipo, entidadId);
  for (const d of docs) await borrarArchivo(d.url);
}

// Devuelve el cliente dueño de la entidad, o null si no existe.
async function duenoDe(entidadTipo, entidadId) {
  const tabla = entidadTipo === 'proyecto' ? 'proyectos' : 'fianzas';
  const fila = await db.prepare(`SELECT client_id FROM ${tabla} WHERE id = ?`).get(entidadId);
  return fila ? fila.client_id : null;
}

// POST /api/admin/:entidadTipo/:id/documentos  (multipart: archivo, tipo_doc)
//   entidadTipo: 'proyectos' | 'fianzas'
router.post('/:entidadTipo(proyectos|fianzas)/:id/documentos',
  upload.single('archivo'),
  async (req, res) => {
    const entidadTipo = req.params.entidadTipo === 'proyectos' ? 'proyecto' : 'fianza';
    const entidadId = Number(req.params.id);
    const tipoDoc = req.body?.tipo_doc || 'otro';

    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo' });
    if (!esTipoValido(entidadTipo, tipoDoc)) {
      return res.status(400).json({ error: `Tipo de documento no válido para ${entidadTipo}` });
    }

    const clientId = await duenoDe(entidadTipo, entidadId);
    if (!clientId) return res.status(404).json({ error: `No existe ese ${entidadTipo}` });
    await exigirCliente(req.user, clientId);

    const url = await subirArchivo(req.file, clientId);
    const row = await db.prepare(
      `INSERT INTO documentos
         (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
    ).get(clientId, entidadTipo, entidadId, tipoDoc, url,
          req.file.originalname, req.file.mimetype, req.file.size);

    res.json({ ok: true, id: row.id, url });
  });

// DELETE /api/admin/documentos/:id -> quita el registro y el archivo del blob
router.delete('/documentos/:id', async (req, res) => {
  await exigirEntidad(req.user, 'documento', req.params.id);

  const doc = await db.prepare('SELECT url FROM documentos WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

  await db.prepare('DELETE FROM documentos WHERE id = ?').run(Number(req.params.id));
  await borrarArchivo(doc.url); // si esto falla, ya no hay registro que lo apunte
  res.json({ ok: true });
});

// --- Expediente del fiado (CSF, estados financieros, acta constitutiva…) ---
//
// Estos documentos los sube el propio fiado desde su portal, pero en la
// práctica muchos llegan por correo a Home Office: Fortex los carga en su
// nombre y queda registrado que fue Fortex quien lo hizo.

// POST /api/admin/clientes/:id/documentos/:typeId  (multipart: archivo)
router.post('/clientes/:id/documentos/:typeId', upload.single('archivo'), async (req, res) => {
  const clientId = Number(req.params.id);
  // Comprueba de una vez que el cliente existe y que quien sube lo alcanza.
  await exigirCliente(req.user, clientId);

  const { vencimiento, tipo } = await guardarDocumentoCliente({
    clientId,
    typeId: Number(req.params.typeId),
    file: req.file,
    subidoPor: 'fortex',
  });
  res.json({ ok: true, vencimiento, tipo });
});

// DELETE /api/admin/clientes/:id/documentos/:typeId
router.delete('/clientes/:id/documentos/:typeId', async (req, res) => {
  await exigirCliente(req.user, req.params.id);

  await borrarDocumentoCliente({
    clientId: Number(req.params.id),
    typeId: Number(req.params.typeId),
  });
  res.json({ ok: true });
});

// --- Catálogo de documentos requeridos (tabla document_types) ---
//
// Es la lista que le aparece a TODOS los fiados. Se edita desde el panel para
// no tener que redesplegar cuando una afianzadora empieza a pedir un papel
// nuevo (un balance parcial, una declaración anual…).

// GET /api/admin/documentos-requeridos -> catálogo con cuántos fiados lo tienen
router.get('/documentos-requeridos', async (req, res) => {
  const tipos = await db.prepare(
    `SELECT dt.*, COUNT(cd.id)::int AS cargados
     FROM document_types dt
     LEFT JOIN client_documents cd ON cd.document_type_id = dt.id
     GROUP BY dt.id
     ORDER BY dt.orden, dt.id`
  ).all();
  res.json({ tipos });
});

// Meses de vigencia y días de aviso: vacío significa "no vence".
function periodicidad(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

router.post('/documentos-requeridos', soloAdmin, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

  const alerta = periodicidad(req.body?.alerta_dias) ?? 30;
  try {
    const row = await db.prepare(
      `INSERT INTO document_types (nombre, slug, periodicidad_meses, alerta_dias, orden)
       VALUES (?, ?, ?, ?, 500) RETURNING id`
    ).get(nombre, slugify(nombre), periodicidad(req.body?.periodicidad_meses), alerta);
    res.json({ ok: true, id: row.id });
  } catch (e) {
    res.status(400).json({ error: 'Ya existe un documento con ese nombre', detail: e.message });
  }
});

router.put('/documentos-requeridos/:id', soloAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

  // El slug NO se toca: es la llave con la que se identifica el tipo y hay
  // documentos ya cargados apuntando a este id.
  await db.prepare(
    `UPDATE document_types
     SET nombre = ?, periodicidad_meses = ?, alerta_dias = ?
     WHERE id = ?`
  ).run(nombre, periodicidad(req.body?.periodicidad_meses),
        periodicidad(req.body?.alerta_dias) ?? 30, id);
  res.json({ ok: true });
});

// Solo se puede quitar un tipo que nadie haya usado: si ya hay archivos
// colgados, borrarlo se los llevaría sin avisar.
router.delete('/documentos-requeridos/:id', soloAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { c } = await db.prepare(
    'SELECT COUNT(*)::int c FROM client_documents WHERE document_type_id = ?'
  ).get(id);
  if (c > 0) {
    return res.status(400).json({
      error: `${c} cliente(s) ya tienen cargado este documento. Bórralo de sus expedientes antes de quitarlo del catálogo.`,
    });
  }
  await db.prepare('DELETE FROM document_types WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Papelería específica (solicitudes que crea Fortex) ---

// POST /api/admin/papeleria -> crear solicitud puntual para un cliente
router.post('/papeleria', async (req, res) => {
  const { client_id, afianzadora_id, fianza_id, descripcion } = req.body || {};
  if (!client_id || !descripcion) {
    return res.status(400).json({ error: 'client_id y descripcion requeridos' });
  }
  await exigirCliente(req.user, client_id);

  const row = await db.prepare(
    `INSERT INTO papeleria_requests (client_id, afianzadora_id, fianza_id, descripcion)
     VALUES (?, ?, ?, ?) RETURNING id`
  ).get(client_id, afianzadora_id || null, fianza_id || null, descripcion);
  res.json({ ok: true, id: row.id });
});

// GET /api/admin/clientes/:id/detalle -> fianzas, documentos y papelería de un cliente
router.get('/clientes/:id/detalle', async (req, res) => {
  const id = Number(req.params.id);
  await exigirCliente(req.user, id);

  const cliente = await db.prepare(
    `SELECT c.id, c.razon_social, c.rfc, c.telefono, c.vendedor_id, v.nombre AS vendedor_nombre
     FROM clients c
     LEFT JOIN users v ON v.id = c.vendedor_id
     WHERE c.id = ?`
  ).get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  // Las personas que pueden entrar por este fiado. El hash NUNCA sale de aquí.
  const usuarios = await db.prepare(
    `SELECT id, nombre, email, activo, created_at
     FROM users WHERE client_id = ? ORDER BY activo DESC, nombre`
  ).all(id);

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
  // Todos los archivos del cliente en una sola consulta; luego se reparten.
  const archivos = await db.prepare(
    `SELECT id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo, size_bytes, subido_el
     FROM documentos WHERE client_id = ? ORDER BY subido_el DESC`
  ).all(id);
  const porEntidad = agruparPorEntidad(archivos);

  const fianzas = fianzasRows.map((f) => ({
    ...f,
    estado: estadoFianza(f.fecha_vigencia),
    dias_para_recordatorio: daysUntil(f.fecha_recordatorio),
    documentos: deEntidad(porEntidad, 'fianza', f.id),
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
    `SELECT dt.nombre, dt.id AS document_type_id, dt.periodicidad_meses, dt.alerta_dias,
            cd.uploaded_at, cd.vencimiento, cd.original_name, cd.file_path,
            cd.size_bytes, cd.subido_por
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
      documentos: deEntidad(porEntidad, 'proyecto', p.id),
      total_fianzas: suyas.length,
      monto_afianzado: afianzado,
      // Las dos primas del proyecto. Cuidado al leerlas: 'suma_prima_total' es
      // la suma de las primas TOTALES de sus fianzas, no el total de las netas.
      suma_prima_neta: suyas.reduce((s, f) => s + (f.prima_neta || 0), 0),
      suma_prima_total: suyas.reduce((s, f) => s + (f.prima_total || 0), 0),
      // Qué tanto del contrato está respaldado por fianzas vigentes.
      pct_contrato_afianzado: p.monto_contrato > 0
        ? Math.round((afianzado / p.monto_contrato) * 100)
        : null,
    };
  });

  res.json({ cliente, usuarios, lineas, proyectos, fianzas, documentos, papeleria });
});

// GET /api/admin/descargar?path=<url> -> redirige al archivo
//
// Antes redirigía a CUALQUIER https que le pasaran. Con un solo admin eso era
// nada más feo; con vendedores en el sistema sería la puerta para bajarse el
// expediente de un fiado ajeno con solo tener su URL. Ahora el archivo tiene
// que estar registrado y quien lo pide, alcanzar a su dueño.
router.get('/descargar', async (req, res) => {
  const url = String(req.query.path || '');
  if (!/^https:\/\//.test(url)) {
    return res.status(404).json({ error: 'Archivo no disponible' });
  }

  const dueno = await db.prepare(
    `SELECT client_id FROM documentos          WHERE url = ?
     UNION ALL
     SELECT client_id FROM client_documents    WHERE file_path = ?
     UNION ALL
     SELECT client_id FROM papeleria_requests  WHERE file_path = ?
     LIMIT 1`
  ).get(url, url, url);
  if (!dueno) return res.status(404).json({ error: 'Archivo no disponible' });

  await exigirCliente(req.user, dueno.client_id);
  res.redirect(url);
});

// --- Usuarios ---
//
// Una empresa puede tener varias personas entrando (el director, el contador,
// el residente de obra), y todas ven lo mismo de su fiado. Las cuentas de
// Fortex (admin y vendedor) no cuelgan de ninguna empresa.

// GET /api/admin/usuarios/internos -> el personal de Fortex
router.get('/usuarios/internos', soloAdmin, async (req, res) => {
  const usuarios = await db.prepare(
    `SELECT u.id, u.nombre, u.email, u.role, u.activo,
            (SELECT COUNT(*)::int FROM clients c WHERE c.vendedor_id = u.id) AS clientes_asignados
     FROM users u
     WHERE u.client_id IS NULL
     ORDER BY u.role, u.nombre`
  ).all();
  res.json({ usuarios, dominio: DOMINIO_INTERNO });
});

// POST /api/admin/usuarios -> alta de una persona (de un fiado o de Fortex)
router.post('/usuarios', soloAdmin, async (req, res) => {
  const { nombre, email, password, role, client_id } = req.body || {};
  const fila = await crearUsuario({
    nombre,
    email,
    password,
    role: role || 'client',
    clientId: client_id ? Number(client_id) : null,
  });
  res.json({ ok: true, id: fila.id });
});

// PUT /api/admin/usuarios/:id -> cambiar nombre, reactivar o reponer contraseña
router.put('/usuarios/:id', soloAdmin, async (req, res) => {
  await actualizarUsuario(Number(req.params.id), req.body || {});
  res.json({ ok: true });
});

// DELETE /api/admin/usuarios/:id -> baja lógica (deja de entrar, no se borra)
router.delete('/usuarios/:id', soloAdmin, async (req, res) => {
  await desactivarUsuario(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
