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
    ...(await deColumna('SELECT file_path AS archivo FROM client_documents WHERE client_id = ?')),
    ...(await deColumna('SELECT file_path AS archivo FROM papeleria_requests WHERE client_id = ?')),
  ];

  const contar = async (tabla) =>
    (await db.prepare(`SELECT COUNT(*)::int AS c FROM ${tabla} WHERE client_id = ?`).get(id)).c;
  const borrado = {
    proyectos: await contar('proyectos'),
    fianzas: await contar('fianzas'),
    usuarios: await contar('users'),
    archivos: archivos.length,
  };

  // El orden importa: fianzas.proyecto_id es ON DELETE RESTRICT, así que si se
  // dejara todo al CASCADE de clients, Postgres podría intentar borrar el
  // proyecto antes que sus fianzas y abortar a media faena. Se va de abajo
  // hacia arriba; el resto (accesos, líneas, expediente, papelería, avisos)
  // sí cae solo por CASCADE.
  await db.prepare('DELETE FROM fianzas   WHERE client_id = ?').run(id);
  await db.prepare('DELETE FROM proyectos WHERE client_id = ?').run(id);
  await db.prepare('DELETE FROM clients   WHERE id = ?').run(id);

  // Al final los archivos. Si alguno falla queda registrado en el log y no
  // pasa nada más: el registro que lo apuntaba ya no existe.
  for (const url of archivos) await borrarArchivo(url);

  return borrado;
}
