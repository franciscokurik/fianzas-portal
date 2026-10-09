// Las comisiones que genera cada póliza, y su carga masiva desde Excel.
//
// QUIÉN ve qué se decide en routes/comisiones.js; aquí solo se recibe ya
// resuelto como un "alcance": null = todas (el admin), o el id de un vendedor,
// y entonces SOLO las suyas. Que el alcance llegue armado y no se adivine aquí
// es a propósito: así ninguna consulta de este archivo puede olvidarse de
// acotar, porque todas lo reciben.
//
// "Las suyas" quiere decir comisiones.vendedor_id, el vendedor que tenía el
// cliente AL CAPTURARLA, y no el titular de hoy. Si se reasigna la cuenta, lo
// que ya ganó el anterior no se le pasa al nuevo.
import db from '../db.js';
import { pesosACentavos } from '../lib/dinero.js';
import { slugify } from '../lib/slug.js';
import { todayISO } from '../lib/dates.js';

const TS = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')";

function invalido(mensaje, status = 400) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

// Lo que puede traer una celda de fecha, a 'YYYY-MM-DD'. null si está vacía y
// undefined si trae algo que no es una fecha válida (para poder decir cuál).
//
// Día primero en las de diagonal: en México "03/04/2026" es 3 de abril. Y se
// valida que la fecha exista de verdad —un 31 de febrero no pasa—, porque si
// no, Postgres la guardaría como texto y la comisión desaparecería de todos los
// filtros por mes sin que nadie supiera por qué.
export function fechaISO(valor) {
  if (valor === '' || valor == null) return null;

  // Número de serie de Excel (días desde el 30-dic-1899), por si la celda llega
  // sin formato de fecha.
  if (typeof valor === 'number' || /^\d{5}(\.\d+)?$/.test(String(valor).trim())) {
    const n = Math.floor(Number(valor));
    if (n < 30000 || n > 80000) return undefined; // fuera de 1982–2119: no es fecha
    const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
    return d.toISOString().slice(0, 10);
  }

  const texto = String(valor).trim();
  let a; let m; let d;
  let r = texto.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (r) { [, a, m, d] = r; } else {
    r = texto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!r) return undefined;
    [, d, m, a] = r;
  }
  const fecha = new Date(Date.UTC(Number(a), Number(m) - 1, Number(d)));
  if (fecha.getUTCFullYear() !== Number(a) || fecha.getUTCMonth() !== Number(m) - 1
      || fecha.getUTCDate() !== Number(d)) {
    return undefined;
  }
  if (Number(a) < 2000 || Number(a) > 2100) return undefined;
  return fecha.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Consultas
// ---------------------------------------------------------------------------

const SELECT_COMISION = `
  SELECT c.id, c.fianza_id, f.numero_poliza, f.afianzadora_id,
         a.nombre AS afianzadora_nombre, f.client_id, cl.razon_social AS cliente,
         c.vendedor_id, u.nombre AS vendedor_nombre,
         c.fecha_pago, c.fecha_conciliacion, c.comision_neta, c.notas, c.origen,
         c.created_at
  FROM comisiones c
  JOIN fianzas f       ON f.id = c.fianza_id
  JOIN afianzadoras a  ON a.id = f.afianzadora_id
  JOIN clients cl      ON cl.id = f.client_id
  LEFT JOIN users u    ON u.id = c.vendedor_id`;

// El trozo de WHERE del alcance. Se arma aquí, una vez, para que ninguna
// consulta lo escriba a mano.
function deAlcance(alcance, columna = 'c.vendedor_id') {
  return alcance == null
    ? { sql: '', params: [] }
    : { sql: ` AND ${columna} = ?`, params: [alcance] };
}

