// Las comisiones: lo que gana Fortex por cada póliza.
//
// Lo que se fija aquí es sobre todo QUIÉN las ve, porque es dinero de la casa
// y de cada vendedor:
//   1. el operador no ve nada, aunque opere todas las cuentas;
//   2. cada vendedor ve SOLO las suyas, y no puede tocarlas;
//   3. "las suyas" son las que se le guardaron al capturar, no las del titular
//      de hoy: reasignar una cuenta no le pasa lo ya ganado al nuevo;
//   4. la carga masiva valida todo en el servidor, enseña antes de guardar,
//      guarda todo o nada, y subir dos veces el mismo archivo no duplica;
//   5. la lista es por PÓLIZA: las que no tienen comisión salen para asignarla.
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
const { todayISO } = await import('../src/lib/dates.js');
const { fechaISO } = await import('../src/services/comisiones.js');

let servidor;
let base;
let admin;
let operador;
let ana;      // vendedora, titular de UNO
let beto;     // vendedor, titular de DOS
let cliente;  // gente de UNO, en su portal

const UNO = 1;
const DOS = 2;
const SIN_VENDEDOR = 3;
const ANA = 3;
const BETO = 4;

// Las pólizas, por número para leer las pruebas.
const ASE_001 = 1;     // de UNO (Ana), Aserta
const ASE_002 = 2;     // de DOS (Beto), Aserta
const TKM_CERO = 3;    // de UNO, Tokio Marine, '0301121': el cero que Excel se come
const PREVIO = 4;      // de UNO, Aserta, todavía no se emite
const TKM_555 = 5;     // de SIN_VENDEDOR, Tokio Marine

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Admin',    'admin@fortex.mx',    'x', 'admin'),
      (NULL, 'Mariana',  'mariana@fortex.mx',  'x', 'operador'),
      (NULL, 'Ana',      'ana@fortex.mx',      'x', 'vendedor'),
      (NULL, 'Beto',     'beto@fortex.mx',     'x', 'vendedor');
    INSERT INTO clients (razon_social, vendedor_id) VALUES
      ('Constructora Uno', 3),
      ('Constructora Dos', 4),
      ('Sin Vendedor SA', NULL);
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (1, 'Dirección', 'uno@demo.mx', 'x', 'client');

    INSERT INTO afianzadoras (nombre, slug) VALUES
      ('Aserta', 'aserta'), ('Tokio Marine', 'tokio-marine');

    INSERT INTO proyectos (client_id, nombre) VALUES
      (1, 'Obra Uno'), (2, 'Obra Dos'), (3, 'Obra Tres');

    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza, clase,
                         prima_neta, monto_afianzado, fecha_vigencia) VALUES
      (1, 1, 1, 'ASE-001', 'fianza', 1000000, 50000000, '2099-01-01'),
      (2, 2, 1, 'ASE-002', 'fianza', 1000000, 50000000, '2099-01-01'),
      (1, 1, 2, '0301121', 'fianza', 1000000, 50000000, '2099-01-01'),
      (1, 1, 1, 'PREV-01', 'previo', 1000000, 50000000, '2099-01-01'),
      (3, 3, 2, 'TKM-555', 'fianza', 1000000, 50000000, '2099-01-01'),
      -- El mismo número con la misma afianzadora en dos clientes: ambigua.
      (1, 1, 1, 'DUP-1',   'fianza', 1000000, 50000000, '2099-01-01'),
      (2, 2, 1, 'DUP-1',   'fianza', 1000000, 50000000, '2099-01-01');
  `);

  admin = signToken({ id: 1, role: 'admin', nombre: 'Admin' });
  operador = signToken({ id: 2, role: 'operador', nombre: 'Mariana' });
  ana = signToken({ id: ANA, role: 'vendedor', nombre: 'Ana' });
  beto = signToken({ id: BETO, role: 'vendedor', nombre: 'Beto' });
  cliente = signToken({ id: 5, role: 'client', client_id: UNO, nombre: 'Dirección' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const pedir = (ruta, token) =>
  fetch(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });

const mandar = (metodo, ruta, token, cuerpo) =>
  fetch(`${base}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });

const lista = async (token, query = '') =>
  (await (await pedir(`/api/comisiones${query}`, token)).json()).comisiones;

