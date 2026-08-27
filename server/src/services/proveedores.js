// El padrón de proveedores de un contratante y su cumplimiento.
//
// Un contratante (un desarrollador como Desarrollos Delta) no compra fianzas:
// las EXIGE. Lo único que necesita del portal es una respuesta, por proveedor y
// por obra: ¿está cubierto hoy o no?
//
// LA REGLA QUE ATRAVIESA TODO ESTE ARCHIVO: aquí se consulta lo mínimo. La
// prima —lo que el proveedor le paga a la afianzadora—, su línea de crédito, su
// expediente y los recordatorios internos de Fortex no se seleccionan. Y no es
// que se pidan y luego se borren del objeto antes de responder: no se piden
// nunca. El contratante es OTRA EMPRESA, y lo que se filtre por aquí no es
// información de más sobre uno mismo, son los números de un tercero.
//
// La prueba que fija esto es server/test/contratantes.test.js, y no revisa
// campos sueltos: revisa que NINGUNA llave de la respuesta esté fuera de una
// lista blanca. Así el día que alguien agregue una columna a 'fianzas', se
// entera aquí y no en la pantalla de un cliente.
import db from '../db.js';
import { estadoCumplimiento, daysUntil } from '../lib/dates.js';
import { ALCANCE, JOIN_PADRON, SQL_DOCS_DEL_CONTRATANTE } from '../lib/permisos.js';

const SQL_PADRON = `
  SELECT cp.proveedor_id AS id, c.razon_social, c.rfc, cp.alias, cp.notas, cp.created_at
  FROM client_proveedores cp
  JOIN clients c ON c.id = cp.proveedor_id
  WHERE cp.contratante_id = ? AND cp.activo = 1
  ORDER BY c.razon_social`;

const SQL_OBRAS = `
  SELECT p.id, p.client_id, p.nombre, p.numero_contrato, p.monto_contrato,
         p.fecha_inicio, p.fecha_termino, p.estatus
  FROM proyectos p
  ${JOIN_PADRON}
  WHERE ${ALCANCE}
  ORDER BY p.nombre`;

// Sin prima_neta, sin prima_total, sin fecha_recordatorio ni nota_recordatorio.
const SQL_FIANZAS = `
  SELECT f.id, f.client_id, f.proyecto_id, f.clase, f.numero_poliza,
         f.monto_afianzado, f.fecha_inicio, f.fecha_vigencia,
         a.nombre AS afianzadora_nombre, t.nombre AS tipo_fianza
  FROM fianzas f
  JOIN proyectos p    ON p.id = f.proyecto_id
  ${JOIN_PADRON}
  JOIN afianzadoras a ON a.id = f.afianzadora_id
  LEFT JOIN tipos_fianza t ON t.id = f.tipo_fianza_id
  WHERE ${ALCANCE}
  ORDER BY f.fecha_vigencia`;

// Solo los papeles que acreditan la garantía (la lista blanca vive en
// lib/permisos.js, junto con la puerta de descarga: una sola lista, dos usos).
// Y sin la URL: la descarga pasa por la API, que vuelve a comprobar el alcance.
const SQL_DOCUMENTOS = `
  SELECT d.id, d.entidad_id, d.tipo_doc, d.nombre_archivo, d.size_bytes, d.subido_el
  FROM documentos d
  JOIN fianzas f   ON f.id = d.entidad_id AND d.entidad_tipo = 'fianza'
  JOIN proyectos p ON p.id = f.proyecto_id
  ${JOIN_PADRON}
  WHERE ${ALCANCE}
    AND d.tipo_doc IN (${SQL_DOCS_DEL_CONTRATANTE})`;

// Las obras que todavía se juzgan. Una obra cerrada o cancelada no necesita
// cobertura, y exigírsela llenaría la pantalla del desarrollador de rojos de
// hace tres años. Se siguen listando; nada más no cuentan para el cumplimiento.
// 'terminado' y 'entregado' SÍ cuentan: ahí es donde vive la fianza de vicios
// ocultos, que es justo la que se olvida.
const ESTATUS_VIVOS = ['en_proceso', 'terminado', 'entregado'];
export const obraViva = (estatus) => ESTATUS_VIVOS.includes(estatus);