// El listado, con los filtros de la pantalla. 'vendedor' solo lo usa el admin:
// para el vendedor el alcance ya lo dejó en lo suyo y el filtro no puede
// ampliarlo (se aplican los dos, así que a lo más lo vacía).
//
// El periodo es de CONCILIACIÓN, como las cifras de arriba: la fecha de pago
// del cliente es opcional y no puede decidir en qué mes cae una comisión.
export async function listarComisiones(alcance, filtros = {}) {
  const partes = [];
  const params = [];
  const a = deAlcance(alcance);

  if (filtros.desde) { partes.push('c.fecha_conciliacion >= ?'); params.push(filtros.desde); }
  if (filtros.hasta) { partes.push('c.fecha_conciliacion <= ?'); params.push(filtros.hasta); }
  if (filtros.afianzadora_id) { partes.push('f.afianzadora_id = ?'); params.push(Number(filtros.afianzadora_id)); }
  if (filtros.vendedor_id === 'sin') partes.push('c.vendedor_id IS NULL');
  else if (filtros.vendedor_id) { partes.push('c.vendedor_id = ?'); params.push(Number(filtros.vendedor_id)); }
  if (filtros.estado === 'conciliada') partes.push('c.fecha_conciliacion IS NOT NULL');
  if (filtros.estado === 'por_conciliar') partes.push('c.fecha_conciliacion IS NULL');
  if (filtros.q) {
    partes.push('(f.numero_poliza ILIKE ? OR cl.razon_social ILIKE ?)');
    params.push(`%${filtros.q}%`, `%${filtros.q}%`);
  }

  const where = partes.map((p) => ` AND ${p}`).join('');
  return db.prepare(
    `${SELECT_COMISION}
     WHERE 1 = 1${a.sql}${where}
     ORDER BY c.fecha_conciliacion DESC NULLS FIRST, c.id DESC`
  ).all(...a.params, ...params);
}

// Las cuatro cifras de arriba de la pantalla. No dependen de los filtros: son
// la foto de hoy, y por eso se piden aparte.
//
// "Conciliado" cuenta por FECHA DE CONCILIACIÓN —cuando Fortex asignó lo que
// pagó la afianzadora—, que es la fecha que se captura siempre. La de pago
// del cliente es opcional y no puede mandar en una cifra.
//
// "Por conciliar" son los PENDIENTES, en la misma unidad que la lista: pólizas
// sin ninguna comisión más comisiones capturadas sin conciliar. Su monto es
// solo el de las capturadas: lo que no se ha asignado todavía no tiene monto.
//
// Las pólizas sin comisión son de la cartera de HOY del vendedor (clients.
// vendedor_id): todavía no tienen a quién guardarle el nombre, así que se le
// atribuyen al titular.
export async function resumenComisiones(alcance) {
  const hoy = todayISO();
  const mes = hoy.slice(0, 7);
  const anio = hoy.slice(0, 4);
  const a = deAlcance(alcance);

  const suma = (condicion, ...extra) => db.prepare(
    `SELECT COALESCE(SUM(c.comision_neta), 0)::bigint AS total, COUNT(*)::int AS cuantas
     FROM comisiones c WHERE ${condicion}${a.sql}`
  ).get(...extra, ...a.params);

  const sinComision = await db.prepare(
    `SELECT COUNT(*)::int AS c
     FROM fianzas f JOIN clients cl ON cl.id = f.client_id
     WHERE f.clase = 'fianza'
       AND NOT EXISTS (SELECT 1 FROM comisiones c WHERE c.fianza_id = f.id)
       ${deAlcance(alcance, 'cl.vendedor_id').sql}`
  ).get(...deAlcance(alcance, 'cl.vendedor_id').params);

  const sinConciliar = await suma('c.fecha_conciliacion IS NULL');

  return {
    mes: { periodo: mes, ...(await suma('c.fecha_conciliacion LIKE ?', `${mes}%`)) },
    anio: { periodo: anio, ...(await suma('c.fecha_conciliacion LIKE ?', `${anio}%`)) },
    por_conciliar: {
      cuantas: sinComision.c + sinConciliar.cuantas,
      total: sinConciliar.total,
    },
    polizas_sin_comision: sinComision.c,
  };
}

