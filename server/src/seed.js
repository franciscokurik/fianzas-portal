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
  // client_proveedores se lista aunque el CASCADE de clients ya la vaciaría:
  // listarla es lo que hace que RESTART IDENTITY reinicie SU secuencia, y esta
  // lista es la documentación de facto de qué se borra.
  await db.query(`TRUNCATE notifications, papeleria_requests, client_documents,
    client_proveedores, documentos, client_credit_lines, fianzas, proyectos,
    partida_requisitos, partidas, desarrollos,
    users, clients, document_types, afianzadoras
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

  // Personal de Fortex: no cuelgan de ninguna empresa. Los tres niveles, para
  // poder ver en la demo en qué se diferencian.
  await insUsuario.get(null, 'Francisco Kuri', 'francisco@fortex.mx', hash('admin123'), 'admin');
  const operador = (await insUsuario.get(
    null, 'Mariana Ruiz', 'mariana@fortex.mx', hash('operador123'), 'operador'
  )).id;
  const vendedor = (await insUsuario.get(
    null, 'Carlos Treviño', 'carlos@fortex.mx', hash('vendedor123'), 'vendedor'
  )).id;

  // Cliente demo 1, con tres accesos: así se ve para qué sirve tener varios.
  const c1 = (await insClient.get(
    'Constructora del Bajío SA de CV', 'CBA120315ABC', '5551234567', operador
  )).id;
  await insUsuario.get(c1, 'Dirección', 'cliente@demo.mx', hash('demo123'), 'client');
  await insUsuario.get(c1, 'Contabilidad', 'contabilidad@bajio.mx', hash('demo123'), 'client');
  await insUsuario.get(c1, 'Residencia de obra', 'obra@bajio.mx', hash('demo123'), 'client');

  // Cliente demo 2, en la cartera del VENDEDOR: es el único que él alcanza, y
  // sirve para comprobar que no ve el de arriba.
  const c2 = (await insClient.get(
    'Ingeniería Aplicada del Norte SA', 'IAN980720XYZ', '5559876543', vendedor
  )).id;
  await insUsuario.get(c2, 'Dirección', 'norte@demo.mx', hash('demo123'), 'client');

  // --- Un CONTRATANTE y su padrón de proveedores ---
  //
  // Desarrollos Delta no compra fianzas: se las presentan sus proveedores. Por
  // eso no lleva línea de crédito ni expediente, y su gente entra a una pantalla
  // distinta —el padrón— en vez de a "Mis fianzas".
  const insContratante = db.prepare(
    `INSERT INTO clients (razon_social, rfc, telefono, vendedor_id, tipo)
     VALUES (?, ?, ?, ?, 'contratante') RETURNING id`
  );
  const delta = (await insContratante.get(
    'Desarrollos Delta SA de CV', 'DDE150610QR3', '5544332211', operador
  )).id;
  await insUsuario.get(delta, 'Control de contratistas', 'delta@demo.mx', hash('demo123'), 'client');

  // Los proveedores son fiados NORMALES: no tienen nada especial, y de hecho
  // pueden ser clientes directos de Fortex al mismo tiempo. Lo único que los
  // hace proveedores de Delta es el renglón del padrón.
  const pVega = (await insClient.get(
    'Cimentaciones Vega SA de CV', 'CVE110228LM4', '8112345678', operador
  )).id;
  await insUsuario.get(pVega, 'Dirección', 'vega@demo.mx', hash('demo123'), 'client');

  const pHerrera = (await insClient.get(
    'Instalaciones Herrera SA de CV', 'IHE170905TY8', '8187654321', vendedor
  )).id;
  await insUsuario.get(pHerrera, 'Dirección', 'herrera@demo.mx', hash('demo123'), 'client');

  // Sin usuario A PROPÓSITO: un proveedor puede vivir en el padrón sin que nadie
  // de esa empresa entre nunca al portal. Fortex le captura la fianza y Delta la
  // ve; el proveedor ni se enteró de que existe este sistema.
  const pSolis = (await insClient.get(
    'Acabados Solís SA de CV', 'ASO190412RW1', '8199887766', operador
  )).id;

  // Los PROYECTOS de Delta: el desarrollo completo, que es lo que él registra y
  // con lo que agrupa a sus proveedores. Dos, para que se vea que puede tener
  // varios y que uno recién capturado todavía no tiene proveedores adentro.
  const insDesarrollo = db.prepare(
    `INSERT INTO desarrollos (contratante_id, nombre, clave, ubicacion, monto_inversion,
                              fecha_inicio, fecha_termino, estatus, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  );

  const insPadron = db.prepare(
    `INSERT INTO client_proveedores (contratante_id, proveedor_id, alias, notas)
     VALUES (?, ?, ?, ?)`
  );
  await insPadron.run(delta, pVega, 'Estructura', 'Cimentación y estructura de la torre.');
  await insPadron.run(delta, pHerrera, 'Electromecánica', 'Instalaciones hidrosanitarias y eléctricas.');
  await insPadron.run(delta, pSolis, 'Acabados', 'Sin acceso al portal: la fianza la carga Fortex.');

  // --- Líneas de crédito por afianzadora ---
  const insLinea = db.prepare(
    `INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito) VALUES (?, ?, ?)`
  );
  await insLinea.run(c1, afiIds['aserta'], pesos(3000000));
  await insLinea.run(c1, afiIds['berkley'], pesos(1000000));
  await insLinea.run(c1, afiIds['tokio-marine'], pesos(2000000));
  await insLinea.run(c2, afiIds['chubb'], pesos(1000000));

  // Las líneas de los proveedores de Delta. La afianzadora se las autoriza a la
  // EMPRESA, no por obra: en el proyecto de Delta se ve cuánto de esa línea le
  // está apartando esa obra, y en el panel además cuánto queda disponible.
  await insLinea.run(pVega, afiIds['aserta'], pesos(5000000));
  await insLinea.run(pVega, afiIds['berkley'], pesos(8000000));
  await insLinea.run(pHerrera, afiIds['chubb'], pesos(2500000));

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

  // Las obras que los proveedores ejecutan PARA Delta. contratante_id es lo que
  // le abre a Delta las fianzas de esta obra; 'beneficiario' se llena igual
  // porque es el respaldo legible, pero el texto no autoriza nada.
  // Los dos proyectos de Delta. El primero es el que tiene proveedores adentro.
  const dTorre = (await insDesarrollo.get(
    delta, 'Torre Delta Poniente', 'TDP-01', 'Av. Constitución 1200, Monterrey, N.L.',
    pesos(180000000), addMonths(hoy, -8), addMonths(hoy, 14), 'en_proceso',
    'Torre de 24 niveles. Todos los contratistas presentan fianza de cumplimiento.'
  )).id;
  await insDesarrollo.get(
    delta, 'Plaza Delta Sur', 'PDS-01', 'Carretera Nacional km 12, Monterrey, N.L.',
    pesos(65000000), addMonths(hoy, 1), addMonths(hoy, 18), 'en_proceso',
    'Recién capturado: todavía no se le asignan proveedores.'
  );

  // Las PARTIDAS de la torre: los pedazos que Delta contrata por separado, con
  // lo que exige cada uno. Existen antes de saber quién las hace, y de eso se
  // trata todo este nivel.
  const insPartida = db.prepare(
    `INSERT INTO partidas (desarrollo_id, nombre, alcance, monto_estimado, orden)
     VALUES (?, ?, ?, ?, ?) RETURNING id`
  );
  const insRequisito = db.prepare(
    `INSERT INTO partida_requisitos (partida_id, tipo_fianza_id) VALUES (?, ?)`
  );
  // Se le cuelgan los tipos que exige. Del MISMO catálogo que las pólizas: si
  // fuera otra lista, una partida podría exigir algo incumplible.
  const partida = async (nombre, alcance, monto, orden, exige) => {
    const { id } = await insPartida.get(dTorre, nombre, alcance, pesos(monto), orden);
    for (const tipo of exige) await insRequisito.run(id, tipoIdPorNombre.get(tipo));
    return id;
  };

  const paCimentacion = await partida(
    'Cimentación y estructura', 'Pilotes, losas y estructura de concreto', 12500000, 10,
    // Exige DOS y Vega solo presentó una: es el renglón que sale INCOMPLETA, y
    // el falso OK que el portal arrastraba (con el cumplimiento y sin el
    // anticipo, antes salía en verde).
    ['Cumplimiento', 'Anticipo']
  );
  // Partida capturada y todavía SIN CONTRATISTA: el otro pendiente, el que es
  // del desarrollador y no del proveedor. Antes no se podía ni decir.
  await partida(
    'Muros y albañilería', 'Muros divisorios, aplanados y firmes', 6800000, 15,
    ['Cumplimiento']
  );
  const paInstalaciones = await partida(
    'Instalaciones hidrosanitarias y eléctricas', 'Hidráulica, sanitaria y eléctrica', 8300000, 20,
    ['Cumplimiento']
  );
  const paAcabados = await partida(
    'Acabados y cancelería', 'Pisos, pintura, cancelería de aluminio', 4100000, 30,
    ['Cumplimiento']
  );

  // Las obras de los proveedores van DENTRO de una partida del proyecto.
  // partida_id y desarrollo_id son agrupación; contratante_id sigue siendo lo
  // que autoriza, y los tres se derivan de la partida (ver resolverPartida en
  // routes/admin.js). 'beneficiario' se llena igual porque es el respaldo
  // legible, pero el texto no autoriza nada.
  const insObraPara = db.prepare(
    `INSERT INTO proyectos (client_id, contratante_id, desarrollo_id, partida_id, nombre,
                            numero_contrato, beneficiario, monto_contrato,
                            fecha_inicio, fecha_termino, estatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  );
  const DELTA = 'Desarrollos Delta SA de CV';
  const oVega = (await insObraPara.get(
    pVega, delta, dTorre, paCimentacion, 'Cimentación y estructura – Vega', 'DD-2025-014', DELTA,
    pesos(12500000), addMonths(hoy, -6), addMonths(hoy, 9), 'en_proceso'
  )).id;
  const oHerrera = (await insObraPara.get(
    pHerrera, delta, dTorre, paInstalaciones, 'Instalaciones – Herrera', 'DD-2025-021', DELTA,
    pesos(8300000), addMonths(hoy, -4), addMonths(hoy, 10), 'en_proceso'
  )).id;
  // Obra en proceso y SIN NINGUNA FIANZA en Fortex: es el renglón que Delta
  // quiere cazar, y la razón de ser de toda esta pantalla.
  const oSolis = (await insObraPara.get(
    pSolis, delta, dTorre, paAcabados, 'Acabados – Solís', 'DD-2025-033', DELTA,
    pesos(4100000), addMonths(hoy, -1), addMonths(hoy, 11), 'en_proceso'
  )).id;

  // Y la misma constructora trabajando para OTRO, sin ligar a ningún contratante
  // del portal. Es lo que hace demostrable el aislamiento: Delta NO debe ver
  // esta obra ni su póliza, aunque Cimentaciones Vega sí esté en su padrón.
  const oVegaCFE = (await insProyecto.get(
    pVega, 'Piloteado Planta CFE Escobedo', 'CFE-2025-0455', 'Comisión Federal de Electricidad',
    pesos(5200000), addMonths(hoy, -5), addMonths(hoy, 4), 'en_proceso'
  )).id;

  // --- Fianzas (variando vigencias para ver los estados) ---
  const insFianza = db.prepare(
    `INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                          tipo_fianza_id, prima_neta, prima_total, monto_afianzado,
                          fecha_inicio, fecha_vigencia,
                          fecha_recordatorio, nota_recordatorio, clase)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  // Lo que el fiado acaba pagando: prima neta + derecho de póliza + IVA. Los
  // datos de demo lo calculan; en la operación real el admin lo captura del
  // recibo, que es el único que manda.
  const DERECHO_POLIZA = 500;
  const IVA = 1.16;
  const primaTotalDe = (neta) => Math.round((neta + DERECHO_POLIZA) * IVA);

  const fianza = (clientId, proyectoId, afiSlug, poliza, tipo, prima, monto, ini, fin, rec = null, nota = null,
                  clase = 'fianza') =>
    insFianza.run(clientId, proyectoId, afiIds[afiSlug], poliza, tipoIdPorNombre.get(tipo) ?? null,
                  pesos(prima), pesos(primaTotalDe(prima)), pesos(monto), ini, fin, rec, nota, clase);

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

  // Un PREVIO: los mismos datos que una fianza, pero sin emitir. En la demo
  // sirve para ver que no suma en montos, primas ni línea de crédito, y que el
  // día que Tokio Marine emita basta cambiarle la clase.
  await fianza(c1, pHospital, 'tokio-marine', 'PREV-2025-0104', 'Anticipo', 12400, 3700000,
    addMonths(hoy, 0), addMonths(hoy, 12),
    addMonths(hoy, 0), 'Dar seguimiento a la emisión del previo con Tokio Marine.',
    'previo');

  // Fianza del cliente 2
  await fianza(c2, pSubestacion, 'chubb', 'CHB-2024-1190', 'Cumplimiento', 7600, 450000,
    addMonths(hoy, -9), addMonths(hoy, 1));

  // --- Fianzas de los proveedores de Delta ---
  //
  // Una por estado, para que el padrón se vea con los tres colores:
  //   Vega    -> vigente a 9 meses           => obra CUBIERTA
  //   Herrera -> vence en 1 mes              => obra POR VENCER
  //   Solís   -> no tiene ninguna            => obra SIN FIANZA
  // Veinte días: bien dentro de la ventana de "por vencer" (30 días o menos).
  // Sumar UN MES caería justo en el borde —28 a 31 días según el mes— y la demo
  // se vería de un color distinto según el día en que se sembrara.
  const en20Dias = new Date(new Date(`${hoy}T00:00:00Z`).getTime() + 20 * 86400000)
    .toISOString().slice(0, 10);

  await fianza(pVega, oVega, 'aserta', 'ASE-2025-1140', 'Cumplimiento', 22000, 1250000,
    addMonths(hoy, -6), addMonths(hoy, 9));
  await fianza(pHerrera, oHerrera, 'chubb', 'CHB-2025-0771', 'Cumplimiento', 15400, 830000,
    addMonths(hoy, -4), en20Dias);

  // La de la obra que Vega hace para CFE. Delta NO la ve: su obra no está
  // ligada a él. Si algún día se ve, es que se rompió el alcance.
  await fianza(pVega, oVegaCFE, 'berkley', 'BRK-2025-3390', 'Anticipo', 31000, 5200000,
    addMonths(hoy, -5), addMonths(hoy, 4));

  // Dos archivos sobre la MISMA fianza de Vega, y es a propósito: Delta ve la
  // carátula (acredita la garantía) y NO ve el recibo de prima (dice cuánto le
  // costó a su proveedor). La lista blanca vive en lib/permisos.js.
  const fVega = (await db.prepare(
    `SELECT id FROM fianzas WHERE numero_poliza = 'ASE-2025-1140'`
  ).get()).id;
  const insDocEntidad = db.prepare(
    `INSERT INTO documentos (client_id, entidad_tipo, entidad_id, tipo_doc, url,
                             nombre_archivo, mime_type, size_bytes)
     VALUES (?, 'fianza', ?, ?, ?, ?, 'application/pdf', ?)`
  );
  await insDocEntidad.run(pVega, fVega, 'caratula',
    'demo/caratula-ase-2025-1140.pdf', 'caratula.pdf', 190000);
  await insDocEntidad.run(pVega, fVega, 'recibo_prima',
    'demo/recibo-ase-2025-1140.pdf', 'recibo_prima.pdf', 64000);

  // Y el caso que explica para qué sirve la carpeta del contratante: la obra de
  // Acabados Solís no tiene NINGUNA póliza registrada en Fortex —la compró con
  // otro agente— pero Delta ya tiene el PDF que le entregaron. El archivo es de
  // DELTA (client_id), no del proveedor: es su copia, vive en su carpeta, y no
  // cuenta como cobertura en ninguna cifra. Sirve para que Fortex la capture si
  // acaba colocándola.
  await db.prepare(
    `INSERT INTO documentos (client_id, entidad_tipo, entidad_id, tipo_doc, url,
                             nombre_archivo, mime_type, size_bytes, subido_por)
     VALUES (?, 'proyecto', ?, 'fianza_presentada', ?, ?, 'application/pdf', ?, 'contratante')`
  ).run(delta, oSolis, 'demo/fianza-solis-otro-agente.pdf',
        'fianza-acabados-solis.pdf', 148000);

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

  return {
    clientes: 5, contratantes: 1, proyectos_de_contratante: 2, partidas: 4,
    usuarios: 10, afianzadoras: afianzadoras.length,
  };
}

