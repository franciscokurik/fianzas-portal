// Dar de baja una empresa fiada.
//
// Esto se lleva TODO su historial: proyectos, pólizas, expediente, papelería,
// accesos y los archivos en Cloudinary. No hay deshacer, así que la ruta exige
// que se teclee la razón social antes de llamar aquí.
import db from '../db.js';
import { borrarArchivo } from '../lib/upload.js';

export async function eliminarCliente(clientId) {
  const id = Number(clientId);

  // Las URLs se juntan ANTES de tocar los registros: en cuanto se borren las
  // filas no queda de dónde sacarlas y los archivos se quedarían para siempre
  // en la cuenta de Cloudinary, comiéndose la cuota sin que nadie los apunte.
  const deColumna = async (sql) => (await db.prepare(sql).all(id)).map((f) => f.archivo).filter(Boolean);
  const archivos = [
    ...(await deColumna('SELECT url AS archivo FROM documentos WHERE client_id = ?')),
    // Y los que colgó ALGUIEN MÁS de sus obras: desde que un contratante puede
    // subir la fianza que le entregó su proveedor, hay filas de 'documentos'
    // cuyo client_id es el contratante pero cuya entidad es una obra de ESTE
    // cliente. La tabla es polimórfica, así que borrar el proyecto no se las
    // lleva: sin esto quedan apuntando a un proyecto que ya no existe, y sus
    // archivos se quedan para siempre en Cloudinary comiéndose la cuota.
    ...(await deColumna(
      `SELECT d.url AS archivo FROM documentos d
       JOIN proyectos p ON p.id = d.entidad_id AND d.entidad_tipo = 'proyecto'
       WHERE p.client_id = ? AND d.client_id <> p.client_id`
    )),
    ...(await deColumna('SELECT file_path AS archivo FROM client_documents WHERE client_id = ?')),
    ...(await deColumna('SELECT file_path AS archivo FROM papeleria_requests WHERE client_id = ?')),
  ];

  const contar = async (tabla) =>
    (await db.prepare(`SELECT COUNT(*)::int AS c FROM ${tabla} WHERE client_id = ?`).get(id)).c;
  const borrado = {
    proyectos: await contar('proyectos'),
    fianzas: await contar('fianzas'),
    // Se van con sus pólizas (CASCADE). Se cuentan para que el resumen lo diga:
    // es lo único de la lista que no es del cliente sino lo que cobró Fortex.
    comisiones: (await db.prepare(
      `SELECT COUNT(*)::int AS c FROM comisiones
       WHERE fianza_id IN (SELECT id FROM fianzas WHERE client_id = ?)`
    ).get(id)).c,
    usuarios: await contar('users'),
    archivos: archivos.length,
    // Cuántos padrones lo dejan de tener como proveedor, y cuántas obras de
    // TERCEROS quedan sin contratante. Son los dos números del resumen que
    // hablan de datos que no son de este cliente, y por eso los que más
    // conviene ver antes de apretar.
    padrones_de_los_que_sale: (await db.prepare(
      'SELECT COUNT(*)::int AS c FROM client_proveedores WHERE proveedor_id = ?'
    ).get(id)).c,
    obras_desligadas: (await db.prepare(
      'SELECT COUNT(*)::int AS c FROM proyectos WHERE contratante_id = ? AND client_id <> ?'
    ).get(id, id)).c,
  };

  // El orden importa: fianzas.proyecto_id es ON DELETE RESTRICT, así que si se
  // dejara todo al CASCADE de clients, Postgres podría intentar borrar el
  // proyecto antes que sus fianzas y abortar a media faena. Se va de abajo
  // hacia arriba; el resto (accesos, líneas, expediente, papelería, avisos)
  // sí cae solo por CASCADE.
  // Primero los documentos que otro colgó de sus obras: tienen que irse ANTES
  // que los proyectos, porque después ya no hay por dónde encontrarlos (la tabla
  // es polimórfica: no hay llave foránea sobre entidad_id que los limpie sola).
  await db.prepare(
    `DELETE FROM documentos WHERE id IN (
       SELECT d.id FROM documentos d
       JOIN proyectos p ON p.id = d.entidad_id AND d.entidad_tipo = 'proyecto'
       WHERE p.client_id = ?
     )`
  ).run(id);

  await db.prepare('DELETE FROM fianzas   WHERE client_id = ?').run(id);
  await db.prepare('DELETE FROM proyectos WHERE client_id = ?').run(id);
  await db.prepare('DELETE FROM clients   WHERE id = ?').run(id);

  // Al final los archivos. Si alguno falla queda registrado en el log y no
  // pasa nada más: el registro que lo apuntaba ya no existe.
  for (const url of archivos) await borrarArchivo(url);

  return borrado;
}