// La lista de la pantalla: las PÓLIZAS, no las comisiones. Un renglón por cada
// comisión capturada y uno por cada póliza emitida que todavía no tiene
// ninguna —ese es el que se asigna—. Sin esto, mientras no hubiera comisiones
// capturadas la pantalla salía vacía, aunque hubiera nueve pólizas esperando.
//
// El alcance del vendedor tiene dos mitades, como las cifras de arriba: las
// comisiones que se le GUARDARON a él, y las pólizas sin comisión de su
// cartera de hoy. Una comisión que se le guardó a otro vendedor no aparece
// aunque el cliente sea suyo ahora.
//
// El periodo filtra por fecha de conciliación, así que solo toca a lo ya
// conciliado: lo pendiente no tiene fecha y se enseña siempre.
export async function tableroComisiones(alcance, filtros = {}) {
  const partes = [];
  const params = [];

  if (alcance != null) {
    partes.push('((c.id IS NOT NULL AND c.vendedor_id = ?) OR (c.id IS NULL AND cl.vendedor_id = ?))');
    params.push(alcance, alcance);
  }
  if (filtros.estado === 'por_conciliar') partes.push('c.fecha_conciliacion IS NULL');
  if (filtros.estado === 'conciliada') partes.push('c.fecha_conciliacion IS NOT NULL');
  if (filtros.desde) { partes.push('(c.fecha_conciliacion IS NULL OR c.fecha_conciliacion >= ?)'); params.push(filtros.desde); }
  if (filtros.hasta) { partes.push('(c.fecha_conciliacion IS NULL OR c.fecha_conciliacion <= ?)'); params.push(filtros.hasta); }
  if (filtros.afianzadora_id) { partes.push('f.afianzadora_id = ?'); params.push(Number(filtros.afianzadora_id)); }
  if (filtros.vendedor_id === 'sin') partes.push('COALESCE(c.vendedor_id, cl.vendedor_id) IS NULL');
  else if (filtros.vendedor_id) {
    partes.push('COALESCE(c.vendedor_id, cl.vendedor_id) = ?');
    params.push(Number(filtros.vendedor_id));
  }

  const where = partes.map((p) => ` AND ${p}`).join('');
  return db.prepare(
    `SELECT f.id AS fianza_id, f.numero_poliza, f.afianzadora_id,
            a.nombre AS afianzadora_nombre, f.client_id, cl.razon_social AS cliente,
            f.prima_neta, c.id AS comision_id,
            COALESCE(c.vendedor_id, cl.vendedor_id) AS vendedor_id, u.nombre AS vendedor_nombre,
            c.fecha_pago, c.fecha_conciliacion, c.comision_neta, c.notas, c.origen
     FROM fianzas f
     JOIN afianzadoras a ON a.id = f.afianzadora_id
     JOIN clients cl     ON cl.id = f.client_id
     LEFT JOIN comisiones c ON c.fianza_id = f.id
     LEFT JOIN users u      ON u.id = COALESCE(c.vendedor_id, cl.vendedor_id)
     WHERE f.clase = 'fianza'${where}
     ORDER BY (c.fecha_conciliacion IS NULL) DESC, c.fecha_conciliacion DESC,
              cl.razon_social, f.numero_poliza, c.id`
  ).all(...params);
}

// El buscador del alta individual: pólizas EMITIDAS por número o cliente. Los
// previos no generan comisión —la afianzadora todavía no emite—, así que no
// se ofrecen.
export async function buscarPolizas(q) {
  const texto = String(q || '').trim();
  if (texto.length < 2) return [];
  return db.prepare(
    `SELECT f.id, f.numero_poliza, a.nombre AS afianzadora_nombre,
            cl.razon_social AS cliente, cl.vendedor_id, u.nombre AS vendedor_nombre,
            f.prima_neta,
            (SELECT COUNT(*)::int FROM comisiones c WHERE c.fianza_id = f.id) AS comisiones,
            (SELECT COALESCE(SUM(c.comision_neta), 0)::bigint FROM comisiones c
              WHERE c.fianza_id = f.id) AS comisionado
     FROM fianzas f
     JOIN afianzadoras a ON a.id = f.afianzadora_id
     JOIN clients cl     ON cl.id = f.client_id
     LEFT JOIN users u   ON u.id = cl.vendedor_id
     WHERE f.clase = 'fianza'
       AND (f.numero_poliza ILIKE ? OR cl.razon_social ILIKE ?)
     ORDER BY f.numero_poliza
     LIMIT 20`
  ).all(`%${texto}%`, `%${texto}%`);
}

// ---------------------------------------------------------------------------
// Alta, cambio y baja individual (solo el admin; lo cuida la ruta)
// ---------------------------------------------------------------------------

// Valida lo que se captura a mano. Devuelve los datos ya normalizados.
//
// Lo obligatorio es la comisión. La fecha de pago del cliente es opcional: al
// conciliar no siempre se tiene, y pedirla obligaba a inventar una.
function validar({ fecha_pago, fecha_conciliacion, comision_neta, notas }) {
  const pago = fechaISO(fecha_pago);
  if (pago === undefined) throw invalido('La fecha de pago no es una fecha válida.');
  const conciliacion = fechaISO(fecha_conciliacion);
  if (conciliacion === undefined) throw invalido('La fecha de conciliación no es una fecha válida.');

  // Del front llega en centavos, ya convertida por InputPesos.
  const monto = Number(comision_neta);
  if (!Number.isInteger(monto) || monto === 0) {
    throw invalido('Captura la comisión neta. Puede ser negativa si es una devolución, pero no cero.');
  }
  return {
    fecha_pago: pago,
    fecha_conciliacion: conciliacion,
    comision_neta: monto,
    notas: notas ? String(notas).trim() || null : null,
  };
}

