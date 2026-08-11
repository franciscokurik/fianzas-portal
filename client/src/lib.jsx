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

// El mismo tope que MAXIMO_MB del servidor. Lo impone Vercel, que corta el
// cuerpo de la petición en ~4.5 MB antes de que corra nuestro código.
export const MAXIMO_MB = 4;
export const AYUDA_ARCHIVOS = `PDF, JPG, PNG, Excel o Word · máx. ${MAXIMO_MB} MB`;

// Se revisa AQUÍ, antes de mandar nada. Si se deja pasar, un archivo grande lo
// corta la plataforma con una respuesta que no es JSON, y a la pantalla llega un
// "Error en la solicitud" que no le dice nada a nadie. Además se ahorra subir
// megas para nada.
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

// Estado -> chip (paleta: emerald=ok, amber=por vencer, rose=vencido/pendiente)
const ESTADOS = {
  activa:     { label: 'Activa',     cls: 'bg-emerald-100 text-emerald-700' },
  al_dia:     { label: 'Al día',     cls: 'bg-emerald-100 text-emerald-700' },
  por_vencer: { label: 'Por vencer', cls: 'bg-amber-100 text-amber-700' },
  vencida:    { label: 'Vencida',    cls: 'bg-rose-100 text-rose-700' },
  vencido:    { label: 'Vencido',    cls: 'bg-rose-100 text-rose-700' },
  pendiente:  { label: 'Pendiente',  cls: 'bg-rose-100 text-rose-700' },
  entregado:  { label: 'Entregado',  cls: 'bg-emerald-100 text-emerald-700' },
};

export function EstadoBadge({ estado }) {
  const e = ESTADOS[estado] || { label: estado, cls: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${e.cls}`}>
      {e.label}
    </span>
  );
}
