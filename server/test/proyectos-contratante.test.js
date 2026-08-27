// Los PROYECTOS del contratante: el desarrollo completo, con los proveedores
// adentro. Es el nivel que le faltaba al desarrollador para tener la torre en un
// solo lugar.
//
// Lo que se fija aquí es sobre todo una cosa: que agregar este nivel NO movió
// quién alcanza qué. El permiso sigue colgando de proyectos.contratante_id, y
// desarrollo_id es agrupación. Con dos columnas que dicen lo mismo, la única
// forma de que no discrepen es que una se derive de la otra — y eso también se
// prueba aquí.
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
let operador;
let carlos;   // vendedor, lleva a Vega
let delta;    // gente del contratante
let otro;     // gente de OTRO contratante
let vega;     // gente del proveedor

const DELTA = 1;
const VEGA = 2;
const OTRO = 3;   // otro contratante, para probar que no se cruzan
const OBRA = 1;   // de Vega, ligada a Delta

// Dos montos distintos y con dos afianzadoras distintas: si el consumo por
// afianzadora se revolviera, la suma saldría en el renglón equivocado.
const MONTO_ASERTA = 1200000;
const MONTO_CHUBB = 800000;

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

    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta','aserta'), ('Chubb','chubb');
    INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito)
      VALUES (2, 1, 50000000), (2, 2, 10000000);

    INSERT INTO client_proveedores (contratante_id, proveedor_id, alias)
      VALUES (1, 2, 'Estructura');

    INSERT INTO proyectos (client_id, contratante_id, nombre, monto_contrato, estatus)
      VALUES (2, 1, 'Cimentación', 12500000, 'en_proceso');
  `);

  const tipo = (await memoria.query(
    `SELECT id FROM tipos_fianza WHERE nombre = 'Cumplimiento'`
  ))[0].id;
  await memoria.query(
    `INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                          tipo_fianza_id, prima_neta, prima_total, monto_afianzado,
                          fecha_vigencia)
     VALUES (2, 1, 1, 'ASE-1', ${tipo}, 9000, 11000, ${MONTO_ASERTA}, '2099-01-01'),
            (2, 1, 2, 'CHB-1', ${tipo}, 5000,  6000, ${MONTO_CHUBB},  '2099-01-01')`
  );

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

// El id del proyecto de Delta, que se crea en la primera prueba.
let proyectoDelta;

// ---------------------------------------------------------------------------
// El contratante registra sus proyectos
// ---------------------------------------------------------------------------

test('el contratante registra su proyecto', async () => {
  const res = await mandar('POST', '/api/proveedores/proyectos', delta, {
    nombre: 'Torre Delta Poniente', clave: 'TDP-01',
    ubicacion: 'Monterrey', monto_inversion: 18000000000,
    fecha_inicio: '2026-01-01', estatus: 'en_proceso',
  });
  assert.equal(res.status, 200);
  proyectoDelta = (await res.json()).id;

  const { proyectos } = await (await pedir('/api/proveedores/proyectos', delta)).json();
  assert.equal(proyectos.length, 1);
  assert.equal(proyectos[0].nombre, 'Torre Delta Poniente');
  // Recién registrado no tiene proveedores: eso NO es incumplimiento, es que
  // todavía no se le asigna nadie.
  assert.equal(proyectos[0].cumplimiento, 'sin_obra');
  assert.equal(proyectos[0].total_proveedores, 0);
});

test('el nombre es obligatorio y el estatus tiene que existir', async () => {
  const sinNombre = await mandar('POST', '/api/proveedores/proyectos', delta, { nombre: '   ' });
  assert.equal(sinNombre.status, 400);

  const estatusRaro = await mandar('POST', '/api/proveedores/proyectos', delta, {
    nombre: 'X', estatus: 'a-medias',
  });
  assert.equal(estatusRaro.status, 400);
});

test('el proyecto de un contratante no lo toca otro contratante', async () => {
  // Es la prueba que importa de esta ruta: el proyecto se autoriza por
  // propiedad, no por alcance.
  assert.equal((await pedir(`/api/proveedores/proyectos/${proyectoDelta}`, otro)).status, 404);
  assert.equal(
    (await mandar('PUT', `/api/proveedores/proyectos/${proyectoDelta}`, otro, { nombre: 'Mío' })).status,
    404
  );
  assert.equal(
    (await mandar('DELETE', `/api/proveedores/proyectos/${proyectoDelta}`, otro)).status, 404
  );

  // Y sigue como estaba.
  const { proyecto } = await (await pedir(`/api/proveedores/proyectos/${proyectoDelta}`, delta)).json();
  assert.equal(proyecto.nombre, 'Torre Delta Poniente');
});

test('el fiado no entra a los proyectos del contratante', async () => {
  assert.equal((await pedir('/api/proveedores/proyectos', vega)).status, 403);
});

// ---------------------------------------------------------------------------
// Fortex mete la obra del proveedor dentro del proyecto
// ---------------------------------------------------------------------------

test('meter la obra en el proyecto DERIVA el contratante del desarrollo', async () => {
  // Con dos columnas que dicen lo mismo, la única forma de que no discrepen es
  // que una salga de la otra: el contratante se deriva del desarrollo.
  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, {
    desarrollo_id: proyectoDelta,
  });
  assert.equal(res.status, 200);

  const obra = await memoria.prepare(
    'SELECT contratante_id, desarrollo_id FROM proyectos WHERE id = ?'
  ).get(OBRA);
  assert.equal(obra.desarrollo_id, proyectoDelta);
  assert.equal(obra.contratante_id, DELTA, 'el contratante sale del desarrollo');
});

test('un body que se contradice se RECHAZA, no se deriva en silencio', async () => {
  // Mandar el desarrollo de uno con el contratante de otro. Derivando y ya, el
  // operador guardaba una cosa creyendo que guardaba otra — y en el caso del
  // contratante vacío, la revocación se perdía con un 200 en la pantalla.
  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, {
    desarrollo_id: proyectoDelta, contratante_id: OTRO,
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /otro contratante/i);

  // Y nada se movió.
  const obra = await memoria.prepare(
    'SELECT contratante_id, desarrollo_id FROM proyectos WHERE id = ?'
  ).get(OBRA);
  assert.equal(obra.contratante_id, DELTA);
  assert.equal(obra.desarrollo_id, proyectoDelta);

  // El otro contratante no ve nada, ni antes ni después.
  const { proyectos } = await (await pedir('/api/proveedores/proyectos', otro)).json();
  assert.deepEqual(proyectos, []);
});

test('el proyecto agrupa la obra y suma lo que aparta por afianzadora', async () => {
  const { proyecto, proveedores } = await (
    await pedir(`/api/proveedores/proyectos/${proyectoDelta}`, delta)
  ).json();

  assert.equal(proyecto.total_proveedores, 1);
  assert.equal(proyecto.total_obras, 1);
  assert.equal(proyecto.monto_afianzado, MONTO_ASERTA + MONTO_CHUBB);
  assert.equal(proyecto.monto_contratado, 12500000);
  assert.equal(proyecto.cumplimiento, 'cubierta');

  // El proveedor sale con su obra adentro.
  assert.equal(proveedores.length, 1);
  assert.equal(proveedores[0].razon_social, 'Cimentaciones Vega');
  assert.deepEqual(proveedores[0].obras.map((o) => o.nombre), ['Cimentación']);

  // El consumo va por afianzadora, no revuelto. Es la suma de las pólizas que
  // ya ve una por una: no es información nueva, es no sacar la calculadora.
  const porAfi = Object.fromEntries(proyecto.consumo.map((c) => [c.afianzadora_nombre, c.comprometido]));
  assert.deepEqual(porAfi, { Aserta: MONTO_ASERTA, Chubb: MONTO_CHUBB });
  assert.equal(proyecto.consumo.every((c) => c.proveedor_id === VEGA), true);
});

test('al contratante NO se le dice la línea autorizada de su proveedor', async () => {
  const lista = await (await pedir('/api/proveedores/proyectos', delta)).json();
  const detalle = await (await pedir(`/api/proveedores/proyectos/${proyectoDelta}`, delta)).json();

  // Se contestó "sí, solo lo que este proyecto consume": el comprometido sí, el
  // total autorizado y el disponible NO. Eso es de la empresa del proveedor y es
  // con lo que se le negocia precio.
  const PROHIBIDAS = ['linea_credito', 'disponible', 'comprometido_total',
                      'prima_neta', 'prima_total', 'url'];
  const halladas = new Set();
  (function barrer(v) {
    if (Array.isArray(v)) return v.forEach((x) => barrer(x));
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        if (PROHIBIDAS.includes(k)) halladas.add(k);
        barrer(v[k]);
      }
    }
  }({ lista, detalle }));
  assert.deepEqual([...halladas], []);
});

test('el panel SÍ le dice a Fortex la línea y el disponible', async () => {
  const d = await (await pedir(`/api/admin/clientes/${DELTA}/detalle`, operador)).json();

  assert.equal(d.proyectos.length, 1, 'para un contratante, proyectos son sus desarrollos');
  assert.equal(d.proyectos[0].nombre, 'Torre Delta Poniente');

  const aserta = d.lineas_proveedores.find((l) => l.afianzadora_nombre === 'Aserta');
  assert.equal(aserta.linea_credito, 50000000);
  assert.equal(aserta.comprometido_total, MONTO_ASERTA);
  assert.equal(aserta.disponible, 50000000 - MONTO_ASERTA);
});

test('un proveedor con pólizas y sin línea capturada NO desaparece de la tabla', async () => {
  // Su ausencia se leería como "no tiene nada comprometido", que es lo contrario
  // de la verdad, y es justo la pregunta que esa tabla contesta.
  await memoria.query(
    'DELETE FROM client_credit_lines WHERE client_id = ? AND afianzadora_id = 1', [VEGA]
  );
  try {
    const d = await (await pedir(`/api/admin/clientes/${DELTA}/detalle`, operador)).json();
    const aserta = d.lineas_proveedores.find(
      (l) => l.proveedor_id === VEGA && l.afianzadora_nombre === 'Aserta'
    );
    assert.ok(aserta, 'el renglón tiene que estar, aunque no haya línea capturada');
    assert.equal(aserta.linea_credito, 0);
    assert.equal(aserta.comprometido_total, MONTO_ASERTA);
    // Disponible negativo NO significa que se pasó de su línea: significa que
    // falta capturarla, y así se ve.
    assert.equal(aserta.disponible, -MONTO_ASERTA);
  } finally {
    await memoria.query(
      'INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito) VALUES (?, 1, 50000000)',
      [VEGA]
    );
  }
});

test('sacar la obra del proyecto NO la desliga del contratante', async () => {
  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { desarrollo_id: '' });
  assert.equal(res.status, 200);

  const obra = await memoria.prepare(
    'SELECT contratante_id, desarrollo_id FROM proyectos WHERE id = ?'
  ).get(OBRA);
  assert.equal(obra.desarrollo_id, null);
  assert.equal(obra.contratante_id, DELTA, 'son dos cosas distintas: agrupar y autorizar');

  // Delta la sigue viendo, pero suelta: es captura pendiente, no un proyecto
  // vacío, y por eso se dice aparte en vez de desaparecer.
  const { proyectos, obras_sin_proyecto } = await (
    await pedir('/api/proveedores/proyectos', delta)
  ).json();
  assert.equal(proyectos[0].total_obras, 0);
  assert.deepEqual(obras_sin_proyecto.map((o) => o.nombre), ['Cimentación']);
});

test('desligar del contratante saca la obra también del proyecto', async () => {
  await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { desarrollo_id: proyectoDelta });

  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { contratante_id: '' });
  assert.equal(res.status, 200);

  const obra = await memoria.prepare(
    'SELECT contratante_id, desarrollo_id FROM proyectos WHERE id = ?'
  ).get(OBRA);
  assert.equal(obra.contratante_id, null);
  assert.equal(obra.desarrollo_id, null,
    'si no, quedaría dentro del desarrollo de alguien que ya no la alcanza');

  // Se deja como estaba para las pruebas de abajo.
  await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { desarrollo_id: proyectoDelta });
});

test('desligar con el formulario COMPLETO desliga de verdad', async () => {
  // Es el cuerpo que manda la pantalla, no uno de laboratorio: el formulario
  // guarda desarrollo_id en su estado y lo sigue mandando aunque el select se
  // esconda al vaciar "Para". Derivando el contratante del desarrollo, esta
  // petición contestaba 200 SIN desligar nada — una revocación perdida en
  // silencio, que es lo peor que puede hacer esta ruta.
  await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { desarrollo_id: proyectoDelta });

  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, {
    nombre: 'Cimentación', estatus: 'en_proceso',
    contratante_id: '', desarrollo_id: proyectoDelta,
  });
  assert.equal(res.status, 400, 'el body se contradice: hay que decirlo, no derivar');
  assert.match((await res.json()).error, /proyecto/i);

  // Y con el cuerpo coherente —que es el que manda el formulario arreglado— sí
  // desliga, y de paso saca la obra del proyecto.
  const ok = await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, {
    nombre: 'Cimentación', contratante_id: '', desarrollo_id: '',
  });
  assert.equal(ok.status, 200);
  const obra = await memoria.prepare(
    'SELECT contratante_id, desarrollo_id FROM proyectos WHERE id = ?'
  ).get(OBRA);
  assert.equal(obra.contratante_id, null);
  assert.equal(obra.desarrollo_id, null);

  await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { desarrollo_id: proyectoDelta });
});

test('cambiar de contratante saca la obra del desarrollo del anterior', async () => {
  // Sin esto, contratante_id y desarrollo_id acababan discrepando: la obra
  // contaba en las métricas de uno y salía en el proyecto del otro.
  const { id: delOtro } = await (await mandar(
    'POST', `/api/admin/clientes/${OTRO}/proyectos`, operador, { nombre: 'Torre del otro' }
  )).json();

  await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { contratante_id: OTRO });
  const obra = await memoria.prepare(
    'SELECT contratante_id, desarrollo_id FROM proyectos WHERE id = ?'
  ).get(OBRA);
  assert.equal(obra.contratante_id, OTRO);
  assert.equal(obra.desarrollo_id, null, 'el desarrollo era del contratante anterior');

  // Se deja como estaba.
  await memoria.query('DELETE FROM desarrollos WHERE id = ?', [delOtro]);
  await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { desarrollo_id: proyectoDelta });
});

test('el alta tampoco acepta un proyecto de otro contratante', async () => {
  const res = await mandar('POST', '/api/admin/proyectos', operador, {
    client_id: VEGA, nombre: 'Obra nueva',
    contratante_id: OTRO, desarrollo_id: proyectoDelta,
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /otro contratante/i);
});

test('al vendedor no se le da la línea de crédito de los proveedores', async () => {
  // Alcanzar al contratante no puede volverse la puerta trasera a las líneas de
  // sus proveedores, que pueden ser clientes de otro vendedor: por el detalle
  // del proveedor recibe un 403, y por aquí entraba lo mismo.
  await memoria.query('UPDATE clients SET vendedor_id = 2 WHERE id = ?', [DELTA]);
  await memoria.query('UPDATE clients SET vendedor_id = NULL WHERE id = ?', [VEGA]);
  try {
    assert.equal((await pedir(`/api/admin/clientes/${VEGA}/detalle`, carlos)).status, 403);

    const d = await (await pedir(`/api/admin/clientes/${DELTA}/detalle`, carlos)).json();
    assert.deepEqual(d.lineas_proveedores, []);
    // Lo que sí ve es el padrón y el cumplimiento, que es su trabajo.
    assert.ok(d.proveedores.length > 0);

    const delOperador = await (await pedir(`/api/admin/clientes/${DELTA}/detalle`, operador)).json();
    assert.ok(delOperador.lineas_proveedores.length > 0, 'el operador sí la ve');
  } finally {
    await memoria.query('UPDATE clients SET vendedor_id = NULL WHERE id = ?', [DELTA]);
    await memoria.query('UPDATE clients SET vendedor_id = 2 WHERE id = ?', [VEGA]);
  }
});

test('el contratado del proyecto cuenta las mismas obras que el afianzado', async () => {
  // Una obra cancelada dentro del proyecto: no cuenta para el afianzado, así que
  // tampoco puede contar para el contratado. Si no, el porcentaje que uno saca
  // de cabeza de esa ficha sale falso.
  const { id: cancelada } = await memoria.prepare(
    `INSERT INTO proyectos (client_id, contratante_id, desarrollo_id, nombre,
                            monto_contrato, estatus)
     VALUES (?, ?, ?, 'Obra cancelada', 9000000, 'cancelado') RETURNING id`
  ).get(VEGA, DELTA, proyectoDelta);

  try {
    const { proyecto } = await (
      await pedir(`/api/proveedores/proyectos/${proyectoDelta}`, delta)
    ).json();
    assert.equal(proyecto.monto_contratado, 12500000,
      'la obra cancelada no puede sumar en el contratado si no suma en el afianzado');
    assert.equal(proyecto.obras_vivas, 1);
    assert.equal(proyecto.total_obras, 2, 'pero se sigue listando');
  } finally {
    await memoria.query('DELETE FROM proyectos WHERE id = ?', [cancelada]);
  }
});

test('un desarrollo inventado se rechaza', async () => {
  const res = await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { desarrollo_id: 9999 });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /no existe/i);
});

test('el vendedor no mete la obra en el proyecto de un contratante', async () => {
  // Meterla deriva un contratante, y eso le abre las pólizas de su cliente a
  // otra empresa: es la misma decisión que ligar, y no es suya.
  await memoria.query('UPDATE proyectos SET contratante_id = NULL, desarrollo_id = NULL WHERE id = ?', [OBRA]);
  try {
    const res = await mandar('PUT', `/api/admin/proyectos/${OBRA}`, carlos, {
      desarrollo_id: proyectoDelta,
    });
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /operador/i);
  } finally {
    await memoria.query(
      'UPDATE proyectos SET contratante_id = ?, desarrollo_id = ? WHERE id = ?',
      [DELTA, proyectoDelta, OBRA]
    );
  }
});

// ---------------------------------------------------------------------------
// Borrar
// ---------------------------------------------------------------------------

test('no se borra un proyecto con obras adentro', async () => {
  const res = await mandar('DELETE', `/api/proveedores/proyectos/${proyectoDelta}`, delta);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /obra\(s\)/i);
});

test('borrar el proyecto no borra la obra ni la póliza del proveedor', async () => {
  await mandar('PUT', `/api/admin/proyectos/${OBRA}`, operador, { desarrollo_id: '' });

  const res = await mandar('DELETE', `/api/proveedores/proyectos/${proyectoDelta}`, delta);
  assert.equal(res.status, 200);

  // La obra y su póliza son del proveedor y se quedan.
  const obra = await memoria.prepare('SELECT id, contratante_id FROM proyectos WHERE id = ?').get(OBRA);
  assert.ok(obra, 'la obra es del proveedor: no se va con el proyecto del contratante');
  assert.equal(obra.contratante_id, DELTA);
  const { c } = await memoria.prepare('SELECT COUNT(*)::int c FROM fianzas WHERE proyecto_id = ?').get(OBRA);
  assert.equal(c, 2);
});

// ---------------------------------------------------------------------------
// Fortex por la otra puerta
// ---------------------------------------------------------------------------

test('Fortex captura el proyecto del contratante por la misma puerta', async () => {
  const res = await mandar('POST', `/api/admin/clientes/${DELTA}/proyectos`, operador, {
    nombre: 'Plaza Delta Sur', clave: 'PDS-01',
  });
  assert.equal(res.status, 200);
  const { id } = await res.json();

  // Y el contratante lo ve como suyo: es la misma tabla y el mismo servicio.
  const { proyectos } = await (await pedir('/api/proveedores/proyectos', delta)).json();
  assert.ok(proyectos.some((p) => p.id === id && p.nombre === 'Plaza Delta Sur'));

  // El selector del panel también lo trae.
  const delPanel = await (await pedir(`/api/admin/clientes/${DELTA}/proyectos`, operador)).json();
  assert.ok(delPanel.proyectos.some((p) => p.id === id));
});

test('un fiado no tiene proyectos propios de contratante', async () => {
  const res = await mandar('POST', `/api/admin/clientes/${VEGA}/proyectos`, operador, {
    nombre: 'No debería',
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /contratante/i);
});

test('el proyecto de un contratante no se edita por el path de otro', async () => {
  // Con el id de un proyecto de Delta pero el path de otro contratante: si solo
  // se mirara el id, se editaría el ajeno.
  const { id } = await (await mandar(
    'POST', `/api/admin/clientes/${OTRO}/proyectos`, operador, { nombre: 'Del otro' }
  )).json();

  const res = await mandar('PUT', `/api/admin/clientes/${DELTA}/proyectos/${id}`, operador, {
    nombre: 'Secuestrado',
  });
  assert.equal(res.status, 404);

  const sigue = await memoria.prepare('SELECT nombre FROM desarrollos WHERE id = ?').get(id);
  assert.equal(sigue.nombre, 'Del otro');
});
