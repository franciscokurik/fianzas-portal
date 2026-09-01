// El portal del CONTRATANTE: el desarrollador que no compra fianzas, las exige.
//
// Es el hermano de routes/dashboard.js + routes/fianzas.js, pero para la otra
// clase de empresa (clients.tipo = 'contratante'). Lo que ve de cada proveedor
// lo acota el servicio, y lo poco que se descarga vuelve a comprobarse en
// lib/permisos.js.
//
// Casi todo aquí es de lectura. Lo único que escribe es su propia carpeta de
// documentos por obra: la fianza que el proveedor le entregó en papel, su
// contrato con él. Y esos archivos son SUYOS —viven bajo su client_id y su
// prefijo de Cloudinary—, no del proveedor: por eso no hace falta aflojar la
// regla del prefijo, que es lo único que impide que un cliente le cuelgue
// archivos a otro.
import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireContratante } from '../auth/middleware.js';
import {
  exigirProveedor, exigirObraDelContratante, exigirDesarrollo, exigirPartida,
  urlDeDocumentoParaContratante,
} from '../lib/permisos.js';
import { panoramaDelContratante } from '../services/proveedores.js';
import {
  crearDesarrollo, actualizarDesarrollo, eliminarDesarrollo,
} from '../services/desarrollos.js';
import { crearPartida, actualizarPartida, eliminarPartida } from '../services/partidas.js';
import { adoptarArchivo } from '../services/subidas.js';
import { borrarArchivo } from '../lib/upload.js';
import {
  nombreTipoDoc, TIPOS_DOC_CONTRATANTE, esTipoDeContratante, nombreTipoDocContratante,
} from '../lib/documentos.js';

const router = Router();

// Le pone nombre legible al tipo de documento, igual que en el portal del fiado.
const conNombres = (documentos = []) =>
  documentos.map((d) => ({ ...d, tipo_doc_nombre: nombreTipoDoc('fianza', d.tipo_doc) }));

const conNombresPropios = (documentos = []) =>
  documentos.map((d) => ({ ...d, tipo_doc_nombre: nombreTipoDocContratante(d.tipo_doc) }));

// Las obras van con los dos juegos de documentos ya nombrados.
const paraElFront = (obras) => obras.map((o) => ({
  ...o,
  fianzas: o.fianzas.map((f) => ({ ...f, documentos: conNombres(f.documentos) })),
  mis_documentos: conNombresPropios(o.mis_documentos),
}));

// GET /api/proveedores/tipos-fianza -> el catálogo, para que el contratante
// marque qué exige cada partida.
//
// Es el MISMO catálogo que usan las pólizas (tipos_fianza): si fuera otra lista,
// una partida podría exigir algo que ninguna póliza puede cumplir.
router.get('/tipos-fianza', requireAuth, requireContratante, async (req, res) => {
  const tipos = await db
    .prepare('SELECT id, nombre FROM tipos_fianza WHERE activo = 1 ORDER BY orden, nombre')
    .all();
  res.json({ tipos });
});

// GET /api/proveedores/tipos-documento -> qué puede subir el contratante
router.get('/tipos-documento', requireAuth, requireContratante, (req, res) => {
  res.json({ tipos: TIPOS_DOC_CONTRATANTE });
});

// GET /api/proveedores -> el padrón con el cumplimiento de cada proveedor
router.get('/', requireAuth, requireContratante, async (req, res) => {
  const contratanteId = req.user.client_id;

  const empresa = await db
    .prepare('SELECT razon_social FROM clients WHERE id = ?')
    .get(contratanteId);
  if (!empresa) return res.status(404).json({ error: 'Cliente no encontrado' });

  // Sin las obras: la pantalla del padrón solo pinta el renglón de cada
  // proveedor y sus cifras, y las obras se piden al abrirlo (GET /:id). Mandarlas
  // aquí era casi el 90% del peso de la respuesta viajando para que nadie la
  // leyera — con cuarenta proveedores, la parte más gorda.
  const { proveedores, metricas } = await panoramaDelContratante(contratanteId);

  res.json({ razon_social: empresa.razon_social, metricas, proveedores });
});

// --- Los PROYECTOS del contratante (sus desarrollos) ---
//
// Esto es lo único que el contratante crea y edita en el portal. Es suyo: el
// desarrollo completo, con el que agrupa a los proveedores que van adentro.
//
// Lo que NO puede hacer es asignarse proveedores: eso lo hace Fortex, porque
// ligarle la obra de una empresa a su proyecto le abre las pólizas de esa
// empresa y no se deshace.