// Las obras que hoy NO están respaldadas. 'sin_vigencia' entra aquí a propósito:
// una fianza a la que nadie le capturó hasta cuándo cubre no se puede dar por
// buena, aunque el problema sea de captura y no del proveedor. Se distinguen
// para que cada uno lo arregle donde le toca.
const DESCUBIERTA = ['sin_fianza', 'vencida', 'sin_vigencia'];
export const obraDescubierta = (estado) => DESCUBIERTA.includes(estado);

// De mejor a peor. El cumplimiento de un proveedor es el de su PEOR obra viva:
// tener una obra cubierta no arregla la que está descubierta.
const DE_MEJOR_A_PEOR = ['cubierta', 'por_vencer', 'sin_vigencia', 'vencida', 'sin_fianza'];

// ¿Está cubierta esta obra, hoy?
//   'cubierta'     -> hay al menos una fianza emitida y vigente
//   'por_vencer'   -> la cobertura vigente vence en 30 días o menos
//   'sin_vigencia' -> hay fianza, pero sin fecha de vigencia capturada
//   'vencida'      -> hubo fianza, pero hoy ninguna está vigente
//   'sin_fianza'   -> no hay ninguna fianza emitida
//
// Un previo no cubre nada: es lo que se cotizó y la afianzadora todavía no
// emite. Se le muestra al contratante marcado, para que sepa que el trámite ya
// va, pero una obra con puros previos está descubierta.
export function estadoDeObra(fianzas) {
  const emitidas = fianzas.filter((f) => f.clase !== 'previo');
  if (!emitidas.length) return 'sin_fianza';

  const vigentes = emitidas.filter((f) => f.estado === 'activa' || f.estado === 'por_vencer');
  if (!vigentes.length) {
    // Distinguir "se venció" de "nunca se capturó la fecha": lo primero es del
    // proveedor y lo segundo de Fortex, y se arreglan en lugares distintos.
    return emitidas.some((f) => f.estado === 'sin_vigencia') ? 'sin_vigencia' : 'vencida';
  }

  return vigentes.some((f) => f.estado === 'por_vencer') ? 'por_vencer' : 'cubierta';
}

const peorDe = (estados) =>
  estados.reduce(
    (peor, e) => (DE_MEJOR_A_PEOR.indexOf(e) > DE_MEJOR_A_PEOR.indexOf(peor) ? e : peor),
    'cubierta'
  );

