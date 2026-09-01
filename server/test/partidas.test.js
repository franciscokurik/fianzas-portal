// Las PARTIDAS: los pedazos de obra que el desarrollador contrata por separado,
// con lo que exige cada uno.
//
// Es el nivel donde de verdad se exige la fianza, y el que le quita al portal su
// último falso OK: antes, una obra con la fianza de cumplimiento salía verde
// aunque le faltara la de anticipo, porque nadie había dicho que la exigía.
//
// Lo que se fija aquí:
//   1. que declarar requisitos convierta "tiene algo" en "le falta esto";
//   2. que una partida sin contratista se pueda DECIR (antes no existía);
//   3. que la cadena partida -> proyecto -> contratante se derive y no se pueda
//      contradecir, porque son tres columnas hablando de lo mismo;
//   4. que las partidas de un contratante no las alcance otro.
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
const { estadoDePartida } = await import('../src/services/proveedores.js');

let servidor;
let base;
let operador;
let carlos;   // vendedor, lleva a Vega
let delta;    // gente del contratante
let otro;     // gente de OTRO contratante
let vega;     // gente del proveedor

const DELTA = 1;
const VEGA = 2;
const OTRO = 3;

// Los ids del catálogo del ramo, que los llena la migración.
let tCumplimiento;
let tAnticipo;

