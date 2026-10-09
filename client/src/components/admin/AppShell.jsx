// El armazón del panel interno, el mismo de las demás herramientas de
// FortexLink (hr-system, docs/FORTEX-DESIGN.md §6 y §7):
//
//   ┌────────────┬──────────────────────────────────────────────┐
//   │  sidebar   │  topbar  (56px, pegajosa, translúcida)       │
//   │  236px     ├──────────────────────────────────────────────┤
//   │  pegajosa  │  content (padding 24px, máx 1420px)          │
//   │  100vh     │                                              │
//   └────────────┴──────────────────────────────────────────────┘
//
// La barra lateral se pliega a 64px (botón o Ctrl+B) y lo recuerda; la
// superior lleva el buscador de clientes al centro (Ctrl+K).
import { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, LogOut, Search, Menu, X, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { getNavSections } from '../../config/navigation.js';

const ROL_LABEL = { admin: 'Administrador', operador: 'Operador', vendedor: 'Vendedor' };

// El menú plegado se recuerda en este navegador. Si el almacenamiento no se
// puede usar (modo privado, bloqueado), simplemente arranca desplegado.
const LLAVE_MENU = 'fx-fianzas-menu-plegado';
const leerPlegado = () => { try { return localStorage.getItem(LLAVE_MENU) === '1'; } catch { return false; } };
const guardarPlegado = (v) => { try { localStorage.setItem(LLAVE_MENU, v ? '1' : '0'); } catch { /* sin almacenamiento */ } };

const iniciales = (nombre = '') => nombre.split(/\s+/).filter(Boolean).slice(0, 2)
  .map((p) => p[0]).join('').toUpperCase();

/* ── Renglón del menú lateral ─────────────────────────────────────────── */
function LinkMenu({ to, label, Icon, end, cuenta, plegado, onIr }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onIr}
      // Plegada, el tooltip dice el nombre y su contador.
      title={plegado ? (cuenta ? `${label} · ${cuenta}` : label) : undefined}
      className={({ isActive }) => [
        'relative flex items-center rounded-md transition-colors duration-[120ms] select-none text-[13px]',
        plegado ? 'justify-center px-0 py-[7px]' : 'gap-2.5 px-2.5 py-[7px]',
        isActive
          ? 'bg-[var(--brand-soft)] text-slate-800 font-semibold'
          : 'text-slate-500 font-medium hover:bg-slate-100 hover:text-slate-800',
      ].join(' ')}
    >
      {({ isActive }) => (
        <>
          {/* La marca del activo es una barrita de 2.5px pegada al borde
              izquierdo: el único lugar donde el azul aparece sin ser botón. */}
          {isActive && (
            <span
              aria-hidden
              className="absolute rounded-full bg-indigo-600"
              style={{ left: plegado ? -8 : -10, top: 4, bottom: 4, width: 2.5 }}
            />
          )}
          <Icon
            className={`shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`}
            style={{ width: 15, height: 15 }}
          />
          {!plegado && (
            <>
              <span className="truncate flex-1">{label}</span>
              {cuenta > 0 && <span className="text-[11px] tabular-nums text-slate-400 shrink-0">{cuenta}</span>}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

/* ── Buscador de clientes (Ctrl+K) ────────────────────────────────────── */
// Busca en la lista que el panel ya tiene cargada: razón social y RFC. Lleva
// directo a la ficha. Es el atajo para no ir a la lista, filtrar y dar clic.
function Buscador({ clientes = [] }) {
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const input = useRef(null);

  useEffect(() => {
    const alTeclear = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        setAbierto(true);
      }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  const t = texto.trim().toLowerCase();
  const resultados = t
    ? clientes.filter((c) => `${c.razon_social} ${c.rfc || ''}`.toLowerCase().includes(t)).slice(0, 8)
    : [];

  const ir = (c) => {
    navigate(`/admin/clientes/${c.id}`);
    setTexto('');
    setAbierto(false);
    input.current?.blur();
  };

  return (
    <div className="relative w-full">
      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
      <input
        ref={input}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setMarcado(0); setAbierto(true); }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado((m) => Math.min(m + 1, resultados.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado((m) => Math.max(m - 1, 0)); }
          if (e.key === 'Enter' && resultados[marcado]) ir(resultados[marcado]);
          if (e.key === 'Escape') { setTexto(''); input.current?.blur(); }
        }}
        placeholder="Buscar cliente o RFC…"
        className="w-full h-8 pl-8 pr-14 text-[13px] border border-slate-200 rounded-md bg-white text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#b9b9c2] focus:shadow-[0_0_0_4px_var(--ring)] transition-colors"
      />
      <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[10.5px] text-slate-400 border border-slate-200 rounded px-1 leading-4 pointer-events-none">
        Ctrl K
      </kbd>
      {abierto && t && (
        <div
          className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-md overflow-hidden z-50"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          {resultados.length ? resultados.map((c, i) => (
            <button
              key={c.id}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ir(c)}
              onMouseEnter={() => setMarcado(i)}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors ${
                i === marcado ? 'bg-slate-100' : ''
              }`}
            >
              <span className="text-[13px] text-slate-800 truncate">{c.razon_social}</span>
              <span className="text-[11.5px] text-slate-400 font-mono shrink-0">{c.rfc || ''}</span>
            </button>
          )) : (
            <p className="px-3 py-2.5 text-[12px] text-slate-400">Ningún cliente coincide.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Armazón ──────────────────────────────────────────────────────────── */
export default function AppShell({ user, onSalir, pendientes = 0, clientes = [], children }) {
  const [plegado, setPlegado] = useState(leerPlegado);
  const [cajon, setCajon] = useState(false);
  const { pathname } = useLocation();
  const secciones = getNavSections(user?.role);
  const ancho = plegado ? 'var(--sidebar-w-collapsed)' : 'var(--sidebar-w)';

  const alternar = () => setPlegado((p) => { guardarPlegado(!p); return !p; });

  // Ctrl+B pliega y despliega, como en el resto de FortexLink.
  useEffect(() => {
    const alTeclear = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); alternar(); }
    };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, []);

  // Al cambiar de sección, arriba. Sin esto, uno le pica a un cliente al final
  // de la lista y aterriza a media página de su ficha.
  useEffect(() => { window.scrollTo({ top: 0 }); setCajon(false); }, [pathname]);

  const cuentaDe = (to) => (to === '/admin' ? pendientes : 0);

  const cuerpoMenu = (expandido) => (
    <>
      <div
        className={`flex items-center shrink-0 border-b border-slate-100 ${expandido ? 'px-[22px]' : 'justify-center'}`}
        style={{ height: 'var(--topbar-h)' }}
      >
        <span className="text-xl font-bold tracking-tight select-none leading-none" style={{ color: 'var(--logo)' }}>
          {expandido ? 'Fortex' : 'F'}
        </span>
      </div>

      <nav className={`flex-1 overflow-y-auto py-3 ${expandido ? 'px-[18px]' : 'px-2'}`}>
        {secciones.map((s, i) => (
          <div key={s.label || i} className={i > 0 ? 'mt-5' : ''}>
            {s.label && expandido && (
              <div className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400 select-none">
                {s.label}
              </div>
            )}
            {s.label && !expandido && <div className="mx-1.5 mb-1.5 border-t border-slate-200" aria-hidden />}
            <div className="space-y-0.5">
              {s.items.map((it) => (
                <LinkMenu key={it.to} {...it} cuenta={cuentaDe(it.to)} plegado={!expandido} onIr={() => setCajon(false)} />
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );

  return (
    <div className="fx-admin flex">
      {/* Barra lateral: superficie, borde derecho, scroll propio. */}
      <aside
        className="hidden lg:flex flex-col shrink-0 bg-white border-r border-slate-200 sticky top-0 h-screen"
        style={{ width: ancho, transition: 'width 160ms ease-in-out' }}
      >
        {cuerpoMenu(!plegado)}
        <button
          onClick={alternar}
          title={`${plegado ? 'Expandir' : 'Contraer'} · Ctrl+B`}
          className={`flex items-center gap-2 mx-3 mb-3 px-2.5 py-[7px] rounded-md text-[12.5px] text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors ${
            plegado ? 'justify-center px-0' : ''
          }`}
        >
          {plegado ? <ChevronsRight className="h-4 w-4" /> : <><ChevronsLeft className="h-4 w-4" /> Contraer</>}
        </button>
      </aside>

      {/* En pantalla angosta el menú es un cajón. */}
      {cajon && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0" style={{ background: 'var(--overlay)' }} onClick={() => setCajon(false)} />
          <div className="absolute inset-y-0 left-0 flex flex-col bg-white border-r border-slate-200" style={{ width: 'var(--sidebar-w)' }}>
            <button onClick={() => setCajon(false)} className="absolute top-4 right-3 z-10 text-slate-400 hover:text-slate-800">
              <X className="h-4 w-4" />
            </button>
            {cuerpoMenu(true)}
          </div>
        </div>
      )}

      <div className="flex-1 min-w-0 flex flex-col">
        <header
          className="sticky top-0 z-20 border-b border-slate-200 grid items-center gap-3 px-4"
          style={{
            height: 'var(--topbar-h)',
            gridTemplateColumns: '1fr minmax(0, 440px) 1fr',
            background: 'var(--glass)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button onClick={() => setCajon(true)} className="lg:hidden text-slate-500 hover:text-slate-800" aria-label="Menú">
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-400 truncate">
              {user?.role === 'vendedor' ? 'Mi cartera de fianzas' : 'Portal de Fianzas'}
            </span>
          </div>

          <Buscador clientes={clientes} />

          <div className="flex items-center justify-end gap-1.5">
            {/* La campana lleva a "Para atender"; su número es el de esa
                pantalla, no otra cuenta. */}
            <Link
              to="/admin"
              className="relative flex items-center justify-center w-8 h-8 rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
              title="Para atender"
            >
              <Bell className="h-4 w-4" />
              {pendientes > 0 && (
                <span className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-indigo-600 text-white text-[10px] font-semibold leading-4 text-center tabular-nums">
                  {pendientes}
                </span>
              )}
            </Link>
            <div className="hidden sm:flex items-center gap-2 pl-1.5">
              <span className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-[10px] font-bold shrink-0">
                {iniciales(user?.nombre)}
              </span>
              <div className="min-w-0 leading-tight">
                <p className="text-xs font-semibold text-slate-800 truncate max-w-[140px]">{user?.nombre}</p>
                <p className="text-[11px] text-slate-400 truncate">{ROL_LABEL[user?.role] || user?.role}</p>
              </div>
            </div>
            <button
              onClick={onSalir}
              title="Salir"
              className="flex items-center justify-center w-8 h-8 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-700 transition-colors"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 min-w-0">
          <div className="w-full max-w-[1420px] mx-auto px-6 pt-6 pb-16">{children}</div>
        </main>
      </div>
    </div>
  );
}
