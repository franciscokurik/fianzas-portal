// Utilidades de presentación compartidas (estilo FortexHRM).
import { useEffect, useState } from 'react';

// IMPORTANTE: los montos viajan desde la API en CENTAVOS enteros. La división
// entre 100 pasa aquí y solo aquí — es la capa de presentación. Nada de hacer
// cuentas de dinero en pesos con decimales en el resto de la app.

// Moneda para KPIs grandes (sin decimales)
export const mxn = (centavos) => `$${Math.round((centavos || 0) / 100).toLocaleString('es-MX')}`;

// Moneda para tablas detalladas (2 decimales)
export const mxnCents = (centavos) =>
  `$${((centavos || 0) / 100).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "1,200,000.55" -> 120000055. Se parte la cadena en vez de usar parseFloat
// para que no se cuele un error de flotante al capturar.
export function pesosACentavos(valor) {
  if (valor === '' || valor == null) return 0;
  const limpio = String(valor).trim().replace(/[^\d.-]/g, '');
  if (!limpio || limpio === '-' || limpio === '.') return 0;
  const negativo = limpio.startsWith('-');
  const [entero = '', decimales = ''] = limpio.replace(/-/g, '').split('.');
  // Se truncan los decimales de más: capturar 1.999 son $1.99, no $2.00.
  const centavos = Number(entero || '0') * 100 + Number((decimales + '00').slice(0, 2));
  return negativo ? -centavos : centavos;
}

// 120000055 -> "1200000.55" (para el value de un input)
export function centavosATexto(centavos) {
  const n = Number(centavos);
  if (!Number.isFinite(n) || n === 0) return n === 0 ? '0' : '';
  return String(n / 100);
}

// Input de captura en PESOS que reporta CENTAVOS hacia arriba.
// Mantiene su propio texto mientras está enfocado para no pelearse con lo que
// se está tecleando (p.ej. el punto de "1200.").
export function InputPesos({ valor, onChange, className, ...rest }) {
  const [texto, setTexto] = useState(() => centavosATexto(valor));
  const [enfocado, setEnfocado] = useState(false);

  useEffect(() => {
    if (!enfocado) setTexto(centavosATexto(valor));
  }, [valor, enfocado]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={texto}
      onFocus={() => setEnfocado(true)}
      onBlur={() => { setEnfocado(false); setTexto(centavosATexto(valor)); }}
      onChange={(e) => { setTexto(e.target.value); onChange(pesosACentavos(e.target.value)); }}
      className={className}
      {...rest}
    />
  );
}

// Fecha es-MX: "06 ene 2026". Si no hay valor: em-dash.
export const fmtDate = (iso) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

// ¿Ya pasó la fecha? Las fechas viajan como 'YYYY-MM-DD', que se compara como
// texto sin ambigüedad de zona horaria. Sirve para pintar un documento vencido
// cuando la API manda la fecha y no el estado ya calculado.
export const yaVencio = (iso) => Boolean(iso) && iso < new Date().toISOString().slice(0, 10);

// Formatos que acepta la API. Tiene que coincidir con PERMITIDOS en
// server/src/lib/upload.js: si aquí se ofrece algo que allá no, el archivo
// viaja completo nada más para que lo rechacen.
export const ACCEPT_ARCHIVOS = '.pdf,.jpg,.jpeg,.png,.xlsx,.xls,.docx,.doc';

// El mismo tope que MAXIMO_MB del servidor: el del plan de Cloudinary. Se puede
// prometer porque el archivo no pasa por nuestra API — el navegador lo sube
// directo a Cloudinary (ver subirACloudinary en api.js).
export const MAXIMO_MB = 10;
export const AYUDA_ARCHIVOS = `PDF, JPG, PNG, Excel o Word · máx. ${MAXIMO_MB} MB`;

// Se revisa AQUÍ, antes de pedir la firma. Así el usuario se entera de que su
// archivo no cabe ANTES de esperar a que se suban ocho megas, y el error se lo
// da el portal con sus palabras en vez de Cloudinary con las suyas.
export function revisarArchivo(file) {
  if (!file) return 'No se eligió ningún archivo.';

  const mb = file.size / (1024 * 1024);
  if (mb > MAXIMO_MB) {
    return `"${file.name}" pesa ${mb.toFixed(1)} MB y el máximo es ${MAXIMO_MB} MB. `
      + 'Si es un escaneo, vuelve a generarlo en menor resolución o divídelo.';
  }
  if (file.size === 0) return `"${file.name}" está vacío.`;
  return null;
}

// Peso del archivo en texto corto ("340 KB", "1.2 MB").
export const pesoArchivo = (bytes) =>
  !bytes ? '' : bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// Estatus de una obra. Vive aquí y no en una pantalla porque lo usan las dos:
// el panel de Fortex y el portal del contratante.
export const ESTATUS_PROYECTO = [
  ['en_proceso', 'En proceso'],
  ['terminado', 'Terminado'],
  ['entregado', 'Entregado'],
  ['cerrado', 'Cerrado'],
  ['cancelado', 'Cancelado'],
];
export const etiquetaEstatus = (v) => (ESTATUS_PROYECTO.find(([k]) => k === v) || [, v])[1];

// Estado -> chip (paleta: emerald=ok, amber=por vencer, rose=vencido/pendiente)
const ESTADOS = {
  activa:     { label: 'Activa',     cls: 'bg-emerald-100 text-emerald-700' },
  al_dia:     { label: 'Al día',     cls: 'bg-emerald-100 text-emerald-700' },
  por_vencer: { label: 'Por vencer', cls: 'bg-amber-100 text-amber-700' },
  vencida:    { label: 'Vencida',    cls: 'bg-rose-100 text-rose-700' },
  vencido:    { label: 'Vencido',    cls: 'bg-rose-100 text-rose-700' },
  pendiente:  { label: 'Pendiente',  cls: 'bg-rose-100 text-rose-700' },
  entregado:  { label: 'Entregado',  cls: 'bg-emerald-100 text-emerald-700' },
  // Un previo no tiene vigencia que juzgar: la API manda este estado en su
  // lugar (ver routes/fianzas.js). En violeta para que no se confunda con las
  // emitidas ni parezca un problema.
  previo:     { label: 'Previo',     cls: 'bg-violet-100 text-violet-700' },
  // Hay fianza, pero nadie le capturó hasta cuándo cubre. En ámbar y NUNCA en
  // verde: en la pantalla del contratante, dar eso por bueno es decirle que su
  // proveedor está cubierto sin saberlo (ver estadoCumplimiento en lib/dates.js).
  sin_vigencia: { label: 'Sin fecha', cls: 'bg-amber-100 text-amber-700' },
};

// Cumplimiento de una obra o de un proveedor, en la pantalla del contratante.
//
// 'sin_fianza' dice "Sin registro en Fortex" y no "Sin fianza", y la diferencia
// importa: el portal solo sabe de las fianzas que colocó Fortex, así que un
// proveedor que compró la suya con otro agente saldría acusado en falso. Lo que
// el portal puede afirmar es que no tiene registro, no que el proveedor no
// cumplió.
const CUMPLIMIENTO = {
  cubierta:     { label: 'Con fianza',   cls: 'bg-emerald-100 text-emerald-700',
                  ayuda: 'Tiene fianza emitida y vigente para esta obra.' },
  // Nadie la está haciendo todavía. Va en gris y NO en rojo a propósito: es un
  // pendiente del desarrollador —le falta contratar—, no un proveedor que
  // incumplió. Pintarlo de rojo sería acusar a alguien que ni existe.
  sin_contratista: { label: 'Sin contratista', cls: 'bg-slate-100 text-slate-600',
                  ayuda: 'Esta partida todavía no tiene contratista asignado. Cuando lo '
                       + 'contrates, dile a Fortex y te ligan su obra aquí.' },
  // Hay cobertura viva pero falta alguno de los tipos que la partida exige. Es
  // el falso OK que el portal arrastraba: con la de cumplimiento y sin la de
  // anticipo, antes salía en verde.
  incompleta:   { label: 'Incompleta',   cls: 'bg-amber-100 text-amber-800',
                  ayuda: 'Tiene fianza vigente, pero le falta alguno de los tipos que esta '
                       + 'partida exige. Abajo dice cuál.' },
  por_vencer:   { label: 'Por vencer',   cls: 'bg-amber-100 text-amber-700',
                  ayuda: 'La fianza vigente vence en 30 días o menos.' },
  sin_vigencia: { label: 'Sin fecha',    cls: 'bg-amber-100 text-amber-700',
                  ayuda: 'Hay fianza, pero sin fecha de vigencia capturada. Pídesela a Fortex.' },
  vencida:      { label: 'Vencida',      cls: 'bg-rose-100 text-rose-700',
                  ayuda: 'Presentó fianza, pero hoy ninguna está vigente.' },
  sin_fianza:   { label: 'Sin registro', cls: 'bg-rose-100 text-rose-700',
                  ayuda: 'No hay ninguna fianza registrada en Fortex para esta obra. '
                       + 'Puede que exista y se haya colocado con otro agente.' },
  // Lo usan dos pantallas: un proveedor sin obras ligadas y un proyecto sin
  // proveedores asignados. La ayuda tiene que ser cierta para las dos.
  sin_obra:     { label: 'Sin obra',     cls: 'bg-slate-100 text-slate-600',
                  ayuda: 'Todavía no se le ha ligado ninguna obra. '
                       + 'No es un incumplimiento: falta la captura.' },
  // Distinto de 'sin_obra', y la diferencia importa: aquí la captura SÍ está
  // hecha, lo que pasa es que el trabajo terminó. Decirle "falta la captura"
  // mandaría al operador a buscar algo que no falta.
  sin_obras_vivas: { label: 'Obras cerradas', cls: 'bg-slate-100 text-slate-600',
                  ayuda: 'Sus obras con esta cuenta están cerradas o canceladas: ya no hay '
                       + 'cobertura que exigirle.' },
};

// 'verificada' significa "sabemos QUÉ se exigía y está todo". Solo entonces se
// dice "Cubierta"; sin requisitos capturados, lo único que se puede afirmar es
// que hay una fianza, y eso es lo que dice la etiqueta.
//
// Prometer completitud sin saber qué se exige sería el mismo falso OK con otro
// nombre, y es el que costó tres entregas quitar.
export function CumplimientoBadge({ estado, verificada }) {
  const e = CUMPLIMIENTO[estado] || { label: estado, cls: 'bg-slate-100 text-slate-600' };
  const cubiertaDeVerdad = estado === 'cubierta' && verificada;

  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${e.cls}`}
      title={cubiertaDeVerdad
        ? 'Tiene vigente cada uno de los tipos de fianza que esta partida exige.'
        : e.ayuda}
    >
      {cubiertaDeVerdad ? 'Cubierta' : e.label}
    </span>
  );
}

