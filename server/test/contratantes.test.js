// El contratante: el desarrollador que no compra fianzas, las EXIGE.
//
// Lo que se prueba aquí es una sola cosa dicha de varias formas: un contratante
// es un TERCERO respecto a su proveedor, y lo único que alcanza son las fianzas
// de las obras que ese proveedor ejecuta PARA ÉL. Todo lo demás —la obra que el
// mismo proveedor hace para la competencia, la prima que pagó, su línea de
// crédito, su expediente— tiene que quedar fuera, y quedar fuera por
// construcción y no por acuerdo.
//
// La prueba de la carga completa (la de las llaves prohibidas) es a propósito
// una lista blanca sobre TODO el JSON y no una revisión de campos sueltos: así
// el día que alguien agregue una columna a 'fianzas' se entera aquí y no en la
// pantalla de un cliente.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { baseEnMemoria } from './ayuda/pg-memoria.js';

process.env.DATABASE_URL ??= 'postgres://noop';
process.env.JWT_SECRET = 'secreto-de-prueba';

const { default: db } = await import('../src/db.js');
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

const { default: app } = await import('../src/app.js');
const { signToken } = await import('../src/auth/middleware.js');
const { inicializar } = await import('../src/migrations.js');

let servidor;
let base;
let admin;      // Fortex
let operador;   // Fortex
let delta;      // gente de Desarrollos Delta (contratante)
let vega;       // gente de Cimentaciones Vega (proveedor de Delta)

// Ids fijos para poder leer las aserciones sin perseguir variables.
const DELTA = 1;
const VEGA = 2;         // proveedor de Delta, y además trabaja para CFE
const AJENA = 3;        // no está en el padrón de Delta
const OBRA_DELTA = 1;   // de Vega, ligada a Delta
const OBRA_CFE = 2;     // de Vega, sin contratante del portal
const OBRA_AJENA = 3;