// La comisión de Ana sobre ASE-001, que es la que las pruebas corrigen. Se
// busca por póliza y no "la primera": la lista va de la más reciente a la más
// vieja, y la carga masiva le agrega otra.
const laDeAna = async () => (await lista(ana)).find((c) => c.numero_poliza === 'ASE-001');

const cuantasHay = async () =>
  (await memoria.query('SELECT COUNT(*)::int AS c FROM comisiones'))[0].c;

const capturar = (fianzaId, extra = {}) => mandar('POST', '/api/comisiones', admin, {
  fianza_id: fianzaId, fecha_pago: '2026-03-15', comision_neta: 150000, ...extra,
});

// ---------------------------------------------------------------------------
// Quién entra
// ---------------------------------------------------------------------------

test('el operador no ve comisiones: ni la lista, ni el resumen, ni la base', async () => {
  for (const ruta of ['/api/comisiones', '/api/comisiones/resumen', '/api/comisiones/tablero', '/api/comisiones/base']) {
    assert.equal((await pedir(ruta, operador)).status, 403, ruta);
  }
  assert.equal((await mandar('POST', '/api/comisiones', operador, {
    fianza_id: ASE_001, fecha_pago: '2026-03-15', comision_neta: 100,
  })).status, 403);
});

test('un usuario del portal del cliente no entra', async () => {
  assert.equal((await pedir('/api/comisiones', cliente)).status, 403);
  assert.equal((await pedir('/api/comisiones/resumen', cliente)).status, 403);
  assert.equal((await pedir('/api/comisiones/tablero', cliente)).status, 403);
});

test('el admin captura y se le guarda el vendedor titular de ese momento', async () => {
  const r = await capturar(ASE_001);
  assert.equal(r.status, 201);
  const [c] = await lista(admin);
  assert.equal(c.numero_poliza, 'ASE-001');
  assert.equal(c.vendedor_id, ANA);
  assert.equal(c.comision_neta, 150000);
  assert.equal(c.fecha_conciliacion, null);
});

test('cada vendedor ve SOLO las suyas, y no puede ampliar el filtro', async () => {
  assert.equal((await capturar(ASE_002, { comision_neta: 99900 })).status, 201);

  const deAna = await lista(ana);
  assert.deepEqual(deAna.map((c) => c.numero_poliza), ['ASE-001']);
  const deBeto = await lista(beto);
  assert.deepEqual(deBeto.map((c) => c.numero_poliza), ['ASE-002']);

  // Pedir las de otro con el filtro no sirve: al vendedor se le ignora.
  const tanteo = await lista(ana, `?vendedor_id=${BETO}`);
  assert.deepEqual(tanteo.map((c) => c.numero_poliza), ['ASE-001']);
});

test('el vendedor no puede capturar, corregir, borrar ni usar la carga masiva', async () => {
  const [suya] = await lista(ana);
  assert.equal((await mandar('POST', '/api/comisiones', ana, {
    fianza_id: ASE_001, fecha_pago: '2026-03-15', comision_neta: 100,
  })).status, 403);
  assert.equal((await mandar('PUT', `/api/comisiones/${suya.id}`, ana, {
    fecha_pago: '2026-03-15', comision_neta: 1,
  })).status, 403);
  assert.equal((await mandar('DELETE', `/api/comisiones/${suya.id}`, ana)).status, 403);
  assert.equal((await pedir('/api/comisiones/base', ana)).status, 403);
  assert.equal((await pedir('/api/comisiones/polizas?q=ASE', ana)).status, 403);
  assert.equal((await mandar('POST', '/api/comisiones/importar', ana, { filas: [] })).status, 403);
});

test('si cambia el titular, lo ya ganado se queda con el anterior', async () => {
  await memoria.query('UPDATE clients SET vendedor_id = ? WHERE id = ?', [BETO, UNO]);
  try {
    assert.equal((await capturar(ASE_001, { fecha_pago: '2026-04-01', comision_neta: 7000 })).status, 201);
    // La de marzo sigue siendo de Ana; la nueva ya es de Beto.
    assert.deepEqual((await lista(ana)).map((c) => c.comision_neta), [150000]);
    const deBeto = (await lista(beto)).map((c) => c.comision_neta).sort((a, b) => a - b);
    assert.deepEqual(deBeto, [7000, 99900]);
  } finally {
    await memoria.query('UPDATE clients SET vendedor_id = ? WHERE id = ?', [ANA, UNO]);
  }
});

