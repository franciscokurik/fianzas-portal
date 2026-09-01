// Las PARTIDAS de un desarrollo: los pedazos de obra que el desarrollador
// contrata por separado. Muros, electricidad, plomería.
//
// Existen ANTES de saber quién las va a hacer, y eso es todo el punto: al montar
// el edificio se sabe qué hace falta mucho antes de saber a quién se le da. Una
// partida sin contratista es un pendiente real, y distinto de "el contratista no
// ha presentado su fianza".
//
// La lógica vive aquí porque entra por DOS puertas —el contratante desde su
// portal y Fortex desde el panel—, igual que services/desarrollos.js. Quien
// autoriza es cada ruta; aquí solo se valida el contenido.
import db from './../db.js';
import { centavos } from '../lib/dinero.js';

function fallo(mensaje, status = 400) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

export const CAMPOS_PARTIDA = ['nombre', 'alcance', 'monto_estimado', 'orden', 'notas'];

function nombreValido(nombre) {
  const limpio = String(nombre || '').trim();
  if (!limpio) throw fallo('El nombre de la partida es obligatorio');
  return limpio;
}

// El orden en que se presentan: primero cimentación, al final acabados. Un
// número raro no debe tumbar la captura, así que cae al 50 de siempre.
//
// El vacío se descarta ANTES de convertir, y ahí estaba el error: Number('') es
// 0, no NaN, así que borrar el campo en el formulario guardaba orden 0 y la
// partida se iba de un salto al principio de la obra. Los acabados aparecían
// antes que la cimentación por haber dejado una casilla en blanco.
//
// null y los espacios en blanco caen igual: Number(null) también es 0.
function ordenValido(orden) {
  if (orden === null || orden === undefined || String(orden).trim() === '') return 50;
  const n = Number(orden);
  return Number.isFinite(n) ? Math.round(n) : 50;
}

