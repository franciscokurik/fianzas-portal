// Expediente del fiado (tabla client_documents): CSF, estados financieros,
// acta constitutiva, poder notarial…
//
// Vive aquí y no dentro de una ruta porque hay DOS puertas al mismo lugar: el
// fiado sube sus papeles desde su portal, y Fortex los carga en su nombre
// cuando llegan por correo a Home Office. Las dos deben dejar el registro
// exactamente igual, cambiando solo quién aparece como quien lo subió.
import db from '../db.js';
import { subirArchivo, borrarArchivo } from '../lib/upload.js';
import { addMonths, todayISO } from '../lib/dates.js';

// El manejador de errores de app.js respeta err.status, así que los fallos de
// negocio se lanzan y no se devuelven: la ruta no tiene que traducirlos.
function fallo(mensaje, status) {
  const e = new Error(mensaje);
  e.status = status;
  return e;
}

// Guarda el documento vigente de un tipo, reemplazando el anterior si había.
export async function guardarDocumentoCliente({ clientId, typeId, file, subidoPor = 'cliente' }) {
  const tipo = await db.prepare('SELECT * FROM document_types WHERE id = ?').get(typeId);
  if (!tipo) throw fallo('Tipo de documento no válido', 404);
  if (!file) throw fallo('No se recibió archivo', 400);

  const hoy = todayISO();
  const vencimiento = tipo.periodicidad_meses ? addMonths(hoy, tipo.periodicidad_meses) : null;

  const previo = await db
    .prepare('SELECT file_path FROM client_documents WHERE client_id = ? AND document_type_id = ?')
    .get(clientId, typeId);

  // Primero se sube el nuevo y hasta el final se borra el viejo: si la subida
  // falla a medias, el fiado se queda con el documento que ya tenía en vez de
  // quedarse sin ninguno.
  const url = await subirArchivo(file, clientId);

  await db.prepare(
    `INSERT INTO client_documents
       (client_id, document_type_id, file_path, original_name, mime_type,
        size_bytes, uploaded_at, vencimiento, subido_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(client_id, document_type_id) DO UPDATE SET
       file_path = excluded.file_path,
       original_name = excluded.original_name,
       mime_type = excluded.mime_type,
       size_bytes = excluded.size_bytes,
       uploaded_at = excluded.uploaded_at,
       vencimiento = excluded.vencimiento,
       subido_por = excluded.subido_por`
  ).run(
    clientId, typeId, url, file.originalname, file.mimetype,
    file.size, hoy, vencimiento, subidoPor,
  );

  if (previo?.file_path && previo.file_path !== url) await borrarArchivo(previo.file_path);

  return { vencimiento, tipo: tipo.nombre };
}

// Quita el documento y su archivo. El tipo sigue apareciendo como pendiente.
export async function borrarDocumentoCliente({ clientId, typeId }) {
  const doc = await db
    .prepare('SELECT file_path FROM client_documents WHERE client_id = ? AND document_type_id = ?')
    .get(clientId, typeId);
  if (!doc) throw fallo('El cliente no tiene cargado ese documento', 404);

  await db
    .prepare('DELETE FROM client_documents WHERE client_id = ? AND document_type_id = ?')
    .run(clientId, typeId);
  await borrarArchivo(doc.file_path); // si esto falla, ya no hay registro que lo apunte
}