// El mismo monto en las dos fianzas de Vega, para que cualquier suma que
// revuelva la de Delta con la de CFE salte a la vista.
const MONTO = 1250000;

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social, rfc, tipo) VALUES
      ('Desarrollos Delta',    'DDE150610QR3', 'contratante'),
      ('Cimentaciones Vega',   'CVE110228LM4', 'fiado'),
      ('Constructora Ajena',   'CAJ200101ZZ9', 'fiado');
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Administración', 'admin@fortex.mx',   'x', 'admin'),
      (NULL, 'Mariana',        'mariana@fortex.mx', 'x', 'operador'),
      (1,    'Control',        'delta@demo.mx',     'x', 'client'),
      (2,    'Dirección',      'vega@demo.mx',      'x', 'client'),
      (NULL, 'Carlos',         'carlos@fortex.mx',  'x', 'vendedor');

    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta','aserta');
    INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito)
      VALUES (2, 1, 90000000);

    -- Vega en el padrón de Delta. 'Constructora Ajena' NO.
    INSERT INTO client_proveedores (contratante_id, proveedor_id, alias)
      VALUES (1, 2, 'Estructura');

    -- Tres obras: la de Delta, la que Vega hace para CFE (sin ligar), y una de
    -- una constructora que no está en el padrón.
    INSERT INTO proyectos (client_id, contratante_id, nombre, monto_contrato, estatus) VALUES
      (2, 1,    'Torre Delta',   12500000, 'en_proceso'),
      (2, NULL, 'Planta CFE',     5200000, 'en_proceso'),
      (3, NULL, 'Obra de otros',  3000000, 'en_proceso');
  `);

  const tipo = (await memoria.query(
    `SELECT id FROM tipos_fianza WHERE nombre = 'Cumplimiento'`
  ))[0].id;

  await memoria.query(
    `INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                          tipo_fianza_id, prima_neta, prima_total, monto_afianzado,
                          fecha_inicio, fecha_vigencia)
     VALUES (2, 1, 1, 'DELTA-1', ${tipo}, 22000, 27000, ${MONTO}, '2026-01-01', '2099-01-01'),
            (2, 2, 1, 'CFE-1',   ${tipo}, 31000, 37000, ${MONTO}, '2026-01-01', '2099-01-01')`
  );

  // Dos archivos sobre la fianza que Delta SÍ alcanza. Uno lo puede ver y el
  // otro no: el recibo de prima dice cuánto le costó a su proveedor.
  await memoria.query(
    `INSERT INTO documentos (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo)
     VALUES (2, 'fianza', 1, 'caratula',     'https://cdn/caratula.pdf', 'caratula.pdf'),
            (2, 'fianza', 1, 'recibo_prima', 'https://cdn/recibo.pdf',   'recibo.pdf')`
  );

  admin = signToken({ id: 1, role: 'admin', nombre: 'Administración' });
  operador = signToken({ id: 2, role: 'operador', nombre: 'Mariana' });
  delta = signToken({ id: 3, role: 'client', client_id: DELTA, nombre: 'Control' });
  vega = signToken({ id: 4, role: 'client', client_id: VEGA, nombre: 'Dirección' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const pedir = (ruta, token) =>
  fetch(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual' });

const mandar = (metodo, ruta, token, cuerpo) =>
  fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

// ---------------------------------------------------------------------------
// El alcance: la obra ligada, y nada más
// ---------------------------------------------------------------------------

test('el contratante ve el padrón con el cumplimiento de cada proveedor', async () => {
  const res = await pedir('/api/proveedores', delta);
  assert.equal(res.status, 200);
  const { razon_social, proveedores, metricas } = await res.json();

  assert.equal(razon_social, 'Desarrollos Delta');
  assert.equal(proveedores.length, 1);
  assert.equal(proveedores[0].razon_social, 'Cimentaciones Vega');
  assert.equal(proveedores[0].alias, 'Estructura');
  assert.equal(proveedores[0].cumplimiento, 'cubierta');

  // Una obra y una fianza: las de Delta. La de CFE no se cuenta ni se suma.
  assert.equal(proveedores[0].total_obras, 1);
  assert.equal(proveedores[0].total_fianzas, 1);
  assert.equal(proveedores[0].monto_afianzado, MONTO);
  assert.equal(metricas.monto_afianzado, MONTO,
    'si sale el doble, se colaron las dos fianzas de Vega');
});

test('la obra que el MISMO proveedor hace para otro no se ve', async () => {
  const { obras } = await (await pedir(`/api/proveedores/${VEGA}`, delta)).json();

  assert.deepEqual(obras.map((o) => o.nombre), ['Torre Delta']);
  const polizas = obras.flatMap((o) => o.fianzas.map((f) => f.numero_poliza));
  assert.deepEqual(polizas, ['DELTA-1'], 'CFE-1 no es asunto de Delta');
});

test('un proveedor que no está en el padrón no se abre', async () => {
  const res = await pedir(`/api/proveedores/${AJENA}`, delta);
  // 404 y no 403: decirle "existe pero no es tuyo" le confirmaría que esa
  // empresa es cliente de Fortex.
  assert.equal(res.status, 404);
});

// Estas dos pruebas rompen el estado a propósito para ver qué se cierra, así que
// lo devuelven en un finally: si se restaurara al final y la aserción fallara,
// la base se quedaría rota y arrastraría a todas las pruebas de abajo — una
// falla se leería como doce.
test('quitar la liga de la obra le cierra la puerta, aunque siga en el padrón', async () => {
  await memoria.query('UPDATE proyectos SET contratante_id = NULL WHERE id = ?', [OBRA_DELTA]);
  try {
    const { proveedores, obras } = await (await pedir('/api/proveedores', delta)).json();
    assert.equal(obras.length, 0, 'sin liga de obra no hay nada que ver');
    assert.equal(proveedores[0].cumplimiento, 'sin_obra',
      'sigue en el padrón, pero ya no se le juzga ninguna obra');
  } finally {
    await memoria.query('UPDATE proyectos SET contratante_id = ? WHERE id = ?', [DELTA, OBRA_DELTA]);
  }
});

test('suspender al proveedor le cierra la puerta, aunque la obra siga ligada', async () => {
  await memoria.query(
    'UPDATE client_proveedores SET activo = 0 WHERE contratante_id = ? AND proveedor_id = ?',
    [DELTA, VEGA]
  );
  try {
    const { proveedores, obras } = await (await pedir('/api/proveedores', delta)).json();
    assert.equal(proveedores.length, 0, 'el suspendido sale del padrón');
    assert.equal(obras.length, 0, 'y sus obras dejan de alcanzarse en el mismo instante');
    assert.equal((await pedir(`/api/proveedores/${VEGA}`, delta)).status, 404);
  } finally {
    await memoria.query(
      'UPDATE client_proveedores SET activo = 1 WHERE contratante_id = ? AND proveedor_id = ?',
      [DELTA, VEGA]
    );
  }
});

// ---------------------------------------------------------------------------
// Lo que NUNCA sale
// ---------------------------------------------------------------------------

// Las llaves que no pueden aparecer en NINGÚN nivel de la respuesta.
const PROHIBIDAS = [
  'prima_neta', 'prima_total',            // lo que le costó al proveedor
  'linea_credito', 'comprometido', 'disponible',
  'fecha_recordatorio', 'nota_recordatorio', 'recordatorio_atendido_el',
  'url',                                  // la liga directa al archivo
  'password_hash', 'email',
];

function llavesProhibidas(valor, encontradas = new Set()) {
  if (Array.isArray(valor)) {
    valor.forEach((v) => llavesProhibidas(v, encontradas));
  } else if (valor && typeof valor === 'object') {
    for (const k of Object.keys(valor)) {
      if (PROHIBIDAS.includes(k)) encontradas.add(k);
      llavesProhibidas(valor[k], encontradas);
    }
  }
  return encontradas;
}

test('la carga del padrón no trae ni una llave prohibida', async () => {
  const lista = await (await pedir('/api/proveedores', delta)).json();
  assert.deepEqual([...llavesProhibidas(lista)], []);

  const detalle = await (await pedir(`/api/proveedores/${VEGA}`, delta)).json();
  assert.deepEqual([...llavesProhibidas(detalle)], []);
});

test('de los archivos de la fianza solo ve la carátula', async () => {
  const { obras } = await (await pedir(`/api/proveedores/${VEGA}`, delta)).json();
  const docs = obras.flatMap((o) => o.fianzas.flatMap((f) => f.documentos));

  assert.deepEqual(docs.map((d) => d.tipo_doc), ['caratula'],
    'el recibo de prima dice cuánto le cobró la afianzadora al proveedor');
});

test('el recibo de prima tampoco se descarga a mano por su id', async () => {
  const { id: idRecibo } = await memoria.prepare(
    `SELECT id FROM documentos WHERE tipo_doc = 'recibo_prima'`
  ).get();
  const { id: idCaratula } = await memoria.prepare(
    `SELECT id FROM documentos WHERE tipo_doc = 'caratula'`
  ).get();

  assert.equal((await pedir(`/api/proveedores/documentos/${idRecibo}`, delta)).status, 404);
  assert.equal((await pedir(`/api/proveedores/documentos/${idCaratula}`, delta)).status, 302,
    'la carátula sí, que es lo que acredita la garantía');
});

// ---------------------------------------------------------------------------
// Las dos mitades del portal no se cruzan
// ---------------------------------------------------------------------------

test('el contratante no entra al portal del fiado', async () => {
  for (const ruta of ['/api/dashboard', '/api/fianzas', '/api/documentos']) {
    const res = await pedir(ruta, delta);
    assert.equal(res.status, 403, ruta);
    assert.match((await res.json()).error, /contratante/i, ruta);
  }
});

test('el fiado no entra al portal del contratante', async () => {
  const res = await pedir('/api/proveedores', vega);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /contratantes/i);
});

test('el personal de Fortex tampoco: no tiene empresa propia', async () => {
  const res = await pedir('/api/proveedores', admin);
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /panel de Fortex/i);
});

test('el contratante no sube archivos', async () => {
  const res = await mandar('POST', '/api/subidas/firma', delta, {
    client_id: DELTA, nombre: 'x.pdf', mime: 'application/pdf',
  });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /no se suben archivos/i);
});

// ---------------------------------------------------------------------------
// El panel de Fortex
// ---------------------------------------------------------------------------

test('a un contratante no se le captura obra, póliza ni línea de crédito', async () => {
  const obra = await mandar('POST', '/api/admin/proyectos', admin, {
    client_id: DELTA, nombre: 'Obra propia de Delta',
  });
  assert.equal(obra.status, 400);
  assert.match((await obra.json()).error, /tipo contratante/i);

  const linea = await mandar('PUT', `/api/admin/clientes/${DELTA}/lineas`, admin, {
    afianzadora_id: 1, linea_credito: 5000000,
  });
  assert.equal(linea.status, 400);

  const poliza = await mandar('POST', '/api/admin/fianzas', admin, {
    client_id: DELTA, proyecto_id: OBRA_DELTA, afianzadora_id: 1, numero_poliza: 'X-1',
  });
  assert.equal(poliza.status, 400);
});

test('el detalle de un contratante trae su padrón, no tablas vacías de fiado', async () => {
  const d = await (await pedir(`/api/admin/clientes/${DELTA}/detalle`, admin)).json();

  assert.equal(d.cliente.tipo, 'contratante');
  assert.equal(d.proveedores.length, 1);
  assert.equal(d.metricas.obras_vivas, 1);
  // Y nada del fiado, que para un contratante no significa nada.
  assert.deepEqual(d.lineas, []);
  assert.deepEqual(d.documentos, []);
  assert.deepEqual(d.fianzas, []);
});

test('el detalle de un fiado dice a qué contratantes le surte', async () => {
  const d = await (await pedir(`/api/admin/clientes/${VEGA}/detalle`, admin)).json();

  assert.equal(d.cliente.tipo, 'fiado');
  assert.deepEqual(d.contratantes.map((c) => c.razon_social), ['Desarrollos Delta']);
  assert.equal(d.contratantes[0].obras_ligadas, 1);
  // Y la obra dice para quién es, para que el operador lo vea antes de capturar.
  const torre = d.proyectos.find((p) => p.nombre === 'Torre Delta');
  assert.equal(torre.contratante_nombre, 'Desarrollos Delta');
  assert.equal(d.proyectos.find((p) => p.nombre === 'Planta CFE').contratante_nombre, null);
});

test('la lista de clientes no le inventa pendientes al contratante', async () => {
  const { clientes } = await (await pedir('/api/admin/clientes', admin)).json();
  const d = clientes.find((c) => c.id === DELTA);

  assert.equal(d.tipo, 'contratante');
  assert.equal(d.total_proveedores, 1);
  // Antes decía "5 documento(s) faltante(s)": el catálogo completo del
  // expediente, que a un contratante nadie le va a pedir nunca.
  assert.equal(d.docs_pendientes, 0);
  assert.equal(d.obras_descubiertas, 0);

  const v = clientes.find((c) => c.id === VEGA);
  assert.equal(v.total_contratantes, 1);
});

test('una obra no se liga a otro fiado, solo a un contratante', async () => {
  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA_CFE}`, admin, {
    contratante_id: AJENA,
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no es de tipo contratante/i);
});

