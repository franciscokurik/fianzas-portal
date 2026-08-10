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

// A quién le llega el aviso. Ya no es "el correo del cliente": una empresa
// tiene varias personas dadas de alta y el papel se lo puede resolver
// cualquiera de ellas, así que el aviso va a todas las cuentas activas.
async function destinatarios(clientId) {
  const filas = await db
    .prepare('SELECT email FROM users WHERE client_id = ? AND activo = 1')
    .all(clientId);
  return filas.map((f) => f.email);
}

export async function correrAlertas() {
  const clientes = await db.prepare('SELECT id, razon_social FROM clients').all();
  let enviadas = 0;

  for (const c of clientes) {
    const correos = await destinatarios(c.id);
    // Sin nadie a quién avisarle no se marca la notificación como enviada: si
    // mañana le dan de alta un usuario, el aviso todavía le puede llegar.
    if (!correos.length) continue;

    const avisar = async (tipo, refKey, mensaje, asunto) => {
      if (!(await marcarNotificado(c.id, tipo, refKey, mensaje))) return;
      for (const to of correos) await sendEmail({ to, subject: asunto, text: mensaje });
      enviadas++;
    };

    // 1) Fianzas que vencen en <= 30 días
    const fianzas = await db.prepare(
      'SELECT id, numero_poliza, fecha_vigencia FROM fianzas WHERE client_id = ?'
    ).all(c.id);
    for (const f of fianzas) {
      const d = daysUntil(f.fecha_vigencia);
      if (d !== null && d >= 0 && d <= 30) {
        await avisar(
          'fianza_30', `fianza:${f.id}`,
          `La fianza ${f.numero_poliza} vence en ${d} días (${f.fecha_vigencia}).`,
          'Fortex · Fianza por vencer',
        );
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
        await avisar(
          tipo, `doc:${doc.id}:${doc.vencimiento}`,
          `Tu documento "${doc.nombre}" vence en ${d} días (${doc.vencimiento}). Súbelo actualizado.`,
          'Fortex · Documento por vencer',
        );
      }
    }

    // 3) Solicitudes de papelería pendientes (notificar al crearse)
    const papeleria = await db.prepare(
      `SELECT id, descripcion FROM papeleria_requests WHERE client_id = ? AND estado = 'pendiente'`
    ).all(c.id);
    for (const p of papeleria) {
      await avisar(
        'papeleria', `papeleria:${p.id}`,
        `Fortex solicita documentación: ${p.descripcion}`,
        'Fortex · Documentación solicitada',
      );
    }
  }

  if (enviadas > 0) console.log(`✅ Alertas: ${enviadas} notificación(es) procesada(s).`);
  return enviadas;
}