// Se llenan conforme corren las pruebas: el orden es el del flujo real.
let torre;        // el proyecto de Delta
let torreDeOtro;  // el proyecto del OTRO contratante
let paMuros;
let paElectricidad;
let obraDeVega;

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social, tipo) VALUES
      ('Desarrollos Delta',  'contratante'),
      ('Cimentaciones Vega', 'fiado'),
      ('Otro Desarrollador', 'contratante');
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Mariana', 'mariana@fortex.mx', 'x', 'operador'),
      (NULL, 'Carlos',  'carlos@fortex.mx',  'x', 'vendedor'),
      (1,    'Control', 'delta@demo.mx',     'x', 'client'),
      (3,    'Control', 'otro@demo.mx',      'x', 'client'),
      (2,    'Dirección', 'vega@demo.mx',    'x', 'client');
    UPDATE clients SET vendedor_id = 2 WHERE id = 2;

    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta','aserta');

    INSERT INTO client_proveedores (contratante_id, proveedor_id, alias)
      VALUES (1, 2, 'Estructura');

    INSERT INTO desarrollos (contratante_id, nombre, clave)
      VALUES (1, 'Torre Delta Poniente', 'TDP-01'),
             (3, 'Plaza del Otro', 'PDO-01');
  `);

  torre = 1;
  torreDeOtro = 2;

  const tipo = async (nombre) => (await memoria.query(
    `SELECT id FROM tipos_fianza WHERE nombre = '${nombre}'`
  ))[0].id;
  tCumplimiento = await tipo('Cumplimiento');
  tAnticipo = await tipo('Anticipo');

  operador = signToken({ id: 1, role: 'operador', nombre: 'Mariana' });
  carlos = signToken({ id: 2, role: 'vendedor', nombre: 'Carlos' });
  delta = signToken({ id: 3, role: 'client', client_id: DELTA, nombre: 'Control' });
  otro = signToken({ id: 4, role: 'client', client_id: OTRO, nombre: 'Control' });
  vega = signToken({ id: 5, role: 'client', client_id: VEGA, nombre: 'Dirección' });

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

const detalle = async (token = delta) =>
  (await (await pedir(`/api/proveedores/proyectos/${torre}`, token)).json()).proyecto;

const partidaLlamada = async (nombre) =>
  (await detalle()).partidas.find((pa) => pa.nombre === nombre);

// ---------------------------------------------------------------------------
// La captura, por las dos puertas
// ---------------------------------------------------------------------------

test('el contratante arma las partidas de su proyecto', async () => {
  const res = await mandar('POST', `/api/proveedores/proyectos/${torre}/partidas`, delta, {
    nombre: 'Muros y albañilería',
    alcance: 'Muros divisorios y aplanados',
    monto_estimado: 680000000,
    orden: 15,
    requisitos: [tCumplimiento],
  });
  assert.equal(res.status, 200);
  paMuros = (await res.json()).id;

  const pa = await partidaLlamada('Muros y albañilería');
  assert.equal(pa.monto_estimado, 680000000);
  assert.deepEqual(pa.requisitos.map((r) => r.tipo_fianza), ['Cumplimiento']);
});

test('Fortex arma partidas por la misma puerta', async () => {
  // Al dar de alta la cuenta hay que armarle la obra antes de que él entre: sin
  // partidas no hay a qué asignarle los contratos.
  const res = await mandar(
    'POST', `/api/admin/clientes/${DELTA}/proyectos/${torre}/partidas`, operador,
    { nombre: 'Instalaciones eléctricas', orden: 20, requisitos: [tCumplimiento, tAnticipo] }
  );
  assert.equal(res.status, 200);
  paElectricidad = (await res.json()).id;

  // Y él la ve igual: es la misma partida, no una copia del panel.
  const pa = await partidaLlamada('Instalaciones eléctricas');
  assert.equal(pa.id, paElectricidad);
  assert.deepEqual(
    pa.requisitos.map((r) => r.tipo_fianza).sort(), ['Anticipo', 'Cumplimiento']
  );
});

test('el nombre es obligatorio', async () => {
  const res = await mandar('POST', `/api/proveedores/proyectos/${torre}/partidas`, delta, {
    nombre: '   ',
  });
  assert.equal(res.status, 400);
});

test('una partida no puede exigir un tipo de fianza inventado', async () => {
  // Si se dejara pasar, la partida quedaría eternamente incumplible: ninguna
  // póliza podría ser de un tipo que no existe.
  const res = await mandar('POST', `/api/proveedores/proyectos/${torre}/partidas`, delta, {
    nombre: 'Jardinería', requisitos: [999999],
  });
  assert.equal(res.status, 400);

  const pa = await partidaLlamada('Jardinería');
  assert.equal(pa, undefined, 'no debió quedar creada a medias');
});

test('el orden lo decide el desarrollador, no el alfabeto', async () => {
  // Cimentación antes que acabados, aunque la A vaya antes que la C.
  const pas = (await detalle()).partidas.map((pa) => pa.nombre);
  assert.deepEqual(pas, ['Muros y albañilería', 'Instalaciones eléctricas']);
});

// ---------------------------------------------------------------------------
// Sin contratista: el pendiente que antes no se podía decir
// ---------------------------------------------------------------------------

test('una partida sin contratista se DICE, y no cuenta como descubierta', async () => {
  const p = await detalle();
  const muros = p.partidas.find((pa) => pa.id === paMuros);

  assert.equal(muros.estado_cobertura, 'sin_contratista');
  assert.deepEqual(muros.contratos, []);
  // La cuenta va aparte de las descubiertas a propósito: que nadie esté
  // haciendo los muros es un pendiente del desarrollador —le falta contratar—,
  // no un proveedor que incumplió. Sumadas, el número no diría qué hacer.
  assert.equal(p.partidas_sin_contratista, 2);
  assert.equal(p.partidas_descubiertas, 0);
});

// ---------------------------------------------------------------------------
// La cadena partida -> proyecto -> contratante
// ---------------------------------------------------------------------------

test('asignarle el fiado a la partida DERIVA el proyecto y el contratante', async () => {
  // Fortex manda SOLO la partida. Las otras dos columnas salen de ella: es la
  // única forma de que tres columnas que hablan de lo mismo no discrepen.
  const res = await mandar('POST', '/api/admin/proyectos', operador, {
    client_id: VEGA, nombre: 'Muros – Vega', monto_contrato: 500000000,
    partida_id: paMuros,
  });
  assert.equal(res.status, 200);
  obraDeVega = (await res.json()).id;

  const fila = (await memoria.query(
    `SELECT partida_id, desarrollo_id, contratante_id FROM proyectos WHERE id = ${obraDeVega}`
  ))[0];
  assert.equal(fila.partida_id, paMuros);
  assert.equal(fila.desarrollo_id, torre);
  assert.equal(fila.contratante_id, DELTA);
});

test('un body que contradice a la partida se RECHAZA, no se deriva en silencio', async () => {
  // Derivando, una petición que pedía una cosa guardaba otra y contestaba 200:
  // el operador leía "listo" con la obra en el proyecto equivocado.
  const conProyectoAjeno = await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', partida_id: paMuros, desarrollo_id: torreDeOtro,
  });
  assert.equal(conProyectoAjeno.status, 400);

  const conContratanteAjeno = await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', partida_id: paMuros, contratante_id: OTRO,
  });
  assert.equal(conContratanteAjeno.status, 400);

  const fila = (await memoria.query(
    `SELECT desarrollo_id, contratante_id FROM proyectos WHERE id = ${obraDeVega}`
  ))[0];
  assert.equal(fila.desarrollo_id, torre, 'no debió moverse');
  assert.equal(fila.contratante_id, DELTA);
});

test('una partida inventada se rechaza', async () => {
  const res = await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', partida_id: 999999,
  });
  assert.equal(res.status, 400);
});

test('la partida de OTRO contratante no se le puede asignar a esta obra', async () => {
  const ajena = await mandar(
    'POST', `/api/admin/clientes/${OTRO}/proyectos/${torreDeOtro}/partidas`, operador,
    { nombre: 'Muros del otro', requisitos: [tCumplimiento] }
  );
  const paAjena = (await ajena.json()).id;

  // Se puede asignar —Fortex alcanza a los dos contratantes— pero entonces la
  // obra se MUEVE completa: el contratante también cambia, porque sale de la
  // partida. Lo que no puede pasar es que quede con la partida de uno y el
  // permiso del otro.
  const res = await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', partida_id: paAjena,
  });
  assert.equal(res.status, 200);

  const fila = (await memoria.query(
    `SELECT partida_id, desarrollo_id, contratante_id FROM proyectos WHERE id = ${obraDeVega}`
  ))[0];
  assert.equal(fila.partida_id, paAjena);
  assert.equal(fila.desarrollo_id, torreDeOtro);
  assert.equal(fila.contratante_id, OTRO, 'la obra tenía que salir del alcance de Delta');

  // Y de vuelta, que es lo que el operador haría al darse cuenta.
  await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', partida_id: paMuros,
  });
});

test('cambiar de proyecto desasigna la partida, que era del anterior', async () => {
  const res = await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', desarrollo_id: torreDeOtro,
  });
  assert.equal(res.status, 200);

  const fila = (await memoria.query(
    `SELECT partida_id, contratante_id FROM proyectos WHERE id = ${obraDeVega}`
  ))[0];
  assert.equal(fila.partida_id, null, 'la partida era de la torre de Delta');
  assert.equal(fila.contratante_id, OTRO);

  await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', partida_id: paMuros,
  });
});

test('desligar del contratante también desasigna la partida', async () => {
  const res = await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', contratante_id: '',
  });
  assert.equal(res.status, 200);

  const fila = (await memoria.query(
    `SELECT partida_id, desarrollo_id, contratante_id FROM proyectos WHERE id = ${obraDeVega}`
  ))[0];
  assert.equal(fila.contratante_id, null);
  assert.equal(fila.desarrollo_id, null);
  assert.equal(fila.partida_id, null, 'la partida colgaba del proyecto, que colgaba del contratante');

  await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', partida_id: paMuros,
  });
});

// ---------------------------------------------------------------------------
// Los requisitos: el falso OK que esto vino a quitar
// ---------------------------------------------------------------------------

test('con la fianza que la partida exige, queda cubierta', async () => {
  await memoria.query(
    `INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                          tipo_fianza_id, monto_afianzado, fecha_vigencia)
     VALUES (${VEGA}, ${obraDeVega}, 1, 'ASE-CUMP', ${tCumplimiento}, 400000000, '2099-01-01')`
  );

  const muros = await partidaLlamada('Muros y albañilería');
  assert.equal(muros.estado_cobertura, 'cubierta');
  assert.deepEqual(muros.faltantes, []);
  assert.equal(muros.contratos.length, 1);
  assert.equal(muros.contratos[0].proveedor_nombre, 'Cimentaciones Vega');
});

test('si la partida exige DOS y solo hay una, sale INCOMPLETA y dice cuál falta', async () => {
  // Esto es el falso OK: antes, la obra con la de cumplimiento salía verde
  // aunque le faltara la de anticipo, porque nadie había dicho que la exigía.
  const res = await mandar('PUT', `/api/proveedores/partidas/${paMuros}`, delta, {
    nombre: 'Muros y albañilería',
    requisitos: [tCumplimiento, tAnticipo],
  });
  assert.equal(res.status, 200);

  const muros = await partidaLlamada('Muros y albañilería');
  assert.equal(muros.estado_cobertura, 'incompleta');
  assert.deepEqual(muros.faltantes.map((f) => f.tipo_fianza), ['Anticipo']);

  const p = await detalle();
  assert.equal(p.partidas_descubiertas, 1);
  // Y el proyecto entero lo refleja: no puede decir "cubierta" con un pedazo a
  // medias.
  assert.equal(p.cumplimiento, 'incompleta');
});

test('editar sin mandar requisitos NO los borra', async () => {
  // Es un conjunto, no un historial: mandarlos lo reemplaza. Pero no mandarlos
  // significa "no los toques" — si no, cambiarle el nombre a una partida la
  // dejaría sin exigir nada y de vuelta en verde.
  const res = await mandar('PUT', `/api/proveedores/partidas/${paMuros}`, delta, {
    nombre: 'Muros, aplanados y albañilería',
  });
  assert.equal(res.status, 200);

  const muros = await partidaLlamada('Muros, aplanados y albañilería');
  assert.equal(muros.requisitos.length, 2);
  assert.equal(muros.estado_cobertura, 'incompleta');
});

test('mandar requisitos vacíos SÍ los borra: es lo que se pidió', async () => {
  await mandar('PUT', `/api/proveedores/partidas/${paMuros}`, delta, {
    nombre: 'Muros, aplanados y albañilería', requisitos: [],
  });

  const muros = await partidaLlamada('Muros, aplanados y albañilería');
  assert.deepEqual(muros.requisitos, []);
  // Sin requisitos vuelve a lo único que se puede afirmar: que hay fianza
  // vigente. El front lo dice "Con fianza" y no "Cubierta" por esto mismo.
  assert.equal(muros.estado_cobertura, 'cubierta');

  await mandar('PUT', `/api/proveedores/partidas/${paMuros}`, delta, {
    nombre: 'Muros, aplanados y albañilería', requisitos: [tCumplimiento, tAnticipo],
  });
});

// ---------------------------------------------------------------------------
// El cálculo, directo: los casos que por HTTP costarían mucho montar
// ---------------------------------------------------------------------------

test('estadoDePartida distingue los seis casos', () => {
  const req = [{ tipo_fianza_id: 1, tipo_fianza: 'Cumplimiento' },
               { tipo_fianza_id: 2, tipo_fianza: 'Anticipo' }];
  const obra = [{ id: 1 }];
  const poliza = (tipo, estado, clase = 'emitida') =>
    ({ tipo_fianza_id: tipo, estado, clase });

  assert.equal(estadoDePartida(req, [], []).estado, 'sin_contratista');
  assert.equal(estadoDePartida(req, obra, []).estado, 'sin_fianza');
  assert.equal(
    estadoDePartida(req, obra, [poliza(1, 'activa'), poliza(2, 'activa')]).estado,
    'cubierta'
  );
  assert.equal(
    estadoDePartida(req, obra, [poliza(1, 'activa')]).estado, 'incompleta'
  );
  assert.equal(
    estadoDePartida(req, obra, [poliza(1, 'vencida'), poliza(2, 'vencida')]).estado, 'vencida'
  );
  // Sin fecha de vigencia capturada NO es cobertura: es lo mismo que se arregló
  // en las obras. Verde por una fecha que nadie puso es la peor mentira posible.
  assert.equal(
    estadoDePartida(req, obra, [poliza(1, 'sin_vigencia')]).estado, 'sin_vigencia'
  );
  // Un PREVIO no es fianza: la afianzadora no ha emitido nada.
  assert.equal(
    estadoDePartida(req, obra, [poliza(1, 'activa', 'previo')]).estado, 'sin_fianza'
  );
  // Por vencer sigue cubriendo hoy, pero se avisa.
  assert.equal(
    estadoDePartida(req, obra, [poliza(1, 'por_vencer'), poliza(2, 'activa')]).estado,
    'por_vencer'
  );
});

test('sin requisitos capturados, tener fianza basta para no estar descubierta', () => {
  // Es honesto: el portal no puede exigir lo que nadie declaró. Lo que NO hace
  // es llamarle "cubierta" en la pantalla.
  const r = estadoDePartida([], [{ id: 1 }], [{ tipo_fianza_id: 9, estado: 'activa', clase: 'emitida' }]);
  assert.equal(r.estado, 'cubierta');
  assert.deepEqual(r.faltantes, []);
});

// ---------------------------------------------------------------------------
// Que el nivel nuevo no haya abierto una fuga
// ---------------------------------------------------------------------------

test('el payload con partidas adentro no trae nada prohibido', async () => {
  // El barrido de proyectos-contratante.test.js es recursivo, pero ahí el
  // fixture no tiene partidas y nunca entra a una. Aquí sí: la partida trae sus
  // contratos y cada contrato sus pólizas, que es donde vive lo que el
  // contratante no puede ver.
  const lista = await (await pedir('/api/proveedores/proyectos', delta)).json();
  const uno = await (await pedir(`/api/proveedores/proyectos/${torre}`, delta)).json();
  const padron = await (await pedir('/api/proveedores', delta)).json();

  // Primero, que de verdad haya una póliza dentro de una partida: si no, el
  // barrido pasaría por vacío y no probaría nada.
  const conPoliza = uno.proyecto.partidas.some(
    (pa) => pa.contratos.some((o) => (o.fianzas || []).length > 0)
  );
  assert.equal(conPoliza, true, 'el barrido tiene que recorrer al menos una póliza');

  const PROHIBIDAS = ['linea_credito', 'disponible', 'comprometido_total',
                      'prima_neta', 'prima_total', 'fecha_recordatorio', 'url'];
  const halladas = new Set();
  (function barrer(v) {
    if (Array.isArray(v)) return v.forEach((x) => barrer(x));
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (PROHIBIDAS.includes(k)) halladas.add(k);
        barrer(v[k]);
      }
    }
  }({ lista, uno, padron }));
  assert.deepEqual([...halladas], []);
});

// ---------------------------------------------------------------------------
// Quién alcanza qué
// ---------------------------------------------------------------------------

test('otro contratante no ve ni toca las partidas de Delta', async () => {
  const leer = await pedir(`/api/proveedores/proyectos/${torre}`, otro);
  assert.equal(leer.status, 404);

  const editar = await mandar('PUT', `/api/proveedores/partidas/${paMuros}`, otro, {
    nombre: 'Mías ahora',
  });
  assert.equal(editar.status, 404);

  const borrar = await mandar('DELETE', `/api/proveedores/partidas/${paMuros}`, otro);
  assert.equal(borrar.status, 404);

  const crear = await mandar('POST', `/api/proveedores/proyectos/${torre}/partidas`, otro, {
    nombre: 'Colada',
  });
  assert.equal(crear.status, 404);

  const sigue = await partidaLlamada('Muros, aplanados y albañilería');
  assert.ok(sigue, 'la partida de Delta no debió cambiar de nombre');
});

test('el proveedor no entra a las partidas: no son suyas', async () => {
  // Vega hace los muros, pero la partida es el plan de Delta.
  const res = await mandar('PUT', `/api/proveedores/partidas/${paMuros}`, vega, { nombre: 'X' });
  assert.equal(res.status, 403);
});

test('por el path de otro cliente tampoco', async () => {
  // El id de la partida por sí solo no basta: se comprueba contra el cliente del
  // path, o con el id de una partida ajena se editaría la de otro.
  const res = await mandar('PUT', `/api/admin/clientes/${OTRO}/partidas/${paMuros}`, operador, {
    nombre: 'Mías ahora',
  });
  assert.equal(res.status, 404);
});

test('el vendedor no arma partidas de un contratante que no lleva', async () => {
  const res = await mandar(
    'POST', `/api/admin/clientes/${DELTA}/proyectos/${torre}/partidas`, carlos,
    { nombre: 'Colada' }
  );
  assert.equal(res.status, 403);
});

// ---------------------------------------------------------------------------
// Borrar
// ---------------------------------------------------------------------------

test('no se borra una partida con contratos adentro', async () => {
  const res = await mandar('DELETE', `/api/proveedores/partidas/${paMuros}`, delta);
  assert.equal(res.status, 400);

  const sigue = await partidaLlamada('Muros, aplanados y albañilería');
  assert.ok(sigue);
});

test('borrar una partida vacía no toca nada más', async () => {
  const res = await mandar('DELETE', `/api/proveedores/partidas/${paElectricidad}`, delta);
  assert.equal(res.status, 200);

  const p = await detalle();
  assert.equal(p.partidas.length, 1);
  // Y sus requisitos se van con ella: son suyos, no del catálogo.
  const quedan = await memoria.query(
    `SELECT COUNT(*)::int AS n FROM partida_requisitos WHERE partida_id = ${paElectricidad}`
  );
  assert.equal(quedan[0].n, 0);
});

test('borrar el proyecto se lleva sus partidas, no las obras', async () => {
  // Se saca la obra primero, que es lo que el portal exige para poder borrarlo.
  await mandar('PUT', `/api/admin/proyectos/${obraDeVega}`, operador, {
    nombre: 'Muros – Vega', contratante_id: '',
  });

  const res = await mandar('DELETE', `/api/proveedores/proyectos/${torre}`, delta);
  assert.equal(res.status, 200);

  const partidas = await memoria.query(
    `SELECT COUNT(*)::int AS n FROM partidas WHERE desarrollo_id = ${torre}`
  );
  assert.equal(partidas[0].n, 0, 'las partidas colgaban del proyecto');

  const obra = await memoria.query(`SELECT id FROM proyectos WHERE id = ${obraDeVega}`);
  assert.equal(obra.length, 1, 'la obra del proveedor es suya y no se borra');
});

// ---------------------------------------------------------------------------
// Un contrato cancelado no dicta el veredicto
// ---------------------------------------------------------------------------

test('una partida cuyo contrato se canceló no sale en rojo', async () => {
  // La misma regla que en la obra: a un contrato cancelado no hay cobertura que
  // exigirle. Antes contaba como partida descubierta y pintaba el proyecto de
  // rojo por algo que ya no existe.
  const proyecto = (await mandar('POST', '/api/proveedores/proyectos', delta, {
    nombre: 'Torre de repuesto',
  }));
  const nuevoProyecto = (await proyecto.json()).id;

  const pa = (await (await mandar(
    'POST', `/api/proveedores/proyectos/${nuevoProyecto}/partidas`, delta,
    { nombre: 'Demolición', requisitos: [tCumplimiento] }
  )).json()).id;

  const obra = (await (await mandar('POST', '/api/admin/proyectos', operador, {
    client_id: VEGA, nombre: 'Demolición – Vega', monto_contrato: 100000000,
    partida_id: pa, estatus: 'cancelado',
  })).json()).id;

  const p = (await (await pedir(`/api/proveedores/proyectos/${nuevoProyecto}`, delta)).json()).proyecto;
  const demolicion = p.partidas.find((x) => x.id === pa);

  assert.equal(demolicion.estado_cobertura, 'sin_contratista');
  assert.equal(p.partidas_descubiertas, 0, 'un contrato cancelado no la deja descubierta');
  // Pero el contrato SÍ se sigue listando: esconderlo sería peor que mostrarlo.
  assert.equal(demolicion.contratos.length, 1);
  assert.equal(demolicion.total_contratos, 0, 'no cuenta como contrato vigente');
  // Y el monto tampoco lo suma: junto al afianzado, que solo cuenta vigentes,
  // el porcentaje que uno saca de cabeza saldría falso.
  assert.equal(demolicion.monto_contratado, 0);

  // Se limpia: la obra es de Vega y el proyecto de Delta.
  await mandar('PUT', `/api/admin/proyectos/${obra}`, operador, {
    nombre: 'Demolición – Vega', contratante_id: '',
  });
  await mandar('DELETE', `/api/proveedores/proyectos/${nuevoProyecto}`, delta);
});