test('una obra no se liga al fiado que la ejecuta', async () => {
  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA_CFE}`, admin, {
    contratante_id: VEGA,
  });
  assert.equal(res.status, 400);
});

test('ligar una obra mete al proveedor en el padrón si no estaba', async () => {
  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA_AJENA}`, admin, {
    contratante_id: DELTA,
  });
  assert.equal(res.status, 200);

  const { proveedores } = await (await pedir('/api/proveedores', delta)).json();
  assert.ok(proveedores.some((p) => p.id === AJENA),
    'si no entra al padrón, Delta ve la fianza pero no de quién es');

  // Se deja como estaba para no arrastrar el efecto a las pruebas de abajo.
  await mandar('PUT', `/api/admin/proyectos/${OBRA_AJENA}`, admin, { contratante_id: '' });
  await mandar('DELETE', `/api/admin/clientes/${DELTA}/proveedores/${AJENA}`, admin);
});

test('el vendedor no liga una obra a un contratante: eso no se deshace', async () => {
  const carlos = await memoria.prepare(
    `SELECT id FROM users WHERE email = 'carlos@fortex.mx'`
  ).get();
  const vendedorToken = signToken({ id: carlos.id, role: 'vendedor', nombre: 'Carlos' });
  await memoria.query('UPDATE clients SET vendedor_id = ? WHERE id = ?', [carlos.id, VEGA]);

  try {
    const res = await mandar('PUT', `/api/admin/proyectos/${OBRA_CFE}`, vendedorToken, {
      contratante_id: DELTA,
    });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /operador/i);

    // Lo demás de la obra sí lo captura: lo que se le cierra es exactamente la
    // decisión que le abre las pólizas de su cliente a otra empresa.
    const ok = await mandar('PUT', `/api/admin/proyectos/${OBRA_CFE}`, vendedorToken, {
      numero_contrato: 'CFE-2025-0455',
    });
    assert.equal(ok.status, 200);

    // Y lo importante: el formulario manda SIEMPRE contratante_id —también
    // vacío, que es la única forma de desligar—, así que la guarda tiene que
    // comparar valores y no la presencia del campo. Con una guarda por
    // presencia, el vendedor no podía guardar NI UNA edición de sus obras.
    const comoElFormulario = await mandar('PUT', `/api/admin/proyectos/${OBRA_CFE}`, vendedorToken, {
      nombre: 'Planta CFE', numero_contrato: 'CFE-2025-0455', beneficiario: 'CFE',
      monto_contrato: 5200000, fecha_inicio: '', fecha_termino: '',
      estatus: 'en_proceso', notas: '', contratante_id: '',
    });
    assert.equal(comoElFormulario.status, 200,
      'el vendedor tiene que poder guardar su obra sin tocar el contratante');

    // Y sigue sin poder cambiarlo de verdad.
    const intentaLigar = await mandar('PUT', `/api/admin/proyectos/${OBRA_CFE}`, vendedorToken, {
      nombre: 'Planta CFE', contratante_id: String(DELTA),
    });
    assert.equal(intentaLigar.status, 403);
  } finally {
    await memoria.query('UPDATE clients SET vendedor_id = NULL WHERE id = ?', [VEGA]);
  }
});

