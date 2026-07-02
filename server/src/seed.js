// Carga datos iniciales y de demostración.
// Ejecutar:  npm run seed
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import db, { initSchema } from './db.js';
import { addMonths, todayISO } from './lib/dates.js';

initSchema();

console.log('🌱 Sembrando datos...');

// Limpia datos transaccionales (no borra el archivo .db, solo filas)
db.exec(`
  DELETE FROM notifications;
  DELETE FROM papeleria_requests;
  DELETE FROM client_documents;
  DELETE FROM fianzas;
  DELETE FROM clients;
  DELETE FROM document_types;
  DELETE FROM afianzadoras;
`);

// --- Afianzadoras ---
const afianzadoras = [
  ['Aserta', 'aserta'],
  ['Berkley', 'berkley'],
  ['Tokio Marine', 'tokio-marine'],
  ['Chubb', 'chubb'],
];
const insAfi = db.prepare('INSERT INTO afianzadoras (nombre, slug) VALUES (?, ?)');
const afiIds = {};
for (const [nombre, slug] of afianzadoras) {
  afiIds[slug] = insAfi.run(nombre, slug).lastInsertRowid;
}

// --- Tipos de documento estándar ---
const tipos = [
  ['Comprobante de domicilio', 'comprobante_domicilio', 3, 30, 1],
  ['Constancia de Situación Fiscal (CSF)', 'csf', null, 30, 2],
  ['Estados financieros anuales', 'estados_financieros', 12, 60, 3],
  ['Acta constitutiva', 'acta_constitutiva', null, 30, 4],
  ['Poder notarial', 'poder_notarial', null, 30, 5],
];
const insTipo = db.prepare(
  'INSERT INTO document_types (nombre, slug, periodicidad_meses, alerta_dias, orden) VALUES (?, ?, ?, ?, ?)'
);
const tipoIds = {};
for (const t of tipos) tipoIds[t[1]] = insTipo.run(...t).lastInsertRowid;

// --- Usuarios ---
const insClient = db.prepare(
  `INSERT INTO clients (razon_social, rfc, email, password_hash, role, linea_credito, telefono)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);
const hash = (p) => bcrypt.hashSync(p, 10);

// Admin Fortex
insClient.run('Fortex (Administrador)', 'FOR000000XXX', 'admin@fortex.mx', hash('admin123'), 'admin', 0, null);

// Cliente demo 1
const c1 = insClient.run(
  'Constructora del Bajío SA de CV', 'CBA120315ABC', 'cliente@demo.mx', hash('demo123'),
  'client', 5000000, '5551234567'
).lastInsertRowid;

// Cliente demo 2
const c2 = insClient.run(
  'Ingeniería Aplicada del Norte SA', 'IAN980720XYZ', 'norte@demo.mx', hash('demo123'),
  'client', 2000000, '5559876543'
).lastInsertRowid;

// --- Líneas de crédito por afianzadora ---
const insLinea = db.prepare(
  `INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito) VALUES (?, ?, ?)`
);
// Cliente 1: línea autorizada en tres afianzadoras
insLinea.run(c1, afiIds['aserta'], 3000000);
insLinea.run(c1, afiIds['berkley'], 1000000);
insLinea.run(c1, afiIds['tokio-marine'], 2000000);
// Cliente 2: línea en Chubb
insLinea.run(c2, afiIds['chubb'], 1000000);

// --- Fianzas del cliente 1 (variando vigencias para ver los estados) ---
const insFianza = db.prepare(
  `INSERT INTO fianzas (client_id, afianzadora_id, numero_poliza, tipo_fianza, prima_neta, monto_afianzado, fecha_inicio, fecha_vigencia)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
const hoy = todayISO();
insFianza.run(c1, afiIds['aserta'], 'ASE-2024-0012', 'Cumplimiento', 18500, 1200000, addMonths(hoy, -10), addMonths(hoy, 8)); // activa
insFianza.run(c1, afiIds['aserta'], 'ASE-2024-0048', 'Anticipo', 9200, 600000, addMonths(hoy, -11), addMonths(hoy, 0)); // por vencer (~hoy)
insFianza.run(c1, afiIds['berkley'], 'BRK-2023-7781', 'Buena calidad', 14300, 900000, addMonths(hoy, -14), addMonths(hoy, -2)); // vencida
insFianza.run(c1, afiIds['tokio-marine'], 'TKM-2025-0033', 'Cumplimiento', 21000, 1500000, addMonths(hoy, -2), addMonths(hoy, 10)); // activa

// Fianza del cliente 2
insFianza.run(c2, afiIds['chubb'], 'CHB-2024-1190', 'Cumplimiento', 7600, 450000, addMonths(hoy, -9), addMonths(hoy, 1)); // por vencer

// --- Documentos del cliente 1 (algunos subidos, otros pendientes) ---
const insDoc = db.prepare(
  `INSERT INTO client_documents (client_id, document_type_id, file_path, original_name, mime_type, size_bytes, uploaded_at, vencimiento)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);
// Comprobante de domicilio subido hace ~2.5 meses (por vencer pronto)
insDoc.run(c1, tipoIds['comprobante_domicilio'], 'demo/comprobante.pdf', 'comprobante.pdf', 'application/pdf', 102400, addMonths(hoy, -3), addMonths(hoy, 0));
// CSF subida (sin vencimiento)
insDoc.run(c1, tipoIds['csf'], 'demo/csf.pdf', 'csf.pdf', 'application/pdf', 88000, addMonths(hoy, -1), null);
// Estados financieros subidos hace 10 meses (por vencer en 2 meses -> alerta 60d)
insDoc.run(c1, tipoIds['estados_financieros'], 'demo/ef.pdf', 'estados_financieros.pdf', 'application/pdf', 250000, addMonths(hoy, -10), addMonths(hoy, 2));
// Acta y poder: pendientes (no se insertan)

// --- Papelería específica para cliente 1 ---
db.prepare(
  `INSERT INTO papeleria_requests (client_id, afianzadora_id, fianza_id, descripcion)
   VALUES (?, ?, ?, ?)`
).run(c1, afiIds['aserta'], null, 'Aserta requiere carta de no adeudo del SAT (formato 32-D) para renovar la línea.');

console.log('✅ Listo. Usuarios de prueba:');
console.log('   Admin   -> admin@fortex.mx / admin123');
console.log('   Cliente -> cliente@demo.mx (RFC CBA120315ABC) / demo123');
console.log('   Cliente -> norte@demo.mx / demo123');
