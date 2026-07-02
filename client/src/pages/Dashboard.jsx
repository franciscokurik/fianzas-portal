import { useEffect, useState } from 'react';
import { ShieldCheck, LogOut, FileText, AlertTriangle, Wallet, CreditCard } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { mxn } from '../lib.jsx';
import MisFianzas from '../components/MisFianzas.jsx';
import Documentos from '../components/Documentos.jsx';

// KPI card con color semántico. tone: emerald | sky | violet | amber
const TONES = {
  emerald: { bg: 'bg-emerald-50', label: 'text-emerald-700', value: 'text-emerald-900' },
  sky:     { bg: 'bg-sky-50',     label: 'text-sky-700',     value: 'text-sky-900' },
  violet:  { bg: 'bg-violet-50',  label: 'text-violet-700',  value: 'text-violet-900' },
  amber:   { bg: 'bg-amber-50',   label: 'text-amber-700',   value: 'text-amber-900' },
};

function Kpi({ label, value, sub, tone = 'sky' }) {
  const t = TONES[tone];
  return (
    <div className={`${t.bg} rounded-xl p-3 border border-slate-100`}>
      <div className={`text-[10px] uppercase tracking-wider font-medium ${t.label}`}>{label}</div>
      <div className={`text-xl font-bold tabular-nums mt-0.5 ${t.value}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('fianzas');

  useEffect(() => {
    api.get('/dashboard').then(setData).catch(console.error);
  }, []);

  const m = data?.metricas;
  const a = data?.alertas;
  const pendientes = [];
  if (m?.fianzas_por_vencer_30 > 0) pendientes.push(`${m.fianzas_por_vencer_30} fianza(s) por vencer`);
  if (a?.documentos_pendientes > 0) pendientes.push(`${a.documentos_pendientes} documento(s) faltante(s)`);
  if (a?.papeleria_pendiente > 0) pendientes.push(`${a.papeleria_pendiente} solicitud(es) de papelería`);

  const tabs = [
    ['fianzas', 'Mis fianzas'],
    ['documentos', 'Documentos del fiado'],
  ];

  return (
    <div className="min-h-screen">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-700">Fortex · Portal de Fianzas</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500 hidden sm:inline">{data?.razon_social || user?.razon_social}</span>
            <button
              onClick={logout}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300"
            >
              <LogOut className="h-3.5 w-3.5" /> Salir
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Page header */}
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <Wallet className="w-5 h-5 text-indigo-600" />
              {data?.razon_social || 'Mi panel'}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">Resumen de tus fianzas y documentación</p>
          </div>
        </div>

        {/* Callout de pendientes */}
        {pendientes.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">Tienes pendientes:</span> {pendientes.join(' · ')}
            </div>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Kpi tone="emerald" label="Línea disponible total" value={mxn(m?.linea_disponible)}
               sub={m ? `de ${mxn(m.linea_credito_total)} autorizado` : null} />
          <Kpi tone="sky" label="Fianzas activas" value={m?.fianzas_activas ?? '—'} />
          <Kpi tone="violet" label="Prima neta total" value={mxn(m?.prima_neta_total)} />
          <Kpi tone="amber" label="Por vencer (< 30 días)" value={m?.fianzas_por_vencer_30 ?? '—'} />
        </div>

        {/* Líneas de crédito por afianzadora */}
        {m?.lineas?.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden mb-6">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-semibold text-slate-700">Líneas de crédito por afianzadora</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-2">Afianzadora</th>
                    <th className="text-right px-3 py-2">Línea autorizada</th>
                    <th className="text-right px-3 py-2">Comprometido</th>
                    <th className="text-right px-3 py-2">Disponible</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {m.lineas.map((l) => (
                    <tr key={l.afianzadora_id} className="hover:bg-slate-50/40">
                      <td className="px-3 py-1.5 text-slate-700 font-medium">{l.afianzadora_nombre}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{mxn(l.linea_credito)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{mxn(l.comprometido)}</td>
                      <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${l.disponible < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {mxn(l.disponible)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-1 border-b border-slate-200 mb-5">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === key
                  ? 'border-indigo-600 text-indigo-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label === 'Documentos del fiado'
                ? <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" />{label}</span>
                : label}
            </button>
          ))}
        </div>

        {tab === 'fianzas' ? <MisFianzas /> : <Documentos />}
      </main>
    </div>
  );
}