export async function crearComision(datos, capturadaPor) {
  const fianza = await db.prepare(
    `SELECT f.id, f.clase, cl.vendedor_id
     FROM fianzas f JOIN clients cl ON cl.id = f.client_id WHERE f.id = ?`
  ).get(Number(datos.fianza_id));
  if (!fianza) throw invalido('No existe esa póliza.', 404);
  if (fianza.clase !== 'fianza') {
    throw invalido('Es un previo: todavía no se emite, así que no genera comisión.');
  }
  const v = validar(datos);
  const fila = await db.prepare(
    `INSERT INTO comisiones (fianza_id, vendedor_id, fecha_pago, fecha_conciliacion,
                             comision_neta, notas, origen, capturada_por)
     VALUES (?, ?, ?, ?, ?, ?, 'manual', ?) RETURNING id`
  ).get(fianza.id, fianza.vendedor_id ?? null, v.fecha_pago, v.fecha_conciliacion,
        v.comision_neta, v.notas, capturadaPor);
  return fila.id;
}

// No cambia ni la póliza ni el vendedor: si la comisión se capturó en la póliza
// equivocada, se borra y se captura bien. Moverla de póliza a escondidas haría
// que el vendedor guardado dejara de corresponder.
export async function actualizarComision(id, datos) {
  const v = validar(datos);
  const fila = await db.prepare(
    `UPDATE comisiones
     SET fecha_pago = ?, fecha_conciliacion = ?, comision_neta = ?, notas = ?, updated_at = ${TS}
     WHERE id = ? RETURNING id`
  ).get(v.fecha_pago, v.fecha_conciliacion, v.comision_neta, v.notas, Number(id));
  if (!fila) throw invalido('No existe esa comisión.', 404);
}

export async function borrarComision(id) {
  const fila = await db.prepare('DELETE FROM comisiones WHERE id = ? RETURNING id').get(Number(id));
  if (!fila) throw invalido('No existe esa comisión.', 404);
}

// ---------------------------------------------------------------------------
// Carga masiva
// ---------------------------------------------------------------------------

// La base que se descarga: un renglón por comisión, y uno vacío por cada póliza
// emitida que todavía no tiene ninguna, para llenarlo. Lleva el id de la
// comisión: es lo que hace que volver a subir el archivo CORRIJA esa comisión
// en vez de duplicarla.
export async function baseParaDescargar({ afianzadora_id } = {}) {
  const params = [];
  let filtro = '';
  if (afianzadora_id) { filtro = ' AND f.afianzadora_id = ?'; params.push(Number(afianzadora_id)); }
  return db.prepare(
    `SELECT c.id AS comision_id, f.numero_poliza, a.nombre AS afianzadora,
            cl.razon_social AS cliente, c.fecha_pago, c.fecha_conciliacion, c.comision_neta
     FROM fianzas f
     JOIN afianzadoras a ON a.id = f.afianzadora_id
     JOIN clients cl     ON cl.id = f.client_id
     LEFT JOIN comisiones c ON c.fianza_id = f.id
     WHERE f.clase = 'fianza'${filtro}
     ORDER BY a.nombre, f.numero_poliza, c.fecha_pago NULLS FIRST, c.id`
  ).all(...params);
}

// Para comparar números de póliza: sin espacios ni mayúsculas. Y una segunda
// forma sin ceros a la izquierda, porque Excel convierte "0301121" en 301121 en
// cuanto alguien escribe en la celda, y esa póliza no se encontraría nunca.
const llavePoliza = (n) => String(n ?? '').trim().toUpperCase().replace(/\s+/g, '');
const sinCeros = (n) => llavePoliza(n).replace(/^0+(?=\d)/, '');

