// El armazón del portal del cliente: el mismo sistema de diseño del panel de
// Fortex (.fx-admin, ver components/admin/AppShell.jsx) pero SIN barra lateral.
//
// Es la cara externa del portal —el "plano B" de FortexLink—: del otro lado
// hay un cliente, no un empleado, y no tiene módulos que recorrer. Lleva la
// marca, de quién es la cuenta y la salida; nada más.
//
//   ┌──────────────────────────────────────────────────────────┐
//   │  Fortex · PORTAL DE FIANZAS           [AB] Nombre   ⎋    │ 56px, pegajosa
//   ├──────────────────────────────────────────────────────────┤
//   │  content (padding 24px, máx 1420px)                      │
//   └──────────────────────────────────────────────────────────┘
import { LogOut } from 'lucide-react';

const iniciales = (nombre = '') => nombre.split(/\s+/).filter(Boolean).slice(0, 2)
  .map((p) => p[0]).join('').toUpperCase();

export default function ClienteShell({ nombre, empresa, onSalir, children }) {
  return (
    <div className="fx-admin flex flex-col">
      <header
        className="sticky top-0 z-20 border-b border-slate-200 flex items-center justify-between gap-3 px-4 sm:px-6"
        style={{ height: 'var(--topbar-h)', background: 'var(--glass)', backdropFilter: 'blur(8px)' }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-xl font-bold tracking-tight select-none leading-none" style={{ color: 'var(--logo)' }}>
            Fortex
          </span>
          <span className="hidden sm:inline text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400 border-l border-slate-200 pl-3 truncate">
            Portal de Fianzas
          </span>
        </div>

        <div className="flex items-center gap-1.5 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold shrink-0">
              {iniciales(nombre || empresa)}
            </span>
            {/* En el teléfono basta el círculo: el nombre de la empresa no cabe
                junto al logo sin empujar el botón de salir fuera de la pantalla. */}
            <div className="hidden sm:block min-w-0 leading-tight">
              <p className="text-xs font-semibold text-slate-800 truncate max-w-[220px]">{nombre}</p>
              {empresa && <p className="text-[11px] text-slate-400 truncate max-w-[220px]">{empresa}</p>}
            </div>
          </div>
          <button
            onClick={onSalir}
            title="Salir"
            className="flex items-center justify-center w-8 h-8 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700 transition-colors shrink-0"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 min-w-0">
        <div className="w-full max-w-[1420px] mx-auto px-4 sm:px-6 pt-6 pb-16">{children}</div>
      </main>
    </div>
  );
}
