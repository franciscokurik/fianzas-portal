import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { estadoFianza, daysUntil } from '../lib/dates.js';
import { agruparPorEntidad, deEntidad } from '../lib/documentos.js';

const router = Router();

// GET /api/fianzas/afianzadoras -> afianzadoras que tienen fianzas del cliente
router.get('/afianzadoras', requireAuth, async (req, res) => {
  const rows = await db
    .prepare(
      `SELECT a.id, a.nombre, a.slug, COUNT(f.id) AS total
       FROM afianzadoras a
       JOIN fianzas f ON f.afianzadora_id = a.id AND f.client_id = ?
       WHERE a.activo = 1
       GROUP BY a.id
       ORDER BY a.nombre`
    )
    .all(req.user.id);
  res.json({ afianzadoras: rows });
});

// GET /api/fianzas/proyectos -> proyectos del cliente con su total afianzado
router.get('/proyectos', requireAuth, async (req, res) => {
  const proyectos = await db
    .prepare(
      `SELECT p.id, p.nombre, p.numero_contrato, p.beneficiario, p.monto_contrato,
              p.fecha_inicio, p.fecha_termino, p.estatus,
              COUNT(f.id)::int AS total_fianzas
       FROM proyectos p
       LEFT JOIN fianzas f ON f.proyecto_id = p.id
       WHERE p.client_id = ?
       GROUP BY p.id
       ORDER BY p.estatus, p.nombre`
    )
    .all(req.user.id);
  res.json({ proyectos });
});

// GET /api/fianzas?afianzadora_id=#&proyecto_id=#  -> fianzas del cliente
router.get('/', requireAuth, async (req, res) => {
  const { afianzadora_id, proyecto_id } = req.query;
  let sql = `SELECT f.*, a.nombre AS afianzadora_nombre, a.slug AS afianzadora_slug,
                    t.nombre AS tipo_fianza,
                    p.nombre AS proyecto_nombre, p.numero_contrato, p.monto_contrato
             FROM fianzas f
             JOIN afianzadoras a ON a.id = f.afianzadora_id
             LEFT JOIN tipos_fianza t ON t.id = f.tipo_fianza_id
             LEFT JOIN proyectos p ON p.id = f.proyecto_id
             WHERE f.client_id = ?`;
  const params = [req.user.id];
  if (afianzadora_id) {
    sql += ' AND f.afianzadora_id = ?';
    params.push(afianzadora_id);
  }
  if (proyecto_id) {
    sql += ' AND f.proyecto_id = ?';
    params.push(proyecto_id);
  }
  sql += ' ORDER BY p.nombre, f.fecha_vigencia';

  const rows = await db.prepare(sql).all(...params);

  const archivos = await db.prepare(
    `SELECT id, entidad_tipo, entidad_id, tipo_doc, nombre_archivo, size_bytes, subido_el
     FROM documentos WHERE client_id = ?`
  ).all(req.user.id);
  const porEntidad = agruparPorEntidad(archivos);

  const fianzas = rows.map((row) => {
    // Los recordatorios son de uso interno de Fortex: no se exponen al fiado.
    const { fecha_recordatorio, nota_recordatorio, recordatorio_atendido_el, ...f } = row;
    return {
      ...f,
      estado: estadoFianza(f.fecha_vigencia),
      dias_para_vencer: daysUntil(f.fecha_vigencia),
      // Sin la URL del blob: se descarga por /api/fianzas/documentos/:id,
      // que comprueba que el archivo sea de este cliente.
      documentos: deEntidad(porEntidad, 'fianza', f.id).map(({ url, ...d }) => d),
      documentos_proyecto: f.proyecto_id
        ? deEntidad(porEntidad, 'proyecto', f.proyecto_id).map(({ url, ...d }) => d)
        : [],
    };
  });

  res.json({ fianzas });
});

// GET /api/fianzas/documentos/:id -> descarga un contrato o carátula.
// La comprobación de dueño es la que importa: sin ella, cambiar el id en la
// URL dejaría ver los documentos de otro fiado.
router.get('/documentos/:id', requireAuth, async (req, res) => {
  const doc = await db
    .prepare('SELECT url FROM documentos WHERE id = ? AND client_id = ?')
    .get(Number(req.params.id), req.user.id);

  if (!doc || !/^https:\/\//.test(doc.url || '')) {
    return res.status(404).json({ error: 'Documento no disponible' });
  }
  res.redirect(doc.url);
});

export default router;