// Los tipos de fianza que exige la partida. Se recibe la lista completa y se
// reemplaza: es un conjunto, no un historial, y así el front manda lo que quedó
// marcado en la checklist sin tener que calcular altas y bajas.
//
// Se valida que cada tipo exista en el catálogo. Si se colara uno inventado, la
// partida quedaría exigiendo algo que ninguna póliza puede cumplir y jamás se
// pondría en verde — un incumplimiento eterno por un dato mal capturado.
// La validación va SEPARADA de la escritura, y las dos se llaman en ese orden.
//
// No es estilo: aquí no hay transacciones (el driver es HTTP, ver db.js), así
// que lo que falle después de un INSERT ya no se deshace. Validando adentro,
// un tipo inventado contestaba 400 con la partida YA creada — el operador leía
// "no existe ese tipo" y al desarrollador le aparecía una partida fantasma en su
// proyecto. Se valida primero todo lo que puede fallar, y hasta entonces se
// escribe.
//
// Devuelve null cuando la petición no trae requisitos, que NO es lo mismo que
// traerlos vacíos: null significa "no los toques" y [] significa "no exige
// nada".
async function revisarRequisitos(tipos) {
  if (!Array.isArray(tipos)) return null;

  const ids = [...new Set(tipos.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

  for (const id of ids) {
    const t = await db.prepare('SELECT id FROM tipos_fianza WHERE id = ?').get(id);
    if (!t) throw fallo('Uno de los tipos de fianza que elegiste no existe en el catálogo');
  }
  return ids;
}

async function fijarRequisitos(partidaId, ids) {
  if (ids === null) return;

  await db.prepare('DELETE FROM partida_requisitos WHERE partida_id = ?').run(Number(partidaId));
  for (const tipoId of ids) {
    await db.prepare(
      `INSERT INTO partida_requisitos (partida_id, tipo_fianza_id) VALUES (?, ?)
       ON CONFLICT (partida_id, tipo_fianza_id) DO NOTHING`
    ).run(Number(partidaId), tipoId);
  }
}

export async function crearPartida(desarrolloId, datos = {}) {
  const nombre = nombreValido(datos.nombre);
  // Antes del INSERT, por lo de arriba: si esto truena, no queda nada creado.
  const requisitos = await revisarRequisitos(datos.requisitos);

  const fila = await db.prepare(
    `INSERT INTO partidas (desarrollo_id, nombre, alcance, monto_estimado, orden, notas)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(Number(desarrolloId), nombre,
        datos.alcance || null, centavos(datos.monto_estimado),
        ordenValido(datos.orden), datos.notas || null);

  await fijarRequisitos(fila.id, requisitos);
  return fila;
}

// Solo se escriben los campos que vinieron, para poder vaciar uno mandándolo
// vacío. Los requisitos se reemplazan solo si la petición los trae: mandar la
// partida sin ellos no puede significar "quítale todos los que exige".
export async function actualizarPartida(partidaId, datos = {}) {
  // Igual que en el alta: primero lo que puede fallar. Si no, un tipo inventado
  // dejaba el nombre ya cambiado y contestaba 400.
  const requisitos = await revisarRequisitos(datos.requisitos);

  const sets = [];
  const valores = [];

  for (const campo of CAMPOS_PARTIDA) {
    if (!(campo in datos)) continue;
    let valor = datos[campo];
    if (campo === 'nombre') valor = nombreValido(valor);
    else if (campo === 'monto_estimado') valor = centavos(valor);
    else if (campo === 'orden') valor = ordenValido(valor);
    else if (valor === '') valor = null;

    sets.push(`${campo} = ?`);
    valores.push(valor);
  }

  if (sets.length) {
    await db.prepare(`UPDATE partidas SET ${sets.join(', ')} WHERE id = ?`)
      .run(...valores, Number(partidaId));
  } else if (!('requisitos' in datos)) {
    throw fallo('Nada que actualizar');
  }

  await fijarRequisitos(partidaId, requisitos);
}

// Se niega mientras haya un contrato asignado.
//
// Borrarla con contratos dentro los dejaría sueltos —partida_id es ON DELETE SET
// NULL— y el desarrollador vería su obra fuera de toda partida sin entender por
// qué. Desasignar el contrato es de Fortex, así que el mensaje lo dice.
export async function eliminarPartida(partidaId) {
  const id = Number(partidaId);

  const { c } = await db
    .prepare('SELECT COUNT(*)::int c FROM proyectos WHERE partida_id = ?')
    .get(id);
  if (c > 0) {
    throw fallo(
      `Esa partida tiene ${c} contrato(s) asignado(s). Hay que desasignarlos antes de `
      + 'borrarla (se hace en la obra del proveedor, en el campo "Partida").'
    );
  }

  await db.prepare('DELETE FROM partidas WHERE id = ?').run(id);
}

// Las partidas de un desarrollo con lo que exige cada una, planas. Para llenar
// el selector del panel; el rollup de cumplimiento lo arma
// services/proveedores.js, que es el único que sabe de pólizas.
export async function partidasDe(desarrolloId) {
  const filas = await db.prepare(
    `SELECT p.id, p.nombre, p.alcance, p.monto_estimado, p.orden, p.notas,
            (SELECT COUNT(*)::int FROM proyectos pr WHERE pr.partida_id = p.id) AS total_contratos
     FROM partidas p
     WHERE p.desarrollo_id = ?
     ORDER BY p.orden, p.nombre`
  ).all(Number(desarrolloId));

  return conRequisitos(filas);
}

// Les cuelga a un montón de partidas sus requisitos, en UNA consulta. Con una
// por partida, un desarrollo de veinte pedazos haría veinte viajes a la base
// —que es HTTP sin pool— para pintar una sola pantalla.
export async function conRequisitos(partidas) {
  if (!partidas.length) return partidas;

  const ids = partidas.map((p) => p.id);
  const filas = await db.prepare(
    `SELECT r.partida_id, r.tipo_fianza_id, t.nombre AS tipo_fianza
     FROM partida_requisitos r
     JOIN tipos_fianza t ON t.id = r.tipo_fianza_id
     WHERE r.partida_id IN (${ids.map(() => '?').join(', ')})
     ORDER BY t.orden, t.nombre`
  ).all(...ids);

  const porPartida = new Map();
  for (const f of filas) {
    if (!porPartida.has(f.partida_id)) porPartida.set(f.partida_id, []);
    porPartida.get(f.partida_id).push({
      tipo_fianza_id: f.tipo_fianza_id,
      tipo_fianza: f.tipo_fianza,
    });
  }

  return partidas.map((p) => ({ ...p, requisitos: porPartida.get(p.id) || [] }));
}
