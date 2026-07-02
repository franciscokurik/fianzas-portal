import { Router } from 'express';
import db from '../db.js';
import { requireAuth } from '../auth/middleware.js';
import { estadoFianza } from '../lib/dates.js';

const router = Router();

// GET /api/dashboard -> métricas del cliente autenticado
router.get('/', requireAuth, (req, res) => {
  const clientId = req.user.id;

  const client = db
    .prepare('SELECT id, razon_social FROM clients WHERE id = ?')
    .get(clientId);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  const fianzas = db
    .prepare('SELECT afianzadora_id, prima_neta, monto_afianzado, fecha_vigencia FROM fianzas WHERE client_id = ?')
    .all(clientId);

  let activas = 0;
  let porVencer30 = 0;
  let primaNetaTotal = 0;
  // Monto comprometido (fianzas no vencidas) acumulado por afianzadora
  const comprometidoPorAfi = new Map();

  for (const f of fianzas) {
    const estado = estadoFianza(f.fecha_vigencia);
    primaNetaTotal += f.prima_neta || 0;
    if (estado !== 'vencida') {
      activas += 1;
      comprometidoPorAfi.set(
        f.afianzadora_id,
        (comprometidoPorAfi.get(f.afianzadora_id) || 0) + (f.monto_afianzado || 0)
      );
    }
    if (estado === 'por_vencer') porVencer30 += 1;
  }

  // Líneas de crédito por afianzadora del cliente
  const lineasRows = db
    .prepare(
      `SELECT cl.afianzadora_id, a.nombre AS afianzadora_nombre, cl.linea_credito
       FROM client_credit_lines cl
       JOIN afianzadoras a ON a.id = cl.afianzadora_id
       WHERE cl.client_id = ?
       ORDER BY a.nombre`
    )
    .all(clientId);

  const lineas = lineasRows.map((l) => {
    const comprometido = comprometidoPorAfi.get(l.afianzadora_id) || 0;
    return {
      afianzadora_id: l.afianzadora_id,
      afianzadora_nombre: l.afianzadora_nombre,
      linea_credito: l.linea_credito || 0,
      comprometido,
      disponible: (l.linea_credito || 0) - comprometido,
    };
  });

  const lineaCreditoTotal = lineas.reduce((s, l) => s + l.linea_credito, 0);
  const lineaDisponible = lineas.reduce((s, l) => s + l.disponible, 0);

  // Documentos pendientes/por vencer y solicitudes de papelería pendientes
  const docsPendientes = db
    .prepare(
      `SELECT COUNT(*) c FROM document_types dt
       LEFT JOIN client_documents cd
         ON cd.document_type_id = dt.id AND cd.client_id = ?
       WHERE cd.id IS NULL`
    )
    .get(clientId).c;

  const papeleriaPendiente = db
    .prepare(`SELECT COUNT(*) c FROM papeleria_requests WHERE client_id = ? AND estado = 'pendiente'`)
    .get(clientId).c;

  res.json({
    razon_social: client.razon_social,
    metricas: {
      linea_disponible: lineaDisponible,
      linea_credito_total: lineaCreditoTotal,
      lineas,
      fianzas_activas: activas,
      prima_neta_total: primaNetaTotal,
      fianzas_por_vencer_30: porVencer30,
    },
    alertas: {
      documentos_pendientes: docsPendientes,
      papeleria_pendiente: papeleriaPendiente,
    },
  });
});

export default router;