// ¿Este estado significa que la obra NO está respaldada hoy? Tiene que coincidir
// con DESCUBIERTA de server/src/services/proveedores.js.
export const estaDescubierta = (estado) =>
  ['sin_fianza', 'vencida', 'sin_vigencia', 'incompleta'].includes(estado);

// Marca de qué clase de cliente es. Solo se pinta para el contratante: en una
// lista que casi toda es de fiados, etiquetar cada renglón hace ruido.
/* --------------------------------------------------------------------------
   QUÉ FALTA
   --------------------------------------------------------------------------
   Estas funciones existen porque el panel va a esconder cosas detrás de
   pestañas y de secciones plegadas, y eso solo se puede hacer si hay UN lugar
   que enumere los pendientes. La barra de chips, el contador de cada pestaña y
   la regla de "esta obra arranca abierta" leen de aquí, así que no pueden
   contradecirse — que es exactamente lo que pasa cuando cada pantalla cuenta
   por su lado (el titular decía 1 y el renglón de abajo decía 2).

   Cada pendiente sale con { clave, texto, tono, destino }: el texto lleva el
   número escrito, no el color, porque en el panel el color no llega —
   .portal-admin aplana sky y violet a gris.

   El tono ES el grupo en que se pinta (ver GRUPOS_PENDIENTE), y se elige por
   qué tan pronto hay que moverse, no por qué tan feo suena:
     rose   -> "Atender ya": alguien incumplió o algo exigible falta HOY.
     amber  -> "Pronto": se vence o hay que mirarlo en días.
     slate  -> "Por completar": un dato que le falta capturar a la casa, o un
               pendiente del propio cliente. No es una falta de nadie.
     violet -> "En trámite": ya va; solo hay que darle seguimiento.
   Antes casi todo salía rojo o ámbar, y con seis chips encendidos nadie sabía
   por dónde empezar.
   -------------------------------------------------------------------------- */