// Revisa CADA renglón del archivo contra la base y dice qué pasaría, sin
// guardar nada. Es lo que se le enseña a la persona antes de confirmar, y lo
// MISMO que se aplica después: aplicar vuelve a llamar aquí, así que lo que se
// guarda no puede ser distinto de lo que se enseñó.
//
// Un renglón puede ser:
//   nueva       -> sin id, con datos, y no existe ya una igual.
//   corregida   -> con id, y algo cambió.
//   sin cambios -> con id, idéntica a la guardada.
//   repetida    -> sin id, pero ya existe esa misma comisión (misma póliza,
//                  fecha de pago y monto), en la base o más arriba en el mismo
//                  archivo. Es lo que impide duplicar al subir dos veces.
//   vacía       -> el renglón de una póliza sin comisión que nadie llenó.
//   error       -> con el motivo, en palabras.
export async function analizarImportacion(filas = []) {
  if (!Array.isArray(filas)) throw invalido('El archivo no trae renglones.');
  if (filas.length > 10000) throw invalido('Son más de 10,000 renglones: divide el archivo.');

  const polizas = await db.prepare(
    `SELECT f.id, f.numero_poliza, f.clase, f.afianzadora_id, a.nombre AS afianzadora_nombre,
            cl.razon_social AS cliente, cl.vendedor_id
     FROM fianzas f
     JOIN afianzadoras a ON a.id = f.afianzadora_id
     JOIN clients cl     ON cl.id = f.client_id`
  ).all();
  const afianzadoras = await db.prepare('SELECT id, nombre, slug FROM afianzadoras').all();
  const existentes = await db.prepare(
    'SELECT id, fianza_id, fecha_pago, fecha_conciliacion, comision_neta FROM comisiones'
  ).all();

  // La afianzadora se reconoce por su nombre sin acentos ni mayúsculas: en el
  // Excel alguien escribe "tokio marine" o "TOKIO MARINE" y es la misma.
  const afianzadoraDe = new Map();
  for (const a of afianzadoras) {
    afianzadoraDe.set(slugify(a.nombre), a);
    if (a.slug) afianzadoraDe.set(a.slug, a);
  }
  // Índices de pólizas por afianzadora + número, en las dos formas. Con miles de
  // renglones, buscar recorriendo la lista cada vez serían millones de
  // comparaciones.
  const indice = (llave) => {
    const m = new Map();
    for (const p of polizas) {
      const k = `${p.afianzadora_id}|${llave(p.numero_poliza)}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    return m;
  };
  const porNumero = indice(llavePoliza);
  const porNumeroSinCeros = indice(sinCeros);
  const porId = new Map(existentes.map((c) => [c.id, c]));
  const firma = (fianzaId, fecha, monto) => `${fianzaId}|${fecha}|${monto}`;
  const yaEstan = new Set(existentes.map((c) => firma(c.fianza_id, c.fecha_pago, c.comision_neta)));
  const idsVistos = new Set();

  const resultado = {
    nuevas: [], corregidas: [], sin_cambios: 0, repetidas: [], vacias: 0, errores: [],
  };

  filas.forEach((f, i) => {
    // El número de renglón del Excel: el encabezado es el 1.
    const fila = Number(f.fila) || i + 2;
    const numero = String(f.numero_poliza ?? '').trim();
    const error = (motivo) => resultado.errores.push({ fila, numero_poliza: numero, motivo });

    const id = f.id === '' || f.id == null ? null : Number(f.id);
    const crudo = { pago: f.fecha_pago, conc: f.fecha_conciliacion, monto: f.comision_neta };
    const vacio = (v) => v == null || String(v).trim() === '';
    if (vacio(crudo.pago) && vacio(crudo.conc) && vacio(crudo.monto)) {
      if (id) {
        error('Tiene ID pero no trae datos. Si querías borrar esa comisión, hazlo desde la pantalla.');
      } else {
        resultado.vacias += 1;
      }
      return;
    }

    if (!numero) return error('Falta el número de fianza.');
    const afianzadora = afianzadoraDe.get(slugify(f.afianzadora ?? ''));
    if (!afianzadora) return error(`No existe la afianzadora "${f.afianzadora ?? ''}".`);

    let candidatas = porNumero.get(`${afianzadora.id}|${llavePoliza(numero)}`) || [];
    if (!candidatas.length) {
      candidatas = porNumeroSinCeros.get(`${afianzadora.id}|${sinCeros(numero)}`) || [];
    }
    if (!candidatas.length) return error(`No existe la fianza ${numero} con ${afianzadora.nombre}.`);
    // Los previos se descartan ANTES de decidir si es ambigua: el previo y la
    // póliza ya emitida pueden compartir número, y eso no es una duda.
    const emitidas = candidatas.filter((p) => p.clase === 'fianza');
    if (!emitidas.length) {
      return error(`La ${numero} es un previo: todavía no se emite, así que no genera comisión.`);
    }
    if (emitidas.length > 1) {
      return error(`Hay ${emitidas.length} fianzas ${numero} con ${afianzadora.nombre} `
        + `(${emitidas.map((p) => p.cliente).join(', ')}): no se sabe a cuál va.`);
    }
    const poliza = emitidas[0];

    // La fecha de pago es opcional, como en la captura a mano.
    const pago = fechaISO(crudo.pago);
    if (pago === undefined) return error(`La fecha de pago "${crudo.pago}" no es una fecha válida.`);
    const conciliacion = fechaISO(crudo.conc);
    if (conciliacion === undefined) {
      return error(`La fecha de conciliación "${crudo.conc}" no es una fecha válida.`);
    }
    const monto = pesosACentavos(crudo.monto);
    if (monto === null) return error('Falta la comisión neta.');
    if (Number.isNaN(monto)) return error(`La comisión "${crudo.monto}" no es un monto.`);
    if (monto === 0) return error('La comisión no puede ser cero.');

    const datos = {
      fila, fianza_id: poliza.id, numero_poliza: poliza.numero_poliza,
      afianzadora: poliza.afianzadora_nombre, cliente: poliza.cliente,
      vendedor_id: poliza.vendedor_id ?? null,
      fecha_pago: pago, fecha_conciliacion: conciliacion, comision_neta: monto,
    };

    if (id) {
      if (idsVistos.has(id)) return error(`El ID ${id} viene dos veces en el archivo.`);
      idsVistos.add(id);
      const actual = porId.get(id);
      if (!actual) return error(`No existe la comisión con ID ${id}. Si es nueva, borra el ID.`);
      if (actual.fianza_id !== poliza.id) {
        return error(`El ID ${id} es de otra póliza. No cambies el número de fianza de un renglón que ya tiene ID.`);
      }
      const igual = actual.fecha_pago === pago
        && (actual.fecha_conciliacion ?? null) === conciliacion
        && actual.comision_neta === monto;
      if (igual) resultado.sin_cambios += 1;
      else resultado.corregidas.push({ ...datos, id });
      return;
    }

    const llave = firma(poliza.id, pago, monto);
    if (yaEstan.has(llave)) {
      resultado.repetidas.push(datos);
      return;
    }
    yaEstan.add(llave);
    resultado.nuevas.push(datos);
  });

  return resultado;
}

// Guarda lo que analizarImportacion dijo. TODO O NADA: si hay un solo error no
// se guarda nada, y lo que sí se guarda va en UNA sola sentencia —inserciones y
// correcciones juntas—, que Postgres aplica completa o no aplica. El driver de
// Neon es HTTP y no tiene transacciones de varias consultas; una sentencia con
// CTEs es atómica por sí misma.
export async function aplicarImportacion(filas, capturadaPor) {
  const r = await analizarImportacion(filas);
  if (r.errores.length) {
    const e = invalido(`El archivo tiene ${r.errores.length} renglón(es) con error. No se guardó nada.`, 422);
    e.analisis = r;
    throw e;
  }

  const datos = [
    ...r.nuevas.map((n) => ({ ...n, id: null })),
    ...r.corregidas,
  ].map((d) => ({
    id: d.id, fianza_id: d.fianza_id, vendedor_id: d.vendedor_id,
    fecha_pago: d.fecha_pago, fecha_conciliacion: d.fecha_conciliacion,
    comision_neta: d.comision_neta,
  }));

  if (datos.length) {
    await db.prepare(
      `WITH datos AS (
         SELECT * FROM jsonb_to_recordset(?::jsonb) AS x(
           id int, fianza_id int, vendedor_id int,
           fecha_pago text, fecha_conciliacion text, comision_neta bigint)
       ),
       corregidas AS (
         UPDATE comisiones c
         SET fecha_pago = d.fecha_pago, fecha_conciliacion = d.fecha_conciliacion,
             comision_neta = d.comision_neta, updated_at = ${TS}
         FROM datos d
         WHERE d.id IS NOT NULL AND c.id = d.id
         RETURNING c.id
       ),
       nuevas AS (
         INSERT INTO comisiones (fianza_id, vendedor_id, fecha_pago, fecha_conciliacion,
                                 comision_neta, origen, capturada_por)
         SELECT d.fianza_id, d.vendedor_id, d.fecha_pago, d.fecha_conciliacion,
                d.comision_neta, 'masiva', ?
         FROM datos d WHERE d.id IS NULL
         RETURNING id
       )
       SELECT (SELECT COUNT(*) FROM corregidas)::int AS corregidas,
              (SELECT COUNT(*) FROM nuevas)::int AS nuevas`
    ).get(JSON.stringify(datos), capturadaPor);
  }

  return r;
}