// ---------------------------------------------------------------------------
// El padrón se administra desde el panel
// ---------------------------------------------------------------------------

test('el proveedor nuevo se crea desde el padrón, sin exigirle correo', async () => {
  const res = await mandar('POST', `/api/admin/clientes/${DELTA}/proveedores`, operador, {
    razon_social: 'Herrería del Valle SA', rfc: 'HVA210301KK2', alias: 'Herrería',
  });
  assert.equal(res.status, 200);
  const { proveedor_id, creado } = await res.json();
  assert.equal(creado, true);

  const nuevo = await memoria.prepare(
    'SELECT tipo, vendedor_id FROM clients WHERE id = ?'
  ).get(proveedor_id);
  assert.equal(nuevo.tipo, 'fiado');

  // Sin cuenta de acceso: un proveedor puede vivir en el padrón sin que nadie
  // de esa empresa entre nunca al portal.
  const { total } = await memoria.prepare(
    'SELECT COUNT(*)::int AS total FROM users WHERE client_id = ?'
  ).get(proveedor_id);
  assert.equal(total, 0);

  // Y le aparece a Delta como 'sin_obra': está en el padrón y todavía no se le
  // ligó ninguna obra. No es lo mismo que no haber presentado fianza.
  const { proveedores } = await (await pedir('/api/proveedores', delta)).json();
  assert.equal(proveedores.find((p) => p.id === proveedor_id).cumplimiento, 'sin_obra');
});