// GET /api/proveedores/proyectos -> sus proyectos con el rollup de cada uno
router.get('/proyectos', requireAuth, requireContratante, async (req, res) => {
  const { proyectos, obrasSinProyecto, metricas } = await panoramaDelContratante(req.user.client_id);
  res.json({
    proyectos,
    // Las obras que Fortex ya le ligó pero que todavía no están dentro de
    // ninguno de sus proyectos. Se dicen para que no se pierdan de vista.
    obras_sin_proyecto: paraElFront(obrasSinProyecto),
    metricas,
  });
});

// POST /api/proveedores/proyectos -> registra un proyecto
router.post('/proyectos', requireAuth, requireContratante, async (req, res) => {
  const fila = await crearDesarrollo(req.user.client_id, req.body || {});
  res.json({ ok: true, id: fila.id });
});

// PUT /api/proveedores/proyectos/:id
router.put('/proyectos/:id', requireAuth, requireContratante, async (req, res) => {
  const id = await exigirDesarrollo(req.user.client_id, req.params.id);
  await actualizarDesarrollo(id, req.body || {});
  res.json({ ok: true });
});

// DELETE /api/proveedores/proyectos/:id
//
// Se niega mientras haya obras adentro. Borrarlo con obras las dejaría sueltas
// (desarrollo_id es ON DELETE SET NULL) y el contratante perdería de vista sus
// propios documentos por obra sin entender por qué. Primero se saca la obra,
// y eso lo hace Fortex.
router.delete('/proyectos/:id', requireAuth, requireContratante, async (req, res) => {
  const id = await exigirDesarrollo(req.user.client_id, req.params.id);
  await eliminarDesarrollo(id, req.user.client_id);
  res.json({ ok: true });
});

// --- Las PARTIDAS de un proyecto ---
//
// Los pedazos de obra que el desarrollador contrata por separado, con lo que
// exige cada uno. Las captura él —es su plan— y Fortex por la misma puerta.
//
// Lo que NO puede hacer es asignarles el contratista: eso es de Fortex, porque
// ligar la obra de una empresa le abre sus pólizas y no se deshace.

// POST /api/proveedores/proyectos/:id/partidas
router.post('/proyectos/:id/partidas', requireAuth, requireContratante, async (req, res) => {
  const desarrolloId = await exigirDesarrollo(req.user.client_id, req.params.id);
  const fila = await crearPartida(desarrolloId, req.body || {});
  res.json({ ok: true, id: fila.id });
});

router.put('/partidas/:id', requireAuth, requireContratante, async (req, res) => {
  const id = await exigirPartida(req.user.client_id, req.params.id);
  await actualizarPartida(id, req.body || {});
  res.json({ ok: true });
});

router.delete('/partidas/:id', requireAuth, requireContratante, async (req, res) => {
  const id = await exigirPartida(req.user.client_id, req.params.id);
  await eliminarPartida(id);
  res.json({ ok: true });
});

// GET /api/proveedores/proyectos/:id -> el proyecto, organizado POR PARTIDA
//
// Por partida y no por proveedor a propósito: la partida es el pedazo de obra, y
// existe aunque nadie la esté haciendo. Agrupando por proveedor, una partida sin
// contratista no tendría dónde aparecer — y es justo el pendiente que hay que
// ver. El padrón sigue siendo la vista por empresa.
router.get('/proyectos/:id', requireAuth, requireContratante, async (req, res) => {
  const contratanteId = req.user.client_id;
  const id = await exigirDesarrollo(contratanteId, req.params.id);

  const { proyectos, proveedores } = await panoramaDelContratante(contratanteId);
  const proyecto = proyectos.find((p) => p.id === id);

  // El nombre del proveedor se le pega a cada contrato: la obra trae su
  // client_id, y sin esto la pantalla no tendría cómo decir de quién es.
  const nombreDe = (clientId) =>
    proveedores.find((p) => p.id === clientId)?.razon_social || 'Proveedor';
  const conProveedor = (obras) =>
    paraElFront(obras).map((o) => ({ ...o, proveedor_nombre: nombreDe(o.client_id) }));

  res.json({
    proyecto: {
      ...proyecto,
      partidas: (proyecto?.partidas || []).map((pa) => ({
        ...pa,
        contratos: conProveedor(pa.contratos || []),
      })),
      obras_sin_partida: conProveedor(proyecto?.obras_sin_partida || []),
      // El consumo trae proveedor_id; se le pega el nombre aquí para no tener
      // que mandar el padrón entero solo para resolver cuatro renglones.
      consumo: (proyecto?.consumo || []).map((c) => ({
        ...c,
        proveedor_nombre: nombreDe(c.proveedor_id),
      })),
    },
  });
});

