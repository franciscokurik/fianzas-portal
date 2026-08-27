// El portal del CONTRATANTE: el desarrollador que no compra fianzas, las exige.
//
// Es el hermano de Dashboard.jsx, pero la pregunta que contesta es otra. El
// fiado entra a ver cuánto tiene y cuánto paga; el desarrollador entra a ver UNA
// cosa: cuál de sus proveedores no le ha presentado la fianza. Por eso lo
// primero de la pantalla es el renglón en falta, no un total de dinero.
//
// Este archivo es la cáscara —topbar, cifras, pestañas y avisos— y cada pestaña
// es un componente, igual que Dashboard.jsx con MisFianzas y Documentos:
//
//   PROYECTOS  -> sus desarrollos, con los proveedores adentro. Es lo que pidió:
//                 la torre completa en un lugar. Y es lo ÚNICO que él captura.
//   PROVEEDORES -> el padrón, la misma información vista por empresa. Sirve para
//                 la pregunta de la mañana: ¿a quién le falta la fianza?
import { useCallback, useEffect, useState } from 'react';
import {
  LogOut, ShieldCheck, AlertTriangle, Building2, Users, CheckCircle2,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { mxn } from '../lib.jsx';
import ProyectosContratante from '../components/ProyectosContratante.jsx';
import PadronContratante from '../components/PadronContratante.jsx';

const TONES = {
  emerald: { bg: 'bg-emerald-50', label: 'text-emerald-700', value: 'text-emerald-900' },
  sky:     { bg: 'bg-sky-50',     label: 'text-sky-700',     value: 'text-sky-900' },
  amber:   { bg: 'bg-amber-50',   label: 'text-amber-700',   value: 'text-amber-900' },
  rose:    { bg: 'bg-rose-50',    label: 'text-rose-700',    value: 'text-rose-900' },
};

function Kpi({ label, value, sub, tone = 'sky' }) {
  const t = TONES[tone];
  return (
    <div className={`portal-kpi portal-kpi-${tone} ${t.bg} rounded-xl p-3 border border-slate-100`}>
      <div className={`portal-kpi-label text-[10px] uppercase tracking-wider font-medium ${t.label}`}>{label}</div>
      <div className={`portal-kpi-value text-xl font-bold tabular-nums mt-0.5 ${t.value}`}>{value}</div>
      {sub && <div className="portal-kpi-sub text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function Proveedores() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [tab, setTab] = useState('proyectos');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [msg, setMsg] = useState('');
  const [soloEnFalta, setSoloEnFalta] = useState(false);

  const cargar = useCallback(
    () => api.get('/proveedores').then(setData).catch((e) => setError(e.message)),
    []
  );

  useEffect(() => {
    cargar();
    // Los tipos de documento se piden una vez y bajan a las dos pestañas: son
    // un catálogo del servidor, no algo que cambie mientras se navega.
    api.get('/proveedores/tipos-documento').then((d) => setTipos(d.tipos)).catch(() => {});
  }, [cargar]);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
  const m = data?.metricas;

  return (
    <div className="portal-shell portal-client min-h-screen">
      <header className="portal-topbar bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="portal-topbar-inner max-w-7xl mx-auto px-6 py-3">
          <span className="portal-monogram" aria-hidden="true">F</span>
          <div className="portal-brand">
            <span className="portal-brand-name text-sm font-semibold text-slate-700">
              <strong>FORTEX</strong>
              <small>CONTROL DE PROVEEDORES</small>
            </span>
          </div>
          <div className="portal-topbar-actions flex items-center gap-3">
            <span className="portal-user-chip text-sm text-slate-500 hidden sm:inline">
              {data?.razon_social || user?.razon_social}
            </span>
            <button
              onClick={logout}
              className="portal-logout flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300"
            >
              <LogOut className="h-3.5 w-3.5" /> Salir
            </button>
          </div>
        </div>
      </header>

      <main className="portal-main max-w-7xl mx-auto px-6 py-6">
        <div className="portal-page-heading flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <p className="portal-eyebrow">Cumplimiento de contratistas</p>
            <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              Mis proyectos y proveedores
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              La fianza que cada proveedor presentó por tus obras
              {m ? ` · ${m.proyectos} proyecto(s), ${m.proveedores} proveedor(es)` : ''}
            </p>
          </div>
        </div>

        {msg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {msg}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">No se pudo cargar la información.</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-700 shrink-0">✕</button>
          </div>
        )}

        {aviso && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{aviso}</span>
            <button onClick={() => setAviso('')} className="text-amber-500 hover:text-amber-800 shrink-0">✕</button>
          </div>
        )}

        {/* Lo primero de la pantalla es lo que falta, no un total. */}
        {m?.obras_descubiertas > 0 && (
          <div className="portal-alert rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">
                {m.obras_descubiertas} obra(s) sin fianza vigente
              </span>
              {' '}en {m.proveedores_en_falta} proveedor(es).{' '}
              <button
                onClick={() => { setTab('padron'); setSoloEnFalta(true); }}
                className="underline hover:no-underline"
              >
                Ver quiénes
              </button>
            </div>
          </div>
        )}

        {m?.obras_descubiertas === 0 && m?.obras_vivas > 0 && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 flex items-center gap-2 mb-5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            Todas tus obras vigentes tienen fianza registrada.
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          {/* "Vigentes" y no "en curso": el conjunto incluye las terminadas y
              entregadas a propósito, porque ahí vive la fianza de vicios
              ocultos. Las cerradas y canceladas se listan pero no cuentan. */}
          <Kpi tone="rose" label="Obras sin fianza vigente" value={m?.obras_descubiertas ?? '—'}
               sub={m ? `de ${m.obras_vivas} obra(s) vigente(s)` : null} />
          <Kpi tone="emerald" label="Obras con fianza" value={m?.obras_cubiertas ?? '—'}
               sub="fianza emitida y vigente" />
          <Kpi tone="amber" label="Por vencer (< 30 días)" value={m?.obras_por_vencer ?? '—'} />
          {/* Es la cobertura A TU FAVOR: lo que las fianzas vigentes de tus
              proveedores cubren hoy. No es dinero tuyo ni un pasivo tuyo. */}
          <Kpi tone="sky" label="Cobertura a tu favor" value={mxn(m?.monto_afianzado)}
               sub={m?.previos_en_tramite > 0
                 ? `${m.previos_en_tramite} previo(s) en trámite`
                 : 'suma de las fianzas vigentes'} />
        </div>

        <div className="portal-tabs flex items-center gap-1 border-b border-slate-200 mb-5">
          {[
            ['proyectos', 'Mis proyectos', Building2, m?.proyectos],
            ['padron', 'Proveedores', Users, m?.proveedores],
          ].map(([key, label, Icono, cuenta]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`portal-tab px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
                tab === key
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icono className="h-3.5 w-3.5" />
              {label}
              {cuenta != null && <span className="tabular-nums text-slate-400">({cuenta})</span>}
            </button>
          ))}
          {tab === 'padron' && soloEnFalta && (
            <button
              onClick={() => setSoloEnFalta(false)}
              className="ml-auto text-xs text-slate-500 underline hover:no-underline"
            >
              Ver todos los proveedores
            </button>
          )}
        </div>

        {tab === 'proyectos' ? (
          <ProyectosContratante
            clienteId={user?.client_id}
            tipos={tipos}
            onCambio={cargar}
            avisar={setAviso}
            flash={flash}
          />
        ) : (
          <PadronContratante
            proveedores={data?.proveedores || []}
            clienteId={user?.client_id}
            tipos={tipos}
            soloEnFalta={soloEnFalta}
            onCambio={cargar}
            avisar={setAviso}
          />
        )}

        {/* Se dice en la pantalla y no solo en el README: el portal sabe de las
            fianzas que colocó Fortex, y de ninguna otra. Sin esta línea, un
            "Sin registro" se lee como "tu proveedor no cumplió". */}
        {data && (
          <p className="mt-6 text-[11px] text-slate-400 leading-relaxed">
            Este portal muestra las fianzas registradas en Fortex. Si un proveedor contrató
            su fianza con otro agente, aquí aparecerá como
            <span className="font-medium"> sin registro</span> aunque la tenga: puedes subir
            el PDF que te entregó en <span className="font-medium">Documentos que recibiste</span>,
            dentro de la obra, y pedirle a Fortex que la capture.
          </p>
        )}
      </main>
    </div>
  );
}