// El estado de un papel del expediente, en un solo lugar.
//
// La regla estaba escrita dentro del JSX del renglón y el contador del
// encabezado usaba otra (`filter(d => !d.uploaded_at)`), así que un documento
// VENCIDO se pintaba en rojo abajo y no contaba arriba: el encabezado decía
// "completo" con un financiero vencido a la vista.
export function estadoDocCliente(d) {
  if (!d.uploaded_at) return 'pendiente';
  if (!d.vencimiento) return 'al_dia';
  const hoy = new Date().toISOString().slice(0, 10);
  if (d.vencimiento < hoy) return 'vencido';
  const dias = Math.ceil((new Date(d.vencimiento) - new Date(hoy)) / 86400000);
  return dias <= (d.alerta_dias ?? 30) ? 'por_vencer' : 'al_dia';
}

// ¿Esta obra tiene algo que decir? Decide si arranca abierta o plegada.
//
// Va aquí y no dentro del componente para que el chip "n obra(s) sin fianza" y
// el plegado no puedan discrepar: si el chip la cuenta, la obra se abre.
export function obraTienePendiente(p) {
  const registros = p.fianzas || [];
  const emitidas = registros.filter((f) => f.clase !== 'previo');
  if (!emitidas.length) return true;                                  // sin fianza
  if (emitidas.some((f) => f.estado === 'vencida')) return true;
  if (emitidas.some((f) => f.estado === 'por_vencer')) return true;
  if (emitidas.some((f) => !f.fecha_vigencia)) return true;           // sin fecha
  // Ligada a un contratante pero fuera de sus proyectos: captura a medias.
  if (p.contratante_nombre && !p.desarrollo_nombre) return true;
  if (registros.some((f) => f.dias_para_recordatorio != null && f.dias_para_recordatorio <= 7)) {
    return true;
  }
  return false;
}

