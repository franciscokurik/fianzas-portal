// Carga datos iniciales y de demostración en Postgres.
// Uso como CLI:  npm run seed   (requiere DATABASE_URL)
// También se exporta seed()/seedIfEmpty() para el endpoint /api/setup.
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import db, { initSchema } from './db.js';
import { addMonths, todayISO } from './lib/dates.js';

const hash = (p) => bcrypt.hashSync(p, 10);

// Los montos se guardan en centavos: aquí se escriben en pesos por legibilidad.
const pesos = (n) => Math.round(n * 100);

export async function seed() {
  await initSchema();

  // Limpia datos existentes (respeta las llaves foráneas con CASCADE/orden).
  // tipos_fianza NO se limpia: es un catálogo que siembra el propio esquema y
  // que el admin va ampliando, no datos de demostración.
  await db.query(`TRUNCATE notifications, papeleria_requests, client_documents,
    client_credit_lines, fianzas, proyectos, users, clients, document_types, afianzadoras
    RESTART IDENTITY CASCADE`);

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

  // --- Empresas fiadas y las personas que entran por ellas ---
  //
  // Son dos cosas distintas: la empresa no tiene contraseña, y cada persona
  // de la empresa entra con su propio correo viendo lo mismo.
  const insUsuario = db.prepare(
    `INSERT INTO users (client_id, nombre, email, password_hash, role)
     VALUES (?, ?, ?, ?, ?) RETURNING id`
  );
  const insClient = db.prepare(
    `INSERT INTO clients (razon_social, rfc, telefono, vendedor_id)
     VALUES (?, ?, ?, ?) RETURNING id`
  );

  // Personal de Fortex: no cuelgan de ninguna empresa.
  await insUsuario.get(null, 'Francisco Kuri', 'francisco@fortex.mx', hash('admin123'), 'admin');
  const vendedor = (await insUsuario.get(
    null, 'Mariana Ruiz', 'mariana@fortex.mx', hash('vendedor123'), 'vendedor'
  )).id;

  // Cliente demo 1, con tres accesos: así se ve para qué sirve tener varios.
  const c1 = (await insClient.get(
    'Constructora del Bajío SA de CV', 'CBA120315ABC', '5551234567', vendedor
  )).id;
  await insUsuario.get(c1, 'Dirección', 'cliente@demo.mx', hash('demo123'), 'client');
  await insUsuario.get(c1, 'Contabilidad', 'contabilidad@bajio.mx', hash('demo123'), 'client');
  await insUsuario.get(c1, 'Residencia de obra', 'obra@bajio.mx', hash('demo123'), 'client');

  // Cliente demo 2, todavía sin vendedor asignado: solo lo ve un administrador.
  const c2 = (await insClient.get(
    'Ingeniería Aplicada del Norte SA', 'IAN980720XYZ', '5559876543', null
  )).id;
  await insUsuario.get(c2, 'Dirección', 'norte@demo.mx', hash('demo123'), 'client');

  // --- Líneas de crédito por afianzadora ---
  const insLinea = db.prepare(
    `INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito) VALUES (?, ?, ?)`
  );
  await insLinea.run(c1, afiIds['aserta'], pesos(3000000));
  await insLinea.run(c1, afiIds['berkley'], pesos(1000000));
  await insLinea.run(c1, afiIds['tokio-marine'], pesos(2000000));
  await insLinea.run(c2, afiIds['chubb'], pesos(1000000));

  const hoy = todayISO();

  // --- Tipos de fianza (catálogo sembrado por el esquema) ---
  const tipoRows = await db.prepare('SELECT id, nombre FROM tipos_fianza').all();
  const tipoIdPorNombre = new Map(tipoRows.map((t) => [t.nombre, t.id]));

  // --- Proyectos (obras). Toda fianza cuelga de uno. ---
  const insProyecto = db.prepare(
    `INSERT INTO proyectos (client_id, nombre, numero_contrato, beneficiario, monto_contrato,
                            fecha_inicio, fecha_termino, estatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  );
  const pAcueducto = (await insProyecto.get(
    c1, 'Acueducto Poniente – Etapa II', 'CFE-2024-0871', 'Comisión Federal de Electricidad',
    pesos(24000000), addMonths(hoy, -12), addMonths(hoy, 6), 'en_proceso'
  )).id;
  const pHospital = (await insProyecto.get(
    c1, 'Ampliación Hospital General', 'IMSS-LP-2025-14', 'IMSS',
    pesos(18500000), addMonths(hoy, -3), addMonths(hoy, 12), 'en_proceso'
  )).id;
  const pPavimento = (await insProyecto.get(
    c1, 'Repavimentación Av. Constitución', 'MTY-OP-2023-330', 'Municipio de Monterrey',
    pesos(7200000), addMonths(hoy, -16), addMonths(hoy, -2), 'terminado'
  )).id;
  const pSubestacion = (await insProyecto.get(
    c2, 'Subestación eléctrica Apodaca', 'CFE-2024-1102', 'Comisión Federal de Electricidad',
    pesos(9800000), addMonths(hoy, -10), addMonths(hoy, 3), 'en_proceso'
  )).id;

  // --- Fianzas (variando vigencias para ver los estados) ---
  const insFianza = db.prepare(
    `INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                          tipo_fianza_id, prima_neta, prima_total, monto_afianzado,
                          fecha_inicio, fecha_vigencia,
                          fecha_recordatorio, nota_recordatorio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Lo que el fiado acaba pagando: prima neta + derecho de póliza + IVA. Los
  // datos de demo lo calculan; en la operación real el admin lo captura del
  // recibo, que es el único que manda.
  const DERECHO_POLIZA = 500;
  const IVA = 1.16;
  const primaTotalDe = (neta) => Math.round((neta + DERECHO_POLIZA) * IVA);

  const fianza = (clientId, proyectoId, afiSlug, poliza, tipo, prima, monto, ini, fin, rec = null, nota = null) =>
    insFianza.run(clientId, proyectoId, afiIds[afiSlug], poliza, tipoIdPorNombre.get(tipo) ?? null,
                  pesos(prima), pesos(primaTotalDe(prima)), pesos(monto), ini, fin, rec, nota);

  await fianza(c1, pAcueducto, 'aserta', 'ASE-2024-0012', 'Cumplimiento', 18500, 1200000,
    addMonths(hoy, -10), addMonths(hoy, 8),
    addMonths(hoy, 1), 'Pedir acta de entrega-recepción para tramitar la cancelación.');
  await fianza(c1, pAcueducto, 'aserta', 'ASE-2024-0048', 'Anticipo', 9200, 600000,
    addMonths(hoy, -11), addMonths(hoy, 0));
  await fianza(c1, pPavimento, 'berkley', 'BRK-2023-7781', 'Buena calidad (vicios ocultos)', 14300, 900000,
    addMonths(hoy, -14), addMonths(hoy, -2),
    addMonths(hoy, -1), 'Obra ya entregada: solicitar liberación a Berkley.');
  await fianza(c1, pHospital, 'tokio-marine', 'TKM-2025-0033', 'Cumplimiento', 21000, 1500000,
    addMonths(hoy, -2), addMonths(hoy, 10));

  // Fianza del cliente 2
  await fianza(c2, pSubestacion, 'chubb', 'CHB-2024-1190', 'Cumplimiento', 7600, 450000,
    addMonths(hoy, -9), addMonths(hoy, 1));

  // --- Documentos del cliente 1 (algunos subidos, otros pendientes) ---
  const insDoc = db.prepare(
    `INSERT INTO client_documents (client_id, document_type_id, file_path, original_name, mime_type, size_bytes, uploaded_at, vencimiento, subido_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  await insDoc.run(c1, tipoIds['comprobante_domicilio'], 'demo/comprobante.pdf', 'comprobante.pdf', 'application/pdf', 102400, addMonths(hoy, -3), addMonths(hoy, 0), 'cliente');
  await insDoc.run(c1, tipoIds['csf'], 'demo/csf.pdf', 'csf.pdf', 'application/pdf', 88000, addMonths(hoy, -1), null, 'cliente');
  // Los estados financieros suelen llegar por correo al contador de Fortex, no
  // por el portal: así se ve en la demo cómo queda uno cargado por Fortex.
  await insDoc.run(c1, tipoIds['estados_financieros'], 'demo/ef.pdf', 'estados_financieros.pdf', 'application/pdf', 250000, addMonths(hoy, -10), addMonths(hoy, 2), 'fortex');

  // --- Papelería específica para cliente 1 ---
  await db.prepare(
    `INSERT INTO papeleria_requests (client_id, afianzadora_id, fianza_id, descripcion) VALUES (?, ?, ?, ?)`
  ).run(c1, afiIds['aserta'], null, 'Aserta requiere carta de no adeudo del SAT (formato 32-D) para renovar la línea.');

  return { clientes: 2, usuarios: 6, afianzadoras: afianzadoras.length };
}

// Deja el portal listo para operar de verdad: borra TODOS los datos de
// clientes y no siembra nada de demostración.
//
// Conserva: las cuentas de Fortex (admin y vendedores, con su contraseña
// actual), las afianzadoras y los catálogos. Borra: empresas fiadas con sus
// usuarios, proyectos, fianzas, líneas, documentos, papelería y avisos.
export async function reiniciarVacio() {
  await initSchema();

  // Sin cuenta admin nadie podría volver a entrar: mejor no tocar nada.
  const { total: admins } = await db
    .prepare(`SELECT COUNT(*)::int AS total FROM users WHERE role = 'admin'`)
    .get();
  if (admins === 0) {
    throw new Error(
      'No hay ninguna cuenta admin en la base: reiniciar dejaría el portal sin acceso.'
    );
  }

  const contar = async (tabla) =>
    (await db.prepare(`SELECT COUNT(*)::int AS total FROM ${tabla}`).get()).total;
  const borrados = {
    clientes: await contar('clients'),
    proyectos: await contar('proyectos'),
    fianzas: await contar('fianzas'),
  };

  // El orden importa: fianzas.proyecto_id es ON DELETE RESTRICT, así que si se
  // dejara al CASCADE de clients podría intentar borrar el proyecto antes que
  // sus fianzas y abortar. Se van de abajo hacia arriba. Los usuarios del fiado
  // caen por CASCADE al irse su empresa; los de Fortex no cuelgan de ninguna.
  await db.query('DELETE FROM fianzas');
  await db.query('DELETE FROM proyectos');
  await db.query('DELETE FROM clients');

  return { ...borrados, admins_conservados: admins };
}

// Siembra SOLO si nadie ha usado todavía la base. Devuelve true si sembró.
//
// "Vacía" se medía únicamente por la tabla de clientes, y eso volvió peligroso
// a /api/setup: un portal en operación al que le dieron de baja a todos sus
// fiados sigue teniendo cuentas de Fortex reales, y seed() hace TRUNCATE de
// users. Llamar al setup en ese estado borraba las cuentas de administrador y
// las reemplazaba por las de demostración, con su contraseña publicada.
//
// Basta UNA cuenta para saber que alguien ya configuró esto.
export async function seedIfEmpty() {
  await initSchema();
  const { total } = await db.prepare(
    `SELECT ((SELECT COUNT(*) FROM clients) + (SELECT COUNT(*) FROM users))::int AS total`
  ).get();
  if (total > 0) return false;
  await seed();
  return true;
}

// Ejecución directa como CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('🌱 Sembrando datos en Postgres...');
  seed()
    .then((r) => {
      console.log(`✅ Listo (${r.clientes} empresas, ${r.usuarios} usuarios, ${r.afianzadoras} afianzadoras).`);
      console.log('   Admin    -> francisco@fortex.mx / admin123');
      console.log('   Vendedor -> mariana@fortex.mx / vendedor123');
      console.log('   Cliente  -> cliente@demo.mx (RFC CBA120315ABC) / demo123');
      console.log('   Cliente  -> contabilidad@bajio.mx / demo123  (misma empresa)');
      console.log('   Cliente  -> norte@demo.mx / demo123');
      process.exit(0);
    })
    .catch((e) => {
      console.error('❌ Error sembrando:', e);
      process.exit(1);
    });
}
