// Utilidades de fechas y cálculo de estados (vigencias).
// Trabajamos con strings ISO 'yyyy-mm-dd' para evitar problemas de zona horaria.

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Días entre hoy y una fecha ISO (positivo = futuro, negativo = ya pasó)
export function daysUntil(isoDate, fromISO = todayISO()) {
  if (!isoDate) return null;
  const a = new Date(fromISO + 'T00:00:00Z');
  const b = new Date(isoDate + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

// Suma meses a una fecha ISO y regresa ISO
export function addMonths(isoDate, months) {
  const d = new Date(isoDate + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Ventana de los KPI de "por vencer". Es más ancha que la de estadoFianza a
// propósito, y no contesta lo mismo: el chip ámbar avisa de lo que YA urge, y el
// KPI es de planeación —qué le toca renovar al bimestre—. Unificarlas dejaría
// mintiendo a una de las dos: o el chip grita dos meses antes, o el KPI se
// entera cuando ya no hay tiempo de mover la renovación.
export const VENTANA_KPI_DIAS = 60;

// Estado de una fianza según su fecha de vigencia
//   activa      -> vence en más de 30 días
//   por_vencer  -> vence en 30 días o menos (pero aún no vence)
//   vencida     -> ya pasó la fecha
export function estadoFianza(fechaVigencia) {
  const d = daysUntil(fechaVigencia);
  if (d === null) return 'activa';
  if (d < 0) return 'vencida';
  if (d <= 30) return 'por_vencer';
  return 'activa';
}

// Igual que estadoFianza, pero para la pantalla del CONTRATANTE, donde "sin
// fecha capturada" no puede leerse como "vigente".
//
// estadoFianza devuelve 'activa' cuando no hay fecha, y para el fiado está bien:
// es su propia captura incompleta, y él sabe lo que tiene. En la pantalla con la
// que un desarrollador decide si deja entrar a un proveedor a la obra, ese mismo
// silencio pintado de verde es el falso positivo más caro que hay.
//
// No se cambia estadoFianza porque de ella cuelgan el panel, el portal del fiado
// y el mapa de estados del front.
export function estadoCumplimiento(fechaVigencia) {
  if (!fechaVigencia) return 'sin_vigencia';
  return estadoFianza(fechaVigencia);
}

// Estado de un documento según vencimiento y si fue subido
//   pendiente  -> no se ha subido
//   al_dia     -> subido y (sin vencimiento o vence más allá de la ventana de alerta)
//   por_vencer -> subido pero dentro de la ventana de alerta
//   vencido    -> subido pero ya pasó la fecha de vencimiento
export function estadoDocumento({ uploaded, vencimiento, alertaDias = 30 }) {
  if (!uploaded) return 'pendiente';
  if (!vencimiento) return 'al_dia';
  const d = daysUntil(vencimiento);
  if (d < 0) return 'vencido';
  if (d <= alertaDias) return 'por_vencer';
  return 'al_dia';
}