// ---------------------------------------------------------------------------
// Validación de la captura individual
// ---------------------------------------------------------------------------

test('un previo no genera comisión', async () => {
  const r = await capturar(PREVIO);
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /previo/);
});

test('con fecha imposible o en cero no pasa', async () => {
  assert.equal((await capturar(ASE_001, { fecha_pago: '2026-02-31' })).status, 400);
  assert.equal((await capturar(ASE_001, { comision_neta: 0 })).status, 400);
  assert.equal((await capturar(ASE_001, { fecha_conciliacion: 'ayer' })).status, 400);
});

// Al conciliar no siempre se sabe cuándo pagó el cliente: pedirla obligaba a
// inventar una fecha.
test('la fecha de pago del cliente es opcional', async () => {
  const r = await capturar(TKM_555, { fecha_pago: '', fecha_conciliacion: '2026-03-20' });
  assert.equal(r.status, 201);
  const { id } = await r.json();
  const [guardada] = await memoria.query('SELECT fecha_pago FROM comisiones WHERE id = ?', [id]);
  assert.equal(guardada.fecha_pago, null);
  // Se borra para no mover las cuentas de las pruebas de abajo.
  assert.equal((await mandar('DELETE', `/api/comisiones/${id}`, admin)).status, 200);
});

// ---------------------------------------------------------------------------
// La lista por póliza
// ---------------------------------------------------------------------------

const tablero = async (token, query = '') =>
  (await (await pedir(`/api/comisiones/tablero${query}`, token)).json()).polizas;

test('la lista trae también las pólizas sin comisión, para asignarla', async () => {
  const todas = await tablero(admin);
  const de = (n) => todas.filter((p) => p.numero_poliza === n);

  // ASE-001 tiene dos comisiones: dos renglones. TKM-555 no tiene: uno vacío.
  assert.equal(de('ASE-001').length, 2);
  assert.equal(de('TKM-555').length, 1);
  assert.equal(de('TKM-555')[0].comision_id, null);
  assert.equal(de('TKM-555')[0].afianzadora_nombre, 'Tokio Marine');
  assert.equal(de('PREV-01').length, 0, 'los previos no van');

  // Lo pendiente incluye lo que no tiene comisión; lo conciliado, no.
  const pendientes = await tablero(admin, '?estado=por_conciliar');
  assert.ok(pendientes.some((p) => p.numero_poliza === 'TKM-555'));
  assert.deepEqual(await tablero(admin, '?estado=conciliada'), []);

  // El periodo es de conciliación: no esconde lo que todavía no la tiene.
  const conPeriodo = await tablero(admin, '?desde=2099-01-01');
  assert.equal(conPeriodo.length, todas.length);
});

test('en la lista, el vendedor ve lo suyo: lo que se le guardó y su cartera sin asignar', async () => {
  const deAna = (await tablero(ana)).map((p) => `${p.numero_poliza}:${p.comision_neta}`).sort();
  // La de 7,000 de ASE-001 se le guardó a Beto aunque UNO sea de Ana.
  assert.deepEqual(deAna, ['0301121:null', 'ASE-001:150000', 'DUP-1:null']);

  const deBeto = (await tablero(beto)).map((p) => `${p.numero_poliza}:${p.comision_neta}`).sort();
  assert.deepEqual(deBeto, ['ASE-001:7000', 'ASE-002:99900', 'DUP-1:null']);

  // Y el filtro de vendedor no le sirve para ver lo de otro.
  const tanteo = await tablero(ana, `?vendedor_id=${BETO}`);
  assert.equal(tanteo.length, deAna.length);
});

test('las fechas del Excel se leen con el día primero y en número de serie', () => {
  assert.equal(fechaISO('03/04/2026'), '2026-04-03');
  assert.equal(fechaISO('2026-04-03'), '2026-04-03');
  assert.equal(fechaISO(46115), '2026-04-03');
  assert.equal(fechaISO('31/02/2026'), undefined);
  assert.equal(fechaISO(''), null);
});

// ---------------------------------------------------------------------------
// Carga masiva
// ---------------------------------------------------------------------------

test('la base trae un renglón por comisión y uno vacío por póliza sin comisión', async () => {
  const { filas } = await (await pedir('/api/comisiones/base', admin)).json();
  const de = (n) => filas.filter((f) => f.numero_poliza === n);

  assert.equal(de('ASE-001').length, 2, 'dos comisiones, dos renglones');
  assert.ok(de('ASE-001').every((f) => f.comision_id));
  assert.equal(de('TKM-555').length, 1);
  assert.equal(de('TKM-555')[0].comision_id, null, 'sin comisión: un renglón vacío para llenar');
  assert.equal(de('PREV-01').length, 0, 'los previos no van');
});

