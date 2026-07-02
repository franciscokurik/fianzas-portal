// Carga datos iniciales y de demostración en Postgres.
// Uso como CLI:  npm run seed   (requiere DATABASE_URL)
// También se exporta seed()/seedIfEmpty() para el endpoint /api/setup.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import db, { initSchema } from './db.js';
import { addMonths, todayISO } from './lib/dates.js';

const hash = (p) => bcrypt.hashSync(p, 10);

export async function seed() {
  await initSchema();

  // Limpia datos existentes (respeta las llaves foráneas con CASCADE/orden)
  await db.query(`TRUNCATE notifications, papeleria_requests, client_documents,
    client_credit_lines, fianzas, clients, document_types, afianzadoras RESTART IDENTITY CASCADE`);

  // --- Afianzadoras ---
  const afianzadoras = [
    ['Aserta', 'aserta'],
    ['Berkley', 'berkley'],
    ['Tokio Marine', 'tokio-marine'],
    ['Chubb', 'chubb'],
  ];
  const afiIds = {};
  for (const [nombre, slug] of afianzadoras) {
    const row = await db
      .prepare('INSERT INTO afianzadoras (nombre, slug) VALUES (?, ?) RETURNING id')
      .get(nombre, slug);
    afiIds[slug] = row.id;
  }

  // --- Tipos de documento estándar ---
  const tipos = [
    ['Comprobante de domicilio', 'comprobante_domicilio', 3, 30, 1],
    ['Constancia de Situación Fiscal (CSF)', 'csf', null, 30, 2],
    ['Estados financieros anuales', 'estados_financieros', 12, 60, 3],
    ['Acta constitutiva', 'acta_constitutiva', null, 30, 4],
    ['Poder notarial', 'poder_notarial', null, 30, 5],
  ];
  const tipoIds = {};
  for (const t of tipos) {
    const row = await db
      .prepare(
        'INSERT INTO document_types (nombre, slug, periodicidad_meses, alerta_dias, orden) VALUES (?, ?, ?, ?, ?) RETURNING id'
      )
      .get(...t);
    tipoIds[t[1]] = row.id;
  }

  // --- Usuarios ---
  const insClient = db.prepare(
    `INSERT INTO clients (razon_social, rfc, email, password_hash, role, linea_credito, telefono)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
  );

  // Admin Fortex
  await insClient.get('Fortex (Administrador)', 'FOR000000XXX', 'admin@fortex.mx', hash('admin123'), 'admin', 0, null);

  // Cliente demo 1
  const c1 = (await insClient.get(
    'Constructora del Bajío SA de CV', 'CBA120315ABC', 'cliente@demo.mx', hash('demo123'),
    'client', 0, '5551234567'
  )).id;

  // Cliente demo 2
  const c2 = (await insClient.get(
    'Ingeniería Aplicada del Norte SA', 'IAN980720XYZ', 'norte@demo.mx', hash('demo123'),
    'client', 0, '5559876543'
  )).id;

  // --- Líneas de crédito por afianzadora ---
  const insLinea = db.prepare(
    `INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito) VALUES (?, ?, ?)`
  );
  await insLinea.run(c1, afiIds['aserta'], 3000000);
  await insLinea.run(c1, afiIds['berkley'], 1000000);
  await insLinea.run(c1, afiIds['tokio-marine'], 2000000);
  await insLinea.run(c2, afiIds['chubb'], 1000000);

  // --- Fianzas del cliente 1 (variando vigencias para ver los estados) ---
  const insFianza = db.prepare(
    `INSERT INTO fianzas (client_id, afianzadora_id, numero_poliza, tipo_fianza, prima_neta, monto_afianzado, fecha_inicio, fecha_vigencia)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const hoy = todayISO();
  await insFianza.run(c1, afiIds['aserta'], 'ASE-2024-0012', 'Cumplimiento', 18500, 1200000, addMonths(hoy, -10), addMonths(hoy, 8));
  await insFianza.run(c1, afiIds['aserta'], 'ASE-2024-0048', 'Anticipo', 9200, 600000, addMonths(hoy, -11), addMonths(hoy, 0));
  await insFianza.run(c1, afiIds['berkley'], 'BRK-2023-7781', 'Buena calidad', 14300, 900000, addMonths(hoy, -14), addMonths(hoy, -2));
  await insFianza.run(c1, afiIds['tokio-marine'], 'TKM-2025-0033', 'Cumplimiento', 21000, 1500000, addMonths(hoy, -2), addMonths(hoy, 10));

  // Fianza del cliente 2
  await insFianza.run(c2, afiIds['chubb'], 'CHB-2024-1190', 'Cumplimiento', 7600, 450000, addMonths(hoy, -9), addMonths(hoy, 1));

  // --- Documentos del cliente 1 (algunos subidos, otros pendientes) ---
  const insDoc = db.prepare(
    `INSERT INTO client_documents (client_id, document_type_id, file_path, original_name, mime_type, size_bytes, uploaded_at, vencimiento)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await insDoc.run(c1, tipoIds['comprobante_domicilio'], 'demo/comprobante.pdf', 'comprobante.pdf', 'application/pdf', 102400, addMonths(hoy, -3), addMonths(hoy, 0));
  await insDoc.run(c1, tipoIds['csf'], 'demo/csf.pdf', 'csf.pdf', 'application/pdf', 88000, addMonths(hoy, -1), null);
  await insDoc.run(c1, tipoIds['estados_financieros'], 'demo/ef.pdf', 'estados_financieros.pdf', 'application/pdf', 250000, addMonths(hoy, -10), addMonths(hoy, 2));

  // --- Papelería específica para cliente 1 ---
  await db.prepare(
    `INSERT INTO papeleria_requests (client_id, afianzadora_id, fianza_id, descripcion) VALUES (?, ?, ?, ?)`
  ).run(c1, afiIds['aserta'], null, 'Aserta requiere carta de no adeudo del SAT (formato 32-D) para renovar la línea.');

  return { clientes: 3, afianzadoras: afianzadoras.length };
}

// Siembra solo si la base está vacía (sin clientes). Devuelve true si sembró.
export async function seedIfEmpty() {
  await initSchema();
  const { total } = await db.prepare('SELECT COUNT(*)::int AS total FROM clients').get();
  if (total > 0) return false;
  await seed();
  return true;
}

// Ejecución directa como CLI
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  console.log('🌱 Sembrando datos en Postgres...');
  seed()
    .then((r) => {
      console.log(`✅ Listo (${r.clientes} usuarios, ${r.afianzadoras} afianzadoras).`);
      console.log('   Admin   -> admin@fortex.mx / admin123');
      console.log('   Cliente -> cliente@demo.mx (RFC CBA120315ABC) / demo123');
      console.log('   Cliente -> norte@demo.mx / demo123');
      process.exit(0);
    })
    .catch((e) => {
      console.error('❌ Error sembrando:', e);
      process.exit(1);
    });
}
