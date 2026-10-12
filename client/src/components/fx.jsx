// Piezas del sistema de diseño de FortexLink (hr-system, docs/FORTEX-DESIGN.md)
// que comparten el panel de Fortex y el portal del cliente. Viven aquí y no en
// cada pantalla para que las dos caras del portal no se vuelvan a separar: el
// portal del cliente se quedó con el diseño viejo justo porque el panel se
// rediseñó con piezas que solo él veía.
//
// Funcionan dentro de .fx-admin (index.css), que es lo que remapea los grises,
// el azul de marca, la tipografía y las esquinas.

// El cuadro de color de una cifra: el ÚNICO lugar de la tarjeta con color. La
// tarjeta entera nunca se tiñe: cuatro tarjetas de colores se leen como un
// semáforo (FORTEX-DESIGN.md §8).
export const TONO_CIFRA = {
  brand: 'bg-indigo-50 text-indigo-600',
  ok: 'bg-green-50 text-green-700',
  warn: 'bg-amber-50 text-amber-700',
  bad: 'bg-red-50 text-red-700',
  neutral: 'bg-slate-100 text-slate-500',
};

// El encabezado de cada sección: título a la izquierda, acciones a la derecha.
export function EncabezadoPagina({ titulo, sub, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-800 leading-tight">{titulo}</h2>
        {sub && <p className="text-slate-400 text-xs mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-1.5 shrink-0">{children}</div>}
    </div>
  );
}

// Una cifra de arriba de la pantalla: cuadro con icono, número, etiqueta y una
// línea de contexto. Es la misma tarjeta de Comisiones, sin el clic.
export function Cifra({ icono, label, valor, sub, tono = 'neutral' }) {
  return (
    <div className="flex items-start gap-3 bg-white rounded-xl border border-slate-200 p-4 min-w-0">
      <span className={`flex items-center justify-center w-10 h-10 rounded-md shrink-0 ${TONO_CIFRA[tono]}`}>
        {icono}
      </span>
      <span className="min-w-0">
        <span className="block text-[18px] font-semibold tracking-[-0.03em] text-slate-800 tabular-nums leading-tight">{valor}</span>
        <span className="block text-[12px] text-slate-500 mt-0.5">{label}</span>
        {sub && <span className="block text-[11.5px] text-slate-400">{sub}</span>}
      </span>
    </div>
  );
}

// Las pestañas de FortexLink: subrayado de 2px en el azul de marca para la
// activa, y el contador en píldora (azul con texto blanco cuando está activa).
//
// El contador solo se pinta si viene un número. Nunca '?? 0': un cero se lee
// "no hay nada" cuando puede ser "no se pudo consultar". Y si la pestaña
// esconde algo que falta, el contador va en ámbar: tabular no puede esconder.
//
// La barra de scroll se esconde con !important a propósito: cada pestaña baja
// 1px (-mb-px) para pisar la línea gris, eso desborda 1px hacia abajo, y la
// regla general `.fx-admin * { scrollbar-width }` de index.css le ganaba a la
// utilidad y pintaba una barrita vertical junto a las pestañas.
export function TiraPestanas({ pestanas, activa, onCambiar }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 overflow-x-auto ![scrollbar-width:none]">
      {pestanas.map(({ key, label, icono: Icono, cuenta, alerta }) => {
        const es = activa === key;
        return (
          <button
            key={key}
            onClick={() => onCambiar(key)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 -mb-px border-b-2 text-[13px] transition-colors ${
              es ? 'border-indigo-600 text-slate-800 font-semibold' : 'border-transparent text-slate-500 font-medium hover:text-slate-800'
            }`}
          >
            {Icono && <Icono className={`h-3.5 w-3.5 ${es ? 'text-indigo-600' : 'text-slate-400'}`} />}
            {label}
            {cuenta != null && (
              <span className={`text-[10.5px] rounded-full px-1.5 leading-[17px] font-semibold tabular-nums ${
                alerta ? 'bg-amber-100 text-amber-800' : es ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {cuenta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
