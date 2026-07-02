import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { estadoFianza, daysUntil } from '../lib/dates.js';

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

// GET /api/fianzas?afianzadora_id=#  -> fianzas del cliente (filtrable por afianzadora)
router.get('/', requireAuth, async (req, res) => {
  const { afianzadora_id } = req.query;
  let sql = `SELECT f.*, a.nombre AS afianzadora_nombre, a.slug AS afianzadora_slug
             FROM fianzas f JOIN afianzadoras a ON a.id = f.afianzadora_id
             WHERE f.client_id = ?`;
  const params = [req.user.id];
  if (afianzadora_id) {
    sql += ' AND f.afianzadora_id = ?';
    params.push(afianzadora_id);
  }
  sql += ' ORDER BY f.fecha_vigencia';

  const rows = await db.prepare(sql).all(...params);
  const fianzas = rows.map((f) => ({
    ...f,
    estado: estadoFianza(f.fecha_vigencia),
    dias_para_vencer: daysUntil(f.fecha_vigencia),
  }));

  res.json({ fianzas });
});

export default router;
