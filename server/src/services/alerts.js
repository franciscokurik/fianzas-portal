// Motor de alertas: revisa vencimientos y envía emails (una sola vez por evento).
// Se puede correr al arrancar el servidor y/o en un cron diario.
import db from '../db.js';
import { sendEmail } from './email.js';
import { daysUntil } from '../lib/dates.js';

// Registra que ya se notificó un evento; devuelve false si ya existía.
async function marcarNotificado(clientId, tipo, refKey, mensaje) {
  try {
    await db.prepare(
      `INSERT INTO notifications (client_id, tipo, ref_key, mensaje) VALUES (?, ?, ?, ?)`
    ).run(clientId, tipo, refKey, mensaje);
    return true;
  } catch {
    return false; // UNIQUE violado => ya se notificó
  }
}

export async function correrAlertas() {
  const clientes = await db.prepare(`SELECT id, email, razon_social FROM clients WHERE role = 'client'`).all();
  let enviadas = 0;

  for (const c of clientes) {
    // 1) Fianzas que vencen en <= 30 días
    const fianzas = await db.prepare(
      'SELECT id, numero_poliza, fecha_vigencia FROM fianzas WHERE client_id = ?'
    ).all(c.id);
    for (const f of fianzas) {
      const d = daysUntil(f.fecha_vigencia);
      if (d !== null && d >= 0 && d <= 30) {
        const msg = `La fianza ${f.numero_poliza} vence en ${d} días (${f.fecha_vigencia}).`;
        if (await marcarNotificado(c.id, 'fianza_30', `fianza:${f.id}`, msg)) {
          await sendEmail({ to: c.email, subject: 'Fortex · Fianza por vencer', text: msg });
          enviadas++;
        }
      }
    }

    // 2) Documentos por vencer (estados financieros 60d, comprobante domicilio 30d, etc.)
    const docs = await db.prepare(
      `SELECT cd.vencimiento, dt.nombre, dt.alerta_dias, dt.slug, cd.id
       FROM client_documents cd JOIN document_types dt ON dt.id = cd.document_type_id
       WHERE cd.client_id = ? AND cd.vencimiento IS NOT NULL`
    ).all(c.id);
    for (const doc of docs) {
      const d = daysUntil(doc.vencimiento);
      if (d !== null && d >= 0 && d <= doc.alerta_dias) {
        const tipo = doc.slug === 'estados_financieros' ? 'ef_60'
                   : doc.slug === 'comprobante_domicilio' ? 'domicilio_30' : 'doc_alerta';
        const msg = `Tu documento "${doc.nombre}" vence en ${d} días (${doc.vencimiento}). Súbelo actualizado.`;
        if (await marcarNotificado(c.id, tipo, `doc:${doc.id}:${doc.vencimiento}`, msg)) {
          await sendEmail({ to: c.email, subject: 'Fortex · Documento por vencer', text: msg });
          enviadas++;
        }
      }
    }

    // 3) Solicitudes de papelería pendientes (notificar al crearse)
    const papeleria = await db.prepare(
      `SELECT id, descripcion FROM papeleria_requests WHERE client_id = ? AND estado = 'pendiente'`
    ).all(c.id);
    for (const p of papeleria) {
      const msg = `Fortex solicita documentación: ${p.descripcion}`;
      if (await marcarNotificado(c.id, 'papeleria', `papeleria:${p.id}`, msg)) {
        await sendEmail({ to: c.email, subject: 'Fortex · Documentación solicitada', text: msg });
        enviadas++;
      }
    }
  }

  if (enviadas > 0) console.log(`✅ Alertas: ${enviadas} notificación(es) procesada(s).`);
  return enviadas;
}