test('suspender conserva el renglón; borrar solo quita la liga', async () => {
  const nuevo = await memoria.prepare(
    `SELECT id FROM clients WHERE razon_social = 'Herrería del Valle SA'`
  ).get();

  const susp = await mandar(
    'PUT', `/api/admin/clientes/${DELTA}/proveedores/${nuevo.id}`, operador, { activo: false }
  );
  assert.equal(susp.status, 200);

  const { proveedores } = await (await pedir('/api/proveedores', delta)).json();
  assert.ok(!proveedores.some((p) => p.id === nuevo.id), 'el suspendido no se lista');
  const fila = await memoria.prepare(
    'SELECT activo FROM client_proveedores WHERE contratante_id = ? AND proveedor_id = ?'
  ).get(DELTA, nuevo.id);
  assert.equal(fila.activo, 0, 'pero el renglón sigue ahí, con su historial');

  // Y la empresa sigue existiendo aunque se borre la liga.
  const del = await mandar(
    'DELETE', `/api/admin/clientes/${DELTA}/proveedores/${nuevo.id}`, operador
  );
  assert.equal(del.status, 200);
  assert.ok(await memoria.prepare('SELECT id FROM clients WHERE id = ?').get(nuevo.id),
    'borrar del padrón NO borra la empresa');
});

