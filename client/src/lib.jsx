// Utilidades de presentación compartidas (estilo FortexHRM).

// Moneda para KPIs grandes (sin decimales)
export const mxn = (n) => `$${Math.round(n || 0).toLocaleString('es-MX')}`;

// Moneda para tablas detalladas (2 decimales)
export const mxnCents = (n) =>
  `$${(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Fecha es-MX: "06 ene 2026". Si no hay valor: em-dash.
export const fmtDate = (iso) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

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
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium ${e.cls}`}>
      {e.label}
    </span>
  );
}