const chip = (clave, texto, tono, destino) => ({ clave, texto, tono, destino });

// Los pendientes de un FIADO, con su destino para poder llevar de un clic.
export function pendientesDelFiado({
  fianzas = [], documentos = [], papeleria = [], proyectos = [], lineas = [], usuarios = [],
} = {}) {
  const fuera = [];
  const emitidas = fianzas.filter((f) => f.clase !== 'previo');

  const sinFianza = proyectos.filter(
    (p) => (p.fianzas || []).every((f) => f.clase === 'previo')
  ).length;
  if (sinFianza) fuera.push(chip('sin_fianza', `${sinFianza} obra(s) sin fianza emitida`, 'rose', 'obras'));

  const vencidas = emitidas.filter((f) => f.estado === 'vencida').length;
  if (vencidas) fuera.push(chip('vencidas', `${vencidas} póliza(s) vencida(s)`, 'rose', 'obras'));

  const porVencer = emitidas.filter((f) => f.estado === 'por_vencer').length;
  if (porVencer) {
    fuera.push(chip('por_vencer', `${porVencer} póliza(s) vencen en 30 días o menos`, 'amber', 'obras'));
  }

  // Sin este chip esa póliza no aparece en ninguna cuenta: estadoFianza
  // devuelve 'activa' cuando no hay fecha, y para el fiado está bien —es su
  // propia captura incompleta— pero entonces nadie la nombra.
  const sinFecha = emitidas.filter((f) => !f.fecha_vigencia).length;
  if (sinFecha) {
    fuera.push(chip('sin_fecha', `${sinFecha} póliza(s) sin fecha de vigencia capturada`, 'slate', 'obras'));
  }

  const docs = documentos.map(estadoDocCliente);
  const docsMal = docs.filter((e) => e === 'pendiente' || e === 'vencido').length;
  // "Pronto" y no "Atender ya": un papel que falta no deja a nadie sin
  // cobertura hoy, y en casi todos los fiados falta alguno. En rojo era la
  // alarma que siempre estaba prendida y por eso ya nadie la leía.
  if (docsMal) {
    fuera.push(chip('expediente', `${docsMal} documento(s) del expediente faltan o vencieron`, 'amber', 'papeles'));
  }
  const docsPronto = docs.filter((e) => e === 'por_vencer').length;
  if (docsPronto) {
    fuera.push(chip('expediente_pronto', `${docsPronto} documento(s) del expediente por vencer`, 'amber', 'papeles'));
  }

  const papelPend = papeleria.filter((p) => p.estado === 'pendiente').length;
  if (papelPend) {
    fuera.push(chip('papeleria', `${papelPend} solicitud(es) de papelería pendiente(s)`, 'amber', 'papeles'));
  }

  const sinAgrupar = proyectos.filter(
    (p) => p.contratante_nombre && !p.desarrollo_nombre
  ).length;
  if (sinAgrupar) {
    fuera.push(chip('sin_agrupar', `${sinAgrupar} obra(s) ligadas a un contratante, sin proyecto`, 'slate', 'obras'));
  }

  // '<= 0' y no '< 0': agotada es agotada, y en cero no le cabe otra fianza.
  const agotadas = lineas.filter((l) => l.disponible <= 0).length;
  if (agotadas) {
    fuera.push(chip('linea', `Sin crédito disponible con ${agotadas} afianzadora(s)`, 'rose', 'obras'));
  }

  const previos = fianzas.filter((f) => f.clase === 'previo').length;
  if (previos) fuera.push(chip('previos', `${previos} previo(s) en trámite`, 'violet', 'obras'));

  if (usuarios.length && !usuarios.some((u) => u.activo)) {
    fuera.push(chip('accesos', 'Nadie tiene acceso activo al portal', 'slate', 'accesos'));
  }

  return fuera;
}

