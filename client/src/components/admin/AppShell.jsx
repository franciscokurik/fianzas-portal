// El marco del panel interno: barra superior fija de 64px que atraviesa toda la
// ventana, con el bloque de marca alineado al ancho del menú; abajo, el menú
// lateral y el contenido.
//
//   ┌──────────────┬─────────────────────────────────────────┐
//   │  Fortex      │  ADMINISTRACIÓN DE FIANZAS   🔔  Nombre  │ 64px
//   ├──────────────┼─────────────────────────────────────────┤
//   │ menú         │  main: p-6, bg-slate-50                 │
//   └──────────────┴─────────────────────────────────────────┘
//    220px (72px plegado)
import { useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import { Bell, LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { getNavSections } from '../../config/navigation.js';

const ROL_LABEL = { admin: 'Administrador', operador: 'Operador', vendedor: 'Vendedor' };

// El menú plegado se recuerda en este navegador. Si no se puede leer o
// escribir (modo privado, almacenamiento bloqueado) simplemente arranca
// desplegado.
const LLAVE_MENU = 'fx-menu-plegado';
const leerPlegado = () => { try { return localStorage.getItem(LLAVE_MENU) === '1'; } catch { return false; } };
const guardarPlegado = (v) => { try { localStorage.setItem(LLAVE_MENU, v ? '1' : '0'); } catch { /* sin almacenamiento */ } };

function LinkMenu({ to, label, Icon, end, plegado }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={plegado ? label : undefined}
      className={({ isActive }) => [
        'flex items-center gap-3 py-2 text-sm font-medium rounded-md transition-colors duration-150 border-l-2 select-none',
        plegado ? 'justify-center px-0' : 'px-3',
        isActive
          ? 'border-indigo-600 bg-indigo-50 text-indigo-700'
          : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-800',
      ].join(' ')}
    >
      {({ isActive }) => (
        <>
          <Icon className={`shrink-0 ${plegado ? 'h-5 w-5' : 'h-4 w-4'} ${isActive ? 'text-indigo-600' : ''}`} />
          {!plegado && <span className="truncate">{label}</span>}
        </>
      )}
    </NavLink>
  );
}

export default function AppShell({ user, onSalir, pendientes = 0, children }) {
  const [plegado, setPlegado] = useState(leerPlegado);
  const secciones = getNavSections(user?.role);
  const ancho = plegado ? 'var(--fx-sidebar-colapsada)' : 'var(--fx-sidebar)';

  const alternar = () => setPlegado((p) => { guardarPlegado(!p); return !p; });

  return (
    <div className="fx-admin flex flex-col">
      <header
        className="sticky top-0 z-30 bg-white border-b border-slate-200 flex shrink-0"
        style={{ height: 'var(--fx-header)' }}
      >
        <div
          className="hidden lg:flex items-center border-r border-slate-200 shrink-0 px-5"
          style={{ width: ancho, transition: 'width 300ms ease-in-out' }}
        >
          <span className="text-xl font-bold text-[#0c2340] tracking-tight select-none">
            {plegado ? 'F' : 'Fortex'}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-between gap-4 px-6 min-w-0">
          <h1 className="text-xs font-semibold text-slate-500 tracking-widest uppercase select-none truncate">
            <span className="lg:hidden text-[#0c2340] normal-case tracking-tight text-base font-bold mr-3">Fortex</span>
            {user?.role === 'vendedor' ? 'Cartera de clientes' : 'Administración de fianzas'}
          </h1>
          <div className="flex items-center gap-3 shrink-0">
            {/* La campana lleva a "Para atender" con lo que hay que mover hoy.
                El número es el mismo de la bandeja, no otra cuenta. */}
            <Link
              to="/admin"
              className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
              title="Para atender"
            >
              <Bell className="h-5 w-5" />
              {pendientes > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-indigo-600 text-white text-[10px] font-semibold leading-[18px] text-center tabular-nums">
                  {pendientes}
                </span>
              )}
            </Link>
            <div className="hidden sm:block text-right leading-tight">
              <p className="text-sm font-medium text-slate-800">{user?.nombre}</p>
              <p className="text-[11px] text-slate-400">{ROL_LABEL[user?.role] || user?.role}</p>
            </div>
            <button
              onClick={onSalir}
              className="flex items-center gap-1 border border-slate-200 bg-white text-slate-600 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" /> Salir
            </button>
          </div>
        </div>
      </header>

      {/* Por debajo de lg no cabe el menú lateral: va como tira bajo la barra. */}
      <nav className="lg:hidden flex gap-1 overflow-x-auto bg-white border-b border-slate-200 px-4 py-2">
        {secciones.flatMap((s) => s.items).map((it) => (
          <NavLink
            key={it.to}
            to={it.to}
            end={it.end}
            className={({ isActive }) => `flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            <it.Icon className="h-3.5 w-3.5" /> {it.label}
          </NavLink>
        ))}
      </nav>

      <div className="flex flex-1 min-h-0">
        <aside
          className="hidden lg:flex flex-col shrink-0 bg-slate-50 border-r border-slate-200 sticky self-start"
          style={{
            width: ancho,
            transition: 'width 300ms ease-in-out',
            top: 'var(--fx-header)',
            height: 'calc(100vh - var(--fx-header))',
          }}
        >
          <nav className="flex-1 overflow-y-auto px-3 py-4">
            {secciones.map((s, i) => (
              <div key={s.label || i} className={i > 0 ? 'mt-5' : ''}>
                {s.label && (plegado
                  ? <div className="mx-2 mb-1.5 border-t border-slate-200" />
                  : (
                    <div className="px-3 pb-1.5 text-[10px] uppercase tracking-wider text-slate-400 font-semibold select-none">
                      {s.label}
                    </div>
                  ))}
                <div className="space-y-0.5">
                  {s.items.map((it) => <LinkMenu key={it.to} {...it} plegado={plegado} />)}
                </div>
              </div>
            ))}
          </nav>
          <button
            onClick={alternar}
            className={`flex items-center gap-2 m-3 px-3 py-2 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md transition-colors ${
              plegado ? 'justify-center px-0' : ''
            }`}
            title={plegado ? 'Desplegar menú' : 'Plegar menú'}
          >
            {plegado ? <PanelLeftOpen className="h-4 w-4" /> : <><PanelLeftClose className="h-4 w-4" /> Plegar menú</>}
          </button>
        </aside>

        <main className="flex-1 p-6 min-w-0">{children}</main>
      </div>
    </div>
  );
}
