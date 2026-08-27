// Qué documentos se pueden colgar de cada cosa. El catálogo vive aquí y no en
// la base porque son los del ramo, no algo que el admin ande cambiando: si un
// día hace falta, se mueve a una tabla como se hizo con los tipos de fianza.

export const TIPOS_DOC = {
  proyecto: [
    { clave: 'contrato', nombre: 'Contrato de obra' },
    { clave: 'convenio_modificatorio', nombre: 'Convenio modificatorio' },
    { clave: 'acta_entrega_recepcion', nombre: 'Acta de entrega-recepción' },
    { clave: 'fallo_licitacion', nombre: 'Fallo de licitación' },
    { clave: 'otro', nombre: 'Otro documento' },
  ],
  fianza: [
    { clave: 'caratula', nombre: 'Carátula de la fianza' },
    { clave: 'endoso', nombre: 'Endoso' },
    { clave: 'carta_liberacion', nombre: 'Carta de liberación' },
    { clave: 'recibo_prima', nombre: 'Recibo de prima' },
    { clave: 'otro', nombre: 'Otro documento' },
  ],
};

// La carpeta del CONTRATANTE sobre una obra de su proveedor. Es una lista
// aparte de TIPOS_DOC.proyecto a propósito, aunque las dos cuelguen de un
// proyecto: son dos carpetas distintas sobre la misma obra y se distinguen por
// el dueño del archivo (documentos.client_id).
//
//   TIPOS_DOC.proyecto            -> papeles del PROVEEDOR (contrato de obra,
//                                    convenios, actas). El contratante no los ve.
//   TIPOS_DOC_CONTRATANTE         -> lo que el contratante recibió o guarda de
//                                    esa obra. El proveedor no los ve.
//
// 'fianza_presentada' es el que importa: es el PDF que el proveedor le entregó
// al desarrollador. No es una póliza capturada —no suma en nada, no consume
// línea, no es producción de Fortex—, es el papel que respalda que sí la
// presentó, y le sirve a Fortex para capturarla después si la coloca.
export const TIPOS_DOC_CONTRATANTE = [
  { clave: 'fianza_presentada', nombre: 'Fianza presentada por el proveedor' },
  { clave: 'contrato_proveedor', nombre: 'Contrato con el proveedor' },
  { clave: 'otro_contratante', nombre: 'Otro documento' },
];

export const esTipoDeContratante = (tipoDoc) =>
  TIPOS_DOC_CONTRATANTE.some((t) => t.clave === tipoDoc);

export const nombreTipoDocContratante = (tipoDoc) =>
  TIPOS_DOC_CONTRATANTE.find((t) => t.clave === tipoDoc)?.nombre ?? tipoDoc;

export const ENTIDADES = Object.keys(TIPOS_DOC);

export function esTipoValido(entidadTipo, tipoDoc) {
  return (TIPOS_DOC[entidadTipo] || []).some((t) => t.clave === tipoDoc);
}

export function nombreTipoDoc(entidadTipo, tipoDoc) {
  const t = (TIPOS_DOC[entidadTipo] || []).find((x) => x.clave === tipoDoc);
  return t ? t.nombre : tipoDoc;
}

// Agrupa una lista plana de documentos por la entidad a la que pertenecen,
// para poder repartirlos entre proyectos y fianzas sin consultar de más.
export function agruparPorEntidad(documentos) {
  const porEntidad = new Map();
  for (const doc of documentos) {
    const clave = `${doc.entidad_tipo}:${doc.entidad_id}`;
    if (!porEntidad.has(clave)) porEntidad.set(clave, []);
    porEntidad.get(clave).push({ ...doc, tipo_doc_nombre: nombreTipoDoc(doc.entidad_tipo, doc.tipo_doc) });
  }
  return porEntidad;
}

export const deEntidad = (porEntidad, tipo, id) => porEntidad.get(`${tipo}:${id}`) || [];