const NUEVA_TKM = {
  fila: 2, numero_poliza: 'TKM-555', afianzadora: 'TOKIO MARINE',
  fecha_pago: '15/04/2026', fecha_conciliacion: '', comision_neta: '$1,234.50',
};
// Excel ya se comió el cero de '0301121'.
const NUEVA_SIN_CERO = {
  fila: 3, numero_poliza: '301121', afianzadora: 'Tokio Marine',
  fecha_pago: 46115, fecha_conciliacion: '2026-05-02', comision_neta: 500,
};

test('la vista previa dice qué pasaría con cada renglón, y no guarda nada', async () => {
  const deAna = await laDeAna();
  const antes = await cuantasHay();

  const r = await mandar('POST', '/api/comisiones/importar', admin, {
    aplicar: false,
    filas: [
      NUEVA_TKM,
      NUEVA_SIN_CERO,
      { fila: 4, id: deAna.id, numero_poliza: 'ASE-001', afianzadora: 'Aserta',
        fecha_pago: deAna.fecha_pago, fecha_conciliacion: '20/03/2026', comision_neta: 1500 },
      { fila: 5, numero_poliza: 'ASE-002', afianzadora: 'Aserta SA',
        fecha_pago: '2026-04-01', comision_neta: 1 },
      { fila: 6, numero_poliza: 'DUP-1', afianzadora: 'Aserta',
        fecha_pago: '2026-04-01', comision_neta: 1 },
      { fila: 7, numero_poliza: 'PREV-01', afianzadora: 'Aserta',
        fecha_pago: '2026-04-01', comision_neta: 1 },
      { fila: 8, numero_poliza: 'ASE-002', afianzadora: 'Aserta' },
    ],
  });
  assert.equal(r.status, 200);
  const a = await r.json();

  assert.equal(a.aplicado, false);
  assert.deepEqual(a.nuevas.map((n) => [n.fila, n.fianza_id]), [[2, TKM_555], [3, TKM_CERO]]);
  assert.equal(a.nuevas[0].comision_neta, 123450);
  assert.equal(a.nuevas[0].fecha_pago, '2026-04-15');
  assert.equal(a.nuevas[1].fecha_pago, '2026-04-03');
  assert.deepEqual(a.corregidas.map((c) => c.fila), [4]);
  assert.equal(a.vacias, 1);
  assert.deepEqual(a.errores.map((e) => e.fila), [5, 6, 7]);
  assert.match(a.errores[0].motivo, /afianzadora/);
  assert.match(a.errores[1].motivo, /no se sabe a cuál/);
  assert.match(a.errores[2].motivo, /previo/);

  assert.equal(await cuantasHay(), antes, 'la vista previa no guarda');
});

test('con un solo renglón con error no se guarda NADA', async () => {
  const antes = await cuantasHay();
  const r = await mandar('POST', '/api/comisiones/importar', admin, {
    aplicar: true,
    filas: [NUEVA_TKM, { fila: 9, numero_poliza: 'NO-EXISTE', afianzadora: 'Aserta',
      fecha_pago: '2026-04-01', comision_neta: 1 }],
  });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).errores.length, 1);
  assert.equal(await cuantasHay(), antes);
});