// Los pendientes de un CONTRATANTE. Salen de las métricas que el servidor ya
// calcula, para que el panel no vuelva a derivarlas por su cuenta.
//
// La unidad es EL CONTRATO, la misma que los renglones de la tabla de abajo y la
// lista de clientes: el chip dice "2" y abajo hay dos renglones en rojo. Antes la
// misma falta se contaba tres veces con tres palabras —"pendientes", "obras sin
// fianza vigente", "proveedores en falta"— y casi siempre daban el mismo número,
// así que no había forma de saber si eran el mismo problema o tres distintos.
// Se usa obras_descubiertas y no pendientes_sin_fianza porque, ya juzgado cada
// contrato contra su partida, cuenta lo mismo o más: no esconde nada.
export function pendientesDelContratante({
  metricas = {}, suspendidos = [], lineas_proveedores: lineasProv = [],
} = {}) {
  const m = metricas;
  const fuera = [];

  if (m.obras_descubiertas) {
    fuera.push(chip('sin_fianza', `${m.obras_descubiertas} contrato(s) sin fianza completa`, 'rose', 'proyectos'));
  }
  // En slate: es pendiente del propio desarrollador —le falta contratar—, no un
  // proveedor que incumplió. Pintarlo rojo acusaría a alguien que no existe.
  if (m.partidas_sin_contratista) {
    fuera.push(chip('sin_contratar', `${m.partidas_sin_contratista} partida(s) sin contratar`, 'slate', 'proyectos'));
  }
  if (m.obras_sin_proyecto) {
    fuera.push(chip('sin_proyecto', `${m.obras_sin_proyecto} contrato(s) fuera de proyecto`, 'slate', 'proyectos'));
  }
  const conObras = suspendidos.filter((s) => s.obras_ligadas > 0);
  if (conObras.length) {
    const n = conObras.reduce((s, x) => s + x.obras_ligadas, 0);
    fuera.push(chip('suspendidos', `${conObras.length} suspendido(s) con ${n} contrato(s) ligados`, 'slate', 'padron'));
  }
  // La ventana se escribe en el texto porque NO es la del chip de cada renglón:
  // este mira a 60 días para planear y el renglón dice "Por vencer" a 30. Sin
  // decirlo, el chip contaba uno que abajo salía "Con fianza".
  if (m.obras_por_vencer) {
    fuera.push(chip('por_vencer', `${m.obras_por_vencer} contrato(s) vencen en 60 días o menos`, 'amber', 'proyectos'));
  }
  if (m.previos_en_tramite) {
    fuera.push(chip('previos', `${m.previos_en_tramite} previo(s) en trámite`, 'violet', 'proyectos'));
  }
  // Por PROVEEDOR, como dice el texto: antes contaba renglones de la tabla de
  // crédito, y un proveedor con dos afianzadoras agotadas salía como dos.
  //
  // Y "sin línea" va aparte de "agotada": una línea en 0 con pólizas encima no
  // es que se haya pasado, es que Fortex no la ha capturado. Decirle "sin
  // disponible" mandaba a buscar crédito en vez de a capturar un dato.
  const proveedoresDonde = (cumple) =>
    new Set(lineasProv.filter(cumple).map((l) => l.proveedor_id)).size;
  const sinLinea = proveedoresDonde((l) => !l.linea_credito);
  if (sinLinea) {
    fuera.push(chip('sin_linea', `${sinLinea} proveedor(es) sin línea de crédito capturada`, 'slate', 'padron'));
  }
  const agotados = proveedoresDonde((l) => l.linea_credito > 0 && l.disponible <= 0);
  if (agotados) {
    fuera.push(chip('linea', `${agotados} proveedor(es) sin crédito disponible`, 'rose', 'padron'));
  }

  return fuera;
}

export function TipoClienteBadge({ tipo }) {
  if (tipo !== 'contratante') return null;
  return (
    <span
      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium bg-sky-100 text-sky-700 whitespace-nowrap"
      title="Contratante: no compra fianzas, las exige a sus proveedores"
    >
      Contratante
    </span>
  );
}

export function EstadoBadge({ estado }) {
  const e = ESTADOS[estado] || { label: estado, cls: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${e.cls}`}>
      {e.label}
    </span>
  );
}

// Marca de clase junto al número de póliza. Solo se pinta para los previos: en
// una tabla que casi siempre son fianzas, etiquetar cada renglón con "FIANZA"
// nada más hace ruido.
export function ClaseBadge({ clase }) {
  if (clase !== 'previo') return null;
  return (
    <span
      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium bg-violet-100 text-violet-700 whitespace-nowrap"
      title="Previo: capturado antes de que la afianzadora emita la póliza"
    >
      Previo
    </span>
  );
}