test('no se saca del padrón a alguien con obras todavía ligadas', async () => {
  const res = await mandar(
    'DELETE', `/api/admin/clientes/${DELTA}/proveedores/${VEGA}`, operador
  );
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /obra\(s\) ligada\(s\)/i);
});

test('nadie es su propio proveedor, y un contratante no es proveedor de otro', async () => {
  const propio = await mandar('POST', `/api/admin/clientes/${DELTA}/proveedores`, operador, {
    proveedor_id: DELTA,
  });
  assert.equal(propio.status, 400);

  await memoria.query(
    `INSERT INTO clients (razon_social, tipo) VALUES ('Otro Desarrollador', 'contratante')`
  );
  const otro = await memoria.prepare(
    `SELECT id FROM clients WHERE razon_social = 'Otro Desarrollador'`
  ).get();

  const cruzado = await mandar('POST', `/api/admin/clientes/${DELTA}/proveedores`, operador, {
    proveedor_id: otro.id,
  });
  assert.equal(cruzado.status, 400);
  assert.match((await cruzado.json()).error, /tipo fiado/i);
});

test('cambiar el tipo se niega si dejaría datos que nadie puede ver', async () => {
  // Vega tiene obras y pólizas: volverlo contratante las dejaría invisibles.
  const res = await mandar('PUT', `/api/admin/clientes/${VEGA}/tipo`, operador, {
    tipo: 'contratante',
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /póliza/i);

  // Y Delta tiene padrón: volverlo fiado lo dejaría sin la pantalla que lo usa.
  const alReves = await mandar('PUT', `/api/admin/clientes/${DELTA}/tipo`, operador, {
    tipo: 'fiado',
  });
  assert.equal(alReves.status, 400);
  assert.match((await alReves.json()).error, /padrón/i);
});

// ---------------------------------------------------------------------------
// La fianza sin fecha de vigencia
// ---------------------------------------------------------------------------

test('una fianza sin fecha de vigencia NO se pinta como cubierta', async () => {
  await memoria.query(
    `UPDATE fianzas SET fecha_vigencia = NULL WHERE numero_poliza = 'DELTA-1'`
  );
  try {
    const { proveedores, metricas } = await (await pedir('/api/proveedores', delta)).json();
    assert.equal(proveedores[0].cumplimiento, 'sin_vigencia',
      'para el fiado "sin fecha" es su propia captura incompleta; aquí sería decirle '
      + 'al desarrollador que su proveedor está cubierto sin saberlo');
    assert.equal(metricas.obras_cubiertas, 0);
    assert.equal(metricas.obras_descubiertas, 1);
    assert.equal(metricas.monto_afianzado, 0, 'no se puede sumar lo que no se sabe si cubre');
  } finally {
    await memoria.query(
      `UPDATE fianzas SET fecha_vigencia = '2099-01-01' WHERE numero_poliza = 'DELTA-1'`
    );
  }
});

test('un previo no cubre nada: la obra sigue descubierta', async () => {
  await memoria.query(`UPDATE fianzas SET clase = 'previo' WHERE numero_poliza = 'DELTA-1'`);
  try {
    const { proveedores, metricas } = await (await pedir('/api/proveedores', delta)).json();
    assert.equal(proveedores[0].cumplimiento, 'sin_fianza');
    assert.equal(proveedores[0].total_previos, 1, 'pero se dice que el trámite ya va');
    assert.equal(metricas.previos_en_tramite, 1);
  } finally {
    await memoria.query(`UPDATE fianzas SET clase = 'fianza' WHERE numero_poliza = 'DELTA-1'`);
  }
});

// ---------------------------------------------------------------------------
// La obra cerrada: se lista, pero no se juzga — y las dos pantallas tienen que
// decir lo MISMO. Cada aserción de aquí abajo corresponde a una contradicción
// que de verdad se pintó en pantalla.
// ---------------------------------------------------------------------------

test('una obra cerrada no cuenta como incumplimiento, y se dice por qué', async () => {
  await memoria.query(`UPDATE proyectos SET estatus = 'cerrado' WHERE id = ?`, [OBRA_DELTA]);
  try {
    const { proveedores, obras, metricas } = await (await pedir('/api/proveedores', delta)).json();

    assert.equal(metricas.obras_vivas, 0);
    assert.equal(metricas.obras_descubiertas, 0, 'una obra cerrada no se le exige a nadie');

    // Se sigue listando, con el dato que explica por qué no se juzga.
    assert.equal(obras.length, 1);
    assert.equal(obras[0].viva, false);
    assert.equal(obras[0].estatus, 'cerrado');

    // Y el proveedor NO sale como 'sin_obra': la captura está hecha, lo que
    // pasa es que el trabajo terminó. Decirle "falta la captura" mandaría al
    // operador a buscar algo que no falta.
    assert.equal(proveedores[0].cumplimiento, 'sin_obras_vivas');

    // El renglón del proveedor y el total de la pantalla cuentan LO MISMO. Con
    // el renglón sumando todas las obras, la pantalla decía "$0" arriba y
    // "$12,500 afianzado" en el único renglón de abajo.
    assert.equal(proveedores[0].monto_afianzado, metricas.monto_afianzado);
    assert.equal(proveedores[0].monto_afianzado, 0);
  } finally {
    await memoria.query(`UPDATE proyectos SET estatus = 'en_proceso' WHERE id = ?`, [OBRA_DELTA]);
  }
});

test('la cifra de la lista de clientes coincide con la del detalle', async () => {
  const cifras = async () => {
    const { clientes } = await (await pedir('/api/admin/clientes', admin)).json();
    const lista = clientes.find((c) => c.id === DELTA);
    const detalle = await (await pedir(`/api/admin/clientes/${DELTA}/detalle`, admin)).json();
    const portal = await (await pedir('/api/proveedores', delta)).json();
    return {
      lista: lista.obras_descubiertas,
      detalle: detalle.metricas.obras_descubiertas,
      portal: portal.metricas.obras_descubiertas,
    };
  };

  // Con el padrón activo las tres coinciden.
  const antes = await cifras();
  assert.equal(antes.lista, antes.detalle);
  assert.equal(antes.detalle, antes.portal);

  // Y al suspender al proveedor también. Antes no: la consulta de la lista
  // llevaba solo la mitad del alcance (le faltaba el padrón), así que prendía
  // el punto ámbar por un pendiente que el detalle decía que no existía.
  await memoria.query(
    'UPDATE client_proveedores SET activo = 0 WHERE contratante_id = ? AND proveedor_id = ?',
    [DELTA, VEGA]
  );
  try {
    const despues = await cifras();
    assert.equal(despues.lista, despues.detalle, 'la lista y el detalle no pueden discrepar');
    assert.equal(despues.detalle, despues.portal);
  } finally {
    await memoria.query(
      'UPDATE client_proveedores SET activo = 1 WHERE contratante_id = ? AND proveedor_id = ?',
      [DELTA, VEGA]
    );
  }
});

test('un padrón suspendido no se pinta como si el contratante estuviera viendo', async () => {
  await memoria.query(
    'UPDATE client_proveedores SET activo = 0 WHERE contratante_id = ? AND proveedor_id = ?',
    [DELTA, VEGA]
  );
  try {
    const d = await (await pedir(`/api/admin/clientes/${VEGA}/detalle`, admin)).json();
    // El renglón se sigue viendo —la obra quedó ligada y eso hay que saberlo—
    // pero trae el 'activo' con el que el panel lo marca como suspendido.
    assert.equal(d.contratantes.length, 1);
    assert.equal(d.contratantes[0].activo, 0);

    // Y el contratante, del otro lado, tiene su padrón vacío y a Vega en la
    // lista de suspendidos, con su botón de reactivar.
    const delDelta = await (await pedir(`/api/admin/clientes/${DELTA}/detalle`, admin)).json();
    assert.equal(delDelta.proveedores.length, 0);
    assert.deepEqual(delDelta.suspendidos.map((p) => p.id), [VEGA]);
    assert.equal(delDelta.suspendidos[0].obras_ligadas, 1);
  } finally {
    await memoria.query(
      'UPDATE client_proveedores SET activo = 1 WHERE contratante_id = ? AND proveedor_id = ?',
      [DELTA, VEGA]
    );
  }
});

test('reactivar desde el padrón conserva el alias y las notas', async () => {
  await memoria.query(
    'UPDATE client_proveedores SET notas = ? WHERE contratante_id = ? AND proveedor_id = ?',
    ['Nota del contratante', DELTA, VEGA]
  );
  await mandar('PUT', `/api/admin/clientes/${DELTA}/proveedores/${VEGA}`, operador, { activo: false });

  // Volver a agregarlo mandando solo el proveedor no puede borrar lo que el
  // contratante tenía escrito: el formulario de "ya es cliente" no dibuja el
  // campo de notas, y antes lo mandaba vacío y lo pisaba.
  const res = await mandar('POST', `/api/admin/clientes/${DELTA}/proveedores`, operador, {
    proveedor_id: VEGA,
  });
  assert.equal(res.status, 200);

  const fila = await memoria.prepare(
    'SELECT alias, notas, activo FROM client_proveedores WHERE contratante_id = ? AND proveedor_id = ?'
  ).get(DELTA, VEGA);
  assert.equal(fila.activo, 1, 'volver a agregarlo lo reactiva');
  assert.equal(fila.alias, 'Estructura');
  assert.equal(fila.notas, 'Nota del contratante');
});

test('no se vuelve contratante a quien está en el padrón de alguien', async () => {
  // Vega no tiene obras ni pólizas propias que estorben si se le quitan, pero
  // SÍ está en el padrón de Delta: volverlo contratante lo dejaría ahí para
  // siempre, porque el POST del padrón rechaza a los contratantes.
  await memoria.query('DELETE FROM fianzas WHERE client_id = ?', [VEGA]);
  await memoria.query('DELETE FROM client_credit_lines WHERE client_id = ?', [VEGA]);
  await memoria.query('DELETE FROM proyectos WHERE client_id = ?', [VEGA]);
  try {
    const res = await mandar('PUT', `/api/admin/clientes/${VEGA}/tipo`, operador, {
      tipo: 'contratante',
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /padr(ó|o)n/i);
  } finally {
    // Se deja como estaba: esta prueba va al final a propósito, pero aun así.
    await memoria.query(
      `INSERT INTO proyectos (id, client_id, contratante_id, nombre, monto_contrato, estatus)
       VALUES (?, ?, ?, 'Torre Delta', 12500000, 'en_proceso')
       ON CONFLICT (id) DO NOTHING`,
      [OBRA_DELTA, VEGA, DELTA]
    );
  }
});

test('un id de documento que no es número contesta 404, no un error de base', async () => {
  for (const malo of ['abc', '1.5', '999999999999999999999', 'null', '0', '-3']) {
    const res = await pedir(`/api/proveedores/documentos/${malo}`, delta);
    assert.equal(res.status, 404, `id "${malo}" debería dar 404`);
    // Y sin el mensaje del motor: eso se le entregaba a la cuenta de otra empresa.
    const cuerpo = await res.json();
    assert.equal(cuerpo.error, 'Documento no disponible');
    assert.equal(cuerpo.code, undefined);
  }
});
