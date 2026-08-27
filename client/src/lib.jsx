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

export function CumplimientoBadge({ estado }) {
  const e = CUMPLIMIENTO[estado] || { label: estado, cls: 'bg-slate-100 text-slate-600' };
  return (
    <span
      className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${e.cls}`}
      title={e.ayuda}
    >
      {e.label}
    </span>
  );
}

// ¿Este estado significa que la obra NO está respaldada hoy? Tiene que coincidir
// con DESCUBIERTA de server/src/services/proveedores.js.
export const estaDescubierta = (estado) =>
  ['sin_fianza', 'vencida', 'sin_vigencia'].includes(estado);

// Marca de qué clase de cliente es. Solo se pinta para el contratante: en una
// lista que casi toda es de fiados, etiquetar cada renglón hace ruido.
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
