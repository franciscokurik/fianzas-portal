// Los PROYECTOS del contratante: el desarrollo completo (una torre, un
// fraccionamiento) con el que un desarrollador agrupa a sus proveedores.
//
// La lógica vive aquí y no en una ruta porque entra por DOS puertas: el
// contratante los registra desde su portal —es lo que pidió— y Fortex los
// captura en su nombre desde el panel, que es lo que pasa al dar de alta la
// cuenta, antes de que el desarrollador entre por primera vez. Es el mismo
// arreglo que documentos-cliente.js.
//
// Quien autoriza es cada ruta: el portal contra exigirDesarrollo (el proyecto
// tiene que ser suyo) y el panel contra exigirCliente (el contratante tiene que
// estar a su alcance). Aquí solo se valida el CONTENIDO.
import db from './../db.js';
import { centavos } from '../lib/dinero.js';
import { ALCANCE, JOIN_PADRON } from '../lib/permisos.js';

function fallo(mensaje, status = 400) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Los campos que se capturan de un proyecto.
export const CAMPOS_DESARROLLO = ['nombre', 'clave', 'ubicacion', 'monto_inversion',
                                  'fecha_inicio', 'fecha_termino', 'estatus', 'notas'];

// El mismo vocabulario que el estatus de una obra, para que las dos pantallas
// pinten la etiqueta con la misma función. Aquí SÍ se valida —la tabla es
// nueva— aunque proyectos.estatus no lo haga: eso es deuda de antes, no una
// razón para repetirla.
export const ESTATUS_DESARROLLO = ['en_proceso', 'terminado', 'entregado', 'cerrado', 'cancelado'];

function estatusValido(estatus) {
  if (estatus == null || estatus === '') return 'en_proceso';
  if (!ESTATUS_DESARROLLO.includes(estatus)) throw fallo('Ese estatus no es válido');
  return estatus;
}

function nombreValido(nombre) {
  const limpio = String(nombre || '').trim();
  if (!limpio) throw fallo('El nombre del proyecto es obligatorio');
  return limpio;
}

export async function crearDesarrollo(contratanteId, datos = {}) {
  const nombre = nombreValido(datos.nombre);
  const estatus = estatusValido(datos.estatus);

  return db.prepare(
    `INSERT INTO desarrollos (contratante_id, nombre, clave, ubicacion, monto_inversion,
                              fecha_inicio, fecha_termino, estatus, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(Number(contratanteId), nombre,
        datos.clave || null, datos.ubicacion || null,
        centavos(datos.monto_inversion),
        datos.fecha_inicio || null, datos.fecha_termino || null,
        estatus, datos.notas || null);
}

// Solo se escriben los campos que vinieron, para poder vaciar uno mandándolo
// vacío (a diferencia de un COALESCE, que no deja borrar nada).
export async function actualizarDesarrollo(desarrolloId, datos = {}) {
  const sets = [];
  const valores = [];

  for (const campo of CAMPOS_DESARROLLO) {
    if (!(campo in datos)) continue;
    let valor = datos[campo];
    if (campo === 'nombre') valor = nombreValido(valor);
    else if (campo === 'estatus') valor = estatusValido(valor);
    else if (campo === 'monto_inversion') valor = centavos(valor);
    else if (valor === '') valor = null;

    sets.push(`${campo} = ?`);
    valores.push(valor);
  }

  if (!sets.length) throw fallo('Nada que actualizar');
  await db.prepare(`UPDATE desarrollos SET ${sets.join(', ')} WHERE id = ?`)
    .run(...valores, Number(desarrolloId));
}

// Se niega mientras haya obras adentro.
//
// Borrarlo con obras las dejaría sueltas —desarrollo_id es ON DELETE SET NULL—
// y el contratante perdería de vista sus propios documentos por obra sin
// entender por qué. Sacar la obra del proyecto es de Fortex, así que el
// mensaje lo dice.
export async function eliminarDesarrollo(desarrolloId, contratanteId) {
  const id = Number(desarrolloId);

  // El conteo lleva el MISMO alcance que la pantalla (JOIN_PADRON + ALCANCE).
  // Sin eso contaba obras de proveedores suspendidos —que el contratante no ve
  // por ningún lado— y el borrado se negaba con un número que la pantalla acaba
  // de decir que es cero.
  const { c } = await db
    .prepare(
      `SELECT COUNT(*)::int c FROM proyectos p
       ${JOIN_PADRON}
       WHERE p.desarrollo_id = ? AND ${ALCANCE}`
    )
    .get(id, Number(contratanteId));
  if (c > 0) {
    throw fallo(
      `Ese proyecto tiene ${c} obra(s) de proveedores adentro. Hay que sacarlas antes de `
      + 'borrarlo (se hace en la obra, en el campo "Proyecto del contratante").'
    );
  }

  await db.prepare('DELETE FROM desarrollos WHERE id = ?').run(id);
}

// Los proyectos de un contratante, planos. Para llenar el selector del panel:
// el rollup completo lo arma services/proveedores.js.
export async function desarrollosDe(contratanteId) {
  return db.prepare(
    `SELECT d.id, d.nombre, d.clave, d.estatus,
            (SELECT COUNT(*)::int FROM proyectos p WHERE p.desarrollo_id = d.id) AS total_obras
     FROM desarrollos d
     WHERE d.contratante_id = ?
     ORDER BY d.estatus, d.nombre`
  ).all(Number(contratanteId));
}