test('aplicar guarda nuevas y corregidas, y subirlo otra vez no duplica', async () => {
  const deAna = await laDeAna();
  const correccion = {
    fila: 4, id: deAna.id, numero_poliza: 'ASE-001', afianzadora: 'aserta',
    fecha_pago: deAna.fecha_pago, fecha_conciliacion: '20/03/2026', comision_neta: '1,500.00',
  };
  const filas = [NUEVA_TKM, NUEVA_SIN_CERO, correccion];
  const antes = await cuantasHay();

  const r = await (await mandar('POST', '/api/comisiones/importar', admin, { aplicar: true, filas })).json();
  assert.equal(r.aplicado, true);
  assert.equal(r.nuevas.length, 2);
  assert.equal(r.corregidas.length, 1);
  assert.equal(await cuantasHay(), antes + 2);

  // Ana ya tiene dos: la corregida y la nueva de 0301121, que es de su cliente.
  const deAnaAhora = await lista(ana);
  const corregida = deAnaAhora.find((c) => c.id === deAna.id);
  assert.equal(corregida.comision_neta, 150000);
  assert.equal(corregida.fecha_conciliacion, '2026-03-20');
  assert.ok(deAnaAhora.some((c) => c.fianza_id === TKM_CERO), 'la del cero va con su titular');

  // La de un cliente sin vendedor queda sin vendedor: solo la ve el admin.
  const tkm = (await lista(admin)).find((c) => c.numero_poliza === 'TKM-555');
  assert.equal(tkm.vendedor_id, null);
  assert.equal(tkm.origen, 'masiva');

  // El mismo archivo otra vez: nada nuevo.
  const otra = await (await mandar('POST', '/api/comisiones/importar', admin, { aplicar: true, filas })).json();
  assert.equal(otra.nuevas.length, 0);
  assert.equal(otra.repetidas.length, 2);
  assert.equal(otra.sin_cambios, 1);
  assert.equal(await cuantasHay(), antes + 2);
});

test('un ID que no es de esa póliza se rechaza, no se mueve en silencio', async () => {
  const deAna = await laDeAna();
  const r = await (await mandar('POST', '/api/comisiones/importar', admin, {
    aplicar: false,
    filas: [{ fila: 2, id: deAna.id, numero_poliza: 'ASE-002', afianzadora: 'Aserta',
      fecha_pago: '2026-03-15', comision_neta: 1 }],
  })).json();
  assert.match(r.errores[0].motivo, /es de otra póliza/);
});

// ---------------------------------------------------------------------------
// El resumen, y que no se escapen por otro lado
// ---------------------------------------------------------------------------

// El mes cuenta por FECHA DE CONCILIACIÓN: es la que se captura siempre. Una
// comisión pagada hoy pero sin conciliar todavía no entra en el mes.
test('el resumen cuenta el mes por fecha de conciliación y respeta al vendedor', async () => {
  const hoy = todayISO();
  const antes = await (await pedir('/api/comisiones/resumen', beto)).json();
  assert.equal((await capturar(ASE_002, { fecha_pago: '', fecha_conciliacion: hoy, comision_neta: 25000 })).status, 201);
  assert.equal((await capturar(ASE_002, { fecha_pago: hoy, comision_neta: 3000 })).status, 201);

  const deAdmin = await (await pedir('/api/comisiones/resumen', admin)).json();
  assert.equal(deAdmin.mes.periodo, hoy.slice(0, 7));
  assert.ok(deAdmin.mes.total >= 25000);

  const deAna = await (await pedir('/api/comisiones/resumen', ana)).json();
  assert.equal(deAna.mes.total, 0, 'la de este mes es de Beto');
  const deBeto = await (await pedir('/api/comisiones/resumen', beto)).json();
  assert.equal(deBeto.mes.total - antes.mes.total, 25000, 'la de 3,000 no está conciliada');
  assert.equal(deBeto.por_conciliar.total - antes.por_conciliar.total, 3000);

  // ASE-001 y 0301121 ya tienen; DUP-1 de UNO no.
  assert.equal(deAna.polizas_sin_comision, 1);
  // Lo pendiente de Ana: DUP-1 sin comisión más lo suyo sin conciliar.
  const pendientesDeAna = await tablero(ana, '?estado=por_conciliar');
  assert.equal(deAna.por_conciliar.cuantas, pendientesDeAna.length);
});

test('las comisiones no viajan en el detalle del cliente', async () => {
  for (const token of [admin, operador, ana]) {
    const r = await pedir(`/api/admin/clientes/${UNO}/detalle`, token);
    assert.equal(r.status, 200);
    assert.ok(!/comisi/i.test(await r.text()), 'el detalle no habla de comisiones');
  }
});

test('el operador no borra una póliza con comisiones; el admin sí, y se van con ella', async () => {
  const r = await mandar('DELETE', `/api/admin/fianzas/${TKM_555}`, operador);
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /comisiones/);

  assert.equal((await mandar('DELETE', `/api/admin/fianzas/${TKM_555}`, admin)).status, 200);
  const quedan = await memoria.query(
    'SELECT COUNT(*)::int AS c FROM comisiones WHERE fianza_id = ?', [TKM_555]
  );
  assert.equal(quedan[0].c, 0);
});