// Deja el portal listo para operar de verdad: borra TODOS los datos de
// clientes y no siembra nada de demostración.
//
// Conserva: las cuentas de Fortex (admin y operadores, con su contraseña
// actual), las afianzadoras y los catálogos. Borra: empresas fiadas con sus
// usuarios, proyectos, fianzas, líneas, documentos, papelería y avisos — y
// también los CONTRATANTES con su padrón de proveedores, que cuelga de clients
// por los dos lados y se va por CASCADE.
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
    // Los contratantes se cuentan aparte: quien aprieta este botón necesita
    // saber que también se va el padrón de proveedores, que no es obvio.
    clientes: (await db.prepare(`SELECT COUNT(*)::int AS total FROM clients WHERE tipo = 'fiado'`).get()).total,
    contratantes: (await db.prepare(`SELECT COUNT(*)::int AS total FROM clients WHERE tipo = 'contratante'`).get()).total,
    padron: await contar('client_proveedores'),
    proyectos: await contar('proyectos'),
    proyectos_de_contratante: await contar('desarrollos'),
    partidas: await contar('partidas'),
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
      console.log(`✅ Listo (${r.clientes} empresas —${r.contratantes} contratante—, ${r.usuarios} usuarios, ${r.afianzadoras} afianzadoras).`);
      console.log('   Admin    -> francisco@fortex.mx / admin123');
      console.log('   Operador -> mariana@fortex.mx / operador123');
      console.log('   Vendedor -> carlos@fortex.mx / vendedor123  (solo ve un cliente)');
      console.log('   Cliente  -> cliente@demo.mx (RFC CBA120315ABC) / demo123');
      console.log('   Cliente  -> contabilidad@bajio.mx / demo123  (misma empresa)');
      console.log('   Cliente  -> norte@demo.mx / demo123');
      console.log('   Contratante -> delta@demo.mx / demo123  (ve el padrón de proveedores, no compra fianzas)');
      console.log('   Proveedor   -> vega@demo.mx / demo123    (le surte a Delta y también trabaja para CFE)');
      process.exit(0);
    })
    .catch((e) => {
      console.error('❌ Error sembrando:', e);
      process.exit(1);
    });
}