// Todo lo que un contratante alcanza, de una vez: su padrón, las obras ligadas
// a él y las fianzas de esas obras.
//
// Cuatro consultas y el armado en JavaScript, en vez de una consulta por
// proveedor: un desarrollador con cuarenta proveedores haría cuarenta viajes a
// la base para pintar una sola pantalla, y el driver de Neon es HTTP sin pool
// (cada consulta es un viaje de verdad).
//
// El detalle de un proveedor sale de aquí mismo, filtrando: así el WHERE que
// define el alcance vive en UN solo lugar. Cuesta traer de más en esa pantalla
// —son cientos de renglones, no miles— y a cambio no hay un segundo sitio donde
// equivocarse al acotar.
export async function panoramaDelContratante(contratanteId) {
  const id = Number(contratanteId);

  const padron = await db.prepare(SQL_PADRON).all(id);
  const obrasRows = await db.prepare(SQL_OBRAS).all(id);
  const fianzasRows = await db.prepare(SQL_FIANZAS).all(id);
  const docsRows = await db.prepare(SQL_DOCUMENTOS).all(id);

  const docsPorFianza = new Map();
  for (const d of docsRows) {
    if (!docsPorFianza.has(d.entidad_id)) docsPorFianza.set(d.entidad_id, []);
    docsPorFianza.get(d.entidad_id).push(d);
  }

  const fianzas = fianzasRows.map((f) => ({
    ...f,
    // El previo no tiene vigencia que juzgar: sus fechas son las estimadas de
    // la solicitud. Su estado ES ser previo (igual que en el portal del fiado).
    estado: f.clase === 'previo' ? 'previo' : estadoCumplimiento(f.fecha_vigencia),
    dias_para_vencer: f.clase === 'previo' ? null : daysUntil(f.fecha_vigencia),
    documentos: docsPorFianza.get(f.id) || [],
  }));

  const obras = obrasRows.map((o) => {
    const suyas = fianzas.filter((f) => f.proyecto_id === o.id);
    const emitidas = suyas.filter((f) => f.clase !== 'previo');
    return {
      ...o,
      viva: obraViva(o.estatus),
      fianzas: suyas,
      total_previos: suyas.length - emitidas.length,
      estado_cobertura: estadoDeObra(suyas),
      // Lo que cubren las fianzas que siguen vigentes. Es la cifra que el
      // desarrollador quiere: cuánto tiene respaldado hoy, no cuánto tuvo.
      monto_afianzado: emitidas
        .filter((f) => f.estado === 'activa' || f.estado === 'por_vencer')
        .reduce((s, f) => s + (f.monto_afianzado || 0), 0),
    };
  });

  const proveedores = padron.map((prov) => {
    const suyas = obras.filter((o) => o.client_id === prov.id);
    const vivas = suyas.filter((o) => o.viva);
    return {
      ...prov,
      total_obras: suyas.length,
      obras_vivas: vivas.length,
      obras_descubiertas: vivas.filter((o) => obraDescubierta(o.estado_cobertura)).length,
      total_fianzas: suyas.reduce(
        (s, o) => s + o.fianzas.filter((f) => f.clase !== 'previo').length, 0
      ),
      total_previos: suyas.reduce((s, o) => s + o.total_previos, 0),
      // Solo las obras vivas, igual que la métrica de abajo. Si aquí se sumaran
      // todas, el renglón del proveedor diría "$5,000 afianzado" y el total de
      // la pantalla "$0", porque ese afianzado venía de una obra ya cerrada.
      monto_afianzado: vivas.reduce((s, o) => s + o.monto_afianzado, 0),
      // Tres cosas distintas que no hay que confundir en la pantalla:
      //   'sin_obra'        -> está en el padrón y NADIE le ha ligado una obra.
      //                        No es incumplimiento: es captura que falta.
      //   'sin_obras_vivas' -> tuvo obras con este contratante y todas están
      //                        cerradas o canceladas. Tampoco es incumplimiento:
      //                        ya no hay cobertura que exigir.
      //   lo demás          -> el estado de su PEOR obra viva.
      cumplimiento: vivas.length
        ? peorDe(vivas.map((o) => o.estado_cobertura))
        : (suyas.length ? 'sin_obras_vivas' : 'sin_obra'),
    };
  });

  const vivas = obras.filter((o) => o.viva);
  const metricas = {
    proveedores: proveedores.length,
    obras_vivas: vivas.length,
    obras_cubiertas: vivas.filter((o) => o.estado_cobertura === 'cubierta').length,
    obras_por_vencer: vivas.filter((o) => o.estado_cobertura === 'por_vencer').length,
    obras_descubiertas: vivas.filter((o) => obraDescubierta(o.estado_cobertura)).length,
    proveedores_en_falta: proveedores.filter((p) => p.obras_descubiertas > 0).length,
    // La cobertura vigente a favor de este contratante, sumando sus obras vivas.
    monto_afianzado: vivas.reduce((s, o) => s + o.monto_afianzado, 0),
    // Vivas también: un previo colgado de una obra que ya se cerró no es un
    // trámite que alguien esté esperando.
    previos_en_tramite: vivas.reduce((s, o) => s + o.total_previos, 0),
  };

  return { proveedores, obras, metricas };
}