// GET /api/proveedores/:id -> las obras que ese proveedor ejecuta PARA MÍ,
// con sus fianzas. Nada de sus otras obras, ni de su expediente, ni sus primas.
router.get('/:id(\\d+)', requireAuth, requireContratante, async (req, res) => {
  const contratanteId = req.user.client_id;
  const proveedorId = Number(req.params.id);

  // Que esté en el padrón. Si no, 404: decir "existe pero no es tuyo" ya le
  // confirmaría a quien va probando ids que esa empresa es cliente de Fortex.
  await exigirProveedor(contratanteId, proveedorId);

  const { proveedores, obras } = await panoramaDelContratante(contratanteId);
  const proveedor = proveedores.find((p) => p.id === proveedorId);

  res.json({
    proveedor,
    obras: paraElFront(obras.filter((o) => o.client_id === proveedorId)),
  });
});

// POST /api/proveedores/obras/:obraId/documentos  { public_id, nombre, tipo_doc }
//
// El archivo ya está en Cloudinary: el navegador lo subió directo con la firma
// de /api/subidas/firma, que solo se la da para SU propio client_id. Aquí llega
// dónde quedó, y se comprueba lo que falta: que la obra esté en su alcance y que
// el tipo de documento sea uno de los suyos.
//
// Lo barato primero —el tipo, la obra— porque cuando esta petición llega el
// archivo YA está subido, y cada rechazo tardío deja basura en Cloudinary.
router.post('/obras/:obraId/documentos', requireAuth, requireContratante, async (req, res) => {
  const contratanteId = req.user.client_id;
  const tipoDoc = req.body?.tipo_doc || 'otro_contratante';

  if (!esTipoDeContratante(tipoDoc)) {
    return res.status(400).json({ error: 'Ese tipo de documento no es válido aquí' });
  }
  await exigirObraDelContratante(contratanteId, req.params.obraId);

  const archivo = await adoptarArchivo({
    publicId: req.body?.public_id,
    // El DUEÑO del archivo es el contratante, no el proveedor de la obra: es su
    // copia, vive en su carpeta y se va con él si se da de baja su cuenta.
    clientId: contratanteId,
    nombre: req.body?.nombre,
  });

  const row = await db.prepare(
    `INSERT INTO documentos
       (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo, size_bytes, subido_por)
     VALUES (?, 'proyecto', ?, ?, ?, ?, ?, 'contratante') RETURNING id`
  ).get(contratanteId, Number(req.params.obraId), tipoDoc,
        archivo.url, archivo.nombre, archivo.bytes);

  res.json({ ok: true, id: row.id });
});

// DELETE /api/proveedores/documentos/:id -> quita uno de los SUYOS
//
// El d.client_id del WHERE es lo que importa: el contratante solo puede borrar
// lo que está en su carpeta. Los papeles de la garantía son del proveedor y no
// se tocan desde aquí, aunque los alcance para leerlos.
router.delete('/documentos/:id(\\d+)', requireAuth, requireContratante, async (req, res) => {
  const doc = await db.prepare(
    `SELECT d.id, d.url
     FROM documentos d
     WHERE d.id = ? AND d.client_id = ? AND d.entidad_tipo = 'proyecto'`
  ).get(Number(req.params.id), req.user.client_id);
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

  await db.prepare('DELETE FROM documentos WHERE id = ?').run(doc.id);
  await borrarArchivo(doc.url); // si esto falla, ya no hay registro que lo apunte
  res.json({ ok: true });
});

// GET /api/proveedores/documentos/:id -> descarga la carátula de una fianza, o
// uno de los archivos de su propia carpeta.
//
// La comprobación es la que importa: sin ella, cambiar el id en la URL dejaría
// bajar el papel de una obra que este contratante no tiene por qué ver — la que
// el mismo proveedor hace para su competencia, por ejemplo.
router.get('/documentos/:id', requireAuth, requireContratante, async (req, res) => {
  const url = await urlDeDocumentoParaContratante(req.user.client_id, req.params.id);
  if (!url || !/^https:\/\//.test(url)) {
    return res.status(404).json({ error: 'Documento no disponible' });
  }
  res.redirect(url);
});

export default router;
