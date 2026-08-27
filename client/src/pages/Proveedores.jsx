// El portal del CONTRATANTE: el desarrollador que no compra fianzas, las exige.
//
// Es el hermano de Dashboard.jsx, pero la pregunta que contesta es otra. El
// fiado entra a ver cuánto tiene y cuánto paga; el desarrollador entra a ver
// UNA cosa: cuál de sus proveedores no le ha presentado la fianza. Por eso lo
// primero de la pantalla es el renglón en falta, no un total de dinero.
//
// Nada de aquí se captura: el contratante solo lee (ver routes/proveedores.js).
import { useEffect, useMemo, useState } from 'react';
import {
  LogOut, ShieldCheck, AlertTriangle, Users, Briefcase, FileDown, ChevronRight,
} from 'lucide-react';
import { api, getToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  mxn, mxnCents, fmtDate, EstadoBadge, ClaseBadge, CumplimientoBadge, estaDescubierta,
  etiquetaEstatus,
} from '../lib.jsx';

// La descarga pasa por la API, que vuelve a comprobar que ese archivo sea de una
// obra que este contratante alcanza. Un <a href> no llevaría el token.
//
// Si falla, HAY QUE DECIRLO: mientras la pestaña está abierta, Fortex puede
// haber dado de baja el documento o suspendido al proveedor, y entonces la API
// contesta 404. Tragándose el error, el usuario aprieta tres veces y concluye
// que el portal está roto.
async function descargar(doc, avisar) {
  try {
    const res = await fetch(`/api/proveedores/documentos/${doc.id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      avisar('No se pudo descargar el archivo. Puede que ya no esté disponible; recarga la página.');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.nombre_archivo;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    avisar('No se pudo descargar el archivo. Revisa tu conexión e inténtalo de nuevo.');
  }
}

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

// Tinte de fila por cumplimiento: el mismo lenguaje de color del resto del
// portal (rose = hay que actuar, amber = pronto, emerald = al día).
const filaCls = (estado) =>
  estado === 'sin_fianza' || estado === 'vencida' ? 'bg-rose-50/40'
  : estado === 'por_vencer' || estado === 'sin_vigencia' ? 'bg-amber-50/40'
  : '';

function Fianzas({ obra, avisar }) {
  if (!obra.fianzas.length) {
    return (
      <p className="px-4 py-3 text-xs text-slate-400">
        No hay ninguna fianza registrada en Fortex para esta obra.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
          <tr>
            <th className="text-left px-3 py-2">N° de póliza</th>
            <th className="text-left px-3 py-2">Tipo de fianza</th>
            <th className="text-left px-3 py-2">Afianzadora</th>
            <th className="text-right px-3 py-2">Monto afianzado</th>
            <th className="text-left px-3 py-2">Vigencia</th>
            <th className="text-left px-3 py-2">Estado</th>
            <th className="text-left px-3 py-2">Carátula</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {obra.fianzas.map((f) => (
            <tr key={f.id} className="hover:bg-slate-50/40">
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-slate-700">{f.numero_poliza}</span>
                  <ClaseBadge clase={f.clase} />
                </span>
              </td>
              <td className="px-3 py-1.5 text-slate-700 font-medium">{f.tipo_fianza}</td>
              <td className="px-3 py-1.5 text-slate-600">{f.afianzadora_nombre}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">
                {mxnCents(f.monto_afianzado)}
              </td>
              <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{fmtDate(f.fecha_vigencia)}</td>
              <td className="px-3 py-1.5"><EstadoBadge estado={f.estado} /></td>
              <td className="px-3 py-1.5">
                {f.documentos.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {f.documentos.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => descargar(d, avisar)}
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
                        title={d.nombre_archivo}
                      >
                        <FileDown className="h-3 w-3" /> {d.tipo_doc_nombre}
                      </button>
                    ))}
                  </div>
                ) : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Proveedor({ proveedor, obras, abierto, onToggle, avisar }) {
  const enFalta = proveedor.obras_descubiertas > 0;
  return (
    <div className={`portal-card bg-white border rounded-lg overflow-hidden ${
      enFalta ? 'border-rose-200' : 'border-slate-200'
    }`}>
      <button
        onClick={onToggle}
        className="w-full text-left px-4 py-3 hover:bg-slate-50/60 flex flex-wrap items-center gap-x-3 gap-y-1"
      >
        <ChevronRight className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${abierto ? 'rotate-90' : ''}`} />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-800 truncate">{proveedor.razon_social}</h3>
          <p className="text-[11px] text-slate-500">
            {proveedor.alias && <span className="text-slate-600">{proveedor.alias} · </span>}
            {proveedor.rfc || 'Sin RFC'}
            {proveedor.obras_vivas > 0 && ` · ${proveedor.obras_vivas} obra(s) vigente(s)`}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {proveedor.monto_afianzado > 0 && (
            <span className="text-[11px] text-slate-500 hidden sm:inline">
              Afianzado <span className="tabular-nums font-semibold text-slate-700">
                {mxn(proveedor.monto_afianzado)}
              </span>
            </span>
          )}
          <CumplimientoBadge estado={proveedor.cumplimiento} />
        </div>
      </button>

      {proveedor.notas && (
        <p className="px-4 pb-2 -mt-1 text-[11px] text-slate-400 pl-11">{proveedor.notas}</p>
      )}

      {abierto && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {obras.length === 0 && (
            <p className="px-4 py-4 text-xs text-slate-400">
              Todavía no hay ninguna obra ligada a este proveedor. Pídele a Fortex que la registre.
            </p>
          )}
          {obras.map((o) => (
            /* Una obra cerrada o cancelada NO se tiñe de rojo ni lleva chip de
               cumplimiento: no hay cobertura que exigirle, y el servidor ya la
               dejó fuera de los KPIs. Sin esto, la pantalla decía "0 obras sin
               fianza vigente" arriba y pintaba un renglón rojo tres centímetros
               abajo. En su lugar se dice el estatus, que es el dato que explica
               por qué no se está juzgando. */
            <div key={o.id} className={o.viva ? filaCls(o.estado_cobertura) : ''}>
              <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className={`text-sm font-medium ${o.viva ? 'text-slate-700' : 'text-slate-500'}`}>
                  {o.nombre}
                </span>
                {o.numero_contrato && (
                  <span className="text-[11px] font-mono text-slate-500">{o.numero_contrato}</span>
                )}
                <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
                  {o.monto_contrato > 0 && (
                    <span>Contrato <span className="tabular-nums text-slate-700">{mxn(o.monto_contrato)}</span></span>
                  )}
                  {o.viva && o.monto_contrato > 0 && o.monto_afianzado > 0 && (
                    <span className="text-slate-400">
                      {Math.round((o.monto_afianzado / o.monto_contrato) * 100)}% afianzado
                    </span>
                  )}
                  {o.viva ? (
                    <CumplimientoBadge estado={o.estado_cobertura} />
                  ) : (
                    <span
                      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 whitespace-nowrap"
                      title="Esta obra ya no se juzga: no hay cobertura que exigir."
                    >
                      {etiquetaEstatus(o.estatus)}
                    </span>
                  )}
                </div>
              </div>
              <Fianzas obra={o} avisar={avisar} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Proveedores() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [abierto, setAbierto] = useState(null);
  const [soloEnFalta, setSoloEnFalta] = useState(false);

  useEffect(() => {
    api.get('/proveedores').then(setData).catch((e) => setError(e.message));
  }, []);

  const m = data?.metricas;

  // Los que deben algo, primero. Es el orden que hace útil la pantalla: quien
  // entra a las nueve de la mañana quiere ver el renglón rojo, no la lista
  // alfabética completa.
  const proveedores = useMemo(() => {
    const lista = (data?.proveedores || []).filter(
      (p) => !soloEnFalta || p.obras_descubiertas > 0
    );
    const peso = (p) => (p.obras_descubiertas > 0 ? 0
      : estaDescubierta(p.cumplimiento) || p.cumplimiento === 'por_vencer' ? 1 : 2);
    return [...lista].sort(
      (a, b) => peso(a) - peso(b) || a.razon_social.localeCompare(b.razon_social, 'es')
    );
  }, [data, soloEnFalta]);

  const obrasDe = (id) => (data?.obras || []).filter((o) => o.client_id === id);

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
              Mis proveedores
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              La fianza que cada proveedor presentó por tus obras
              {m ? ` · ${m.proveedores} proveedor(es) en el padrón` : ''}
            </p>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">No se pudo cargar el padrón.</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {aviso && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{aviso}</span>
            <button onClick={() => setAviso('')} className="text-amber-500 hover:text-amber-800 shrink-0">
              ✕
            </button>
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
                onClick={() => setSoloEnFalta((v) => !v)}
                className="underline hover:no-underline"
              >
                {soloEnFalta ? 'Ver todos' : 'Ver solo esos'}
              </button>
            </div>
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

        <div className="space-y-3">
          {proveedores.map((p) => (
            <Proveedor
              key={p.id}
              proveedor={p}
              obras={obrasDe(p.id)}
              abierto={abierto === p.id}
              onToggle={() => setAbierto((a) => (a === p.id ? null : p.id))}
              avisar={setAviso}
            />
          ))}

          {data && !proveedores.length && (
            <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center text-sm text-slate-400">
              {soloEnFalta
                ? 'Ningún proveedor tiene obras sin fianza vigente.'
                : (
                  <span className="flex flex-col items-center gap-2">
                    <Users className="w-5 h-5 text-slate-300" />
                    Todavía no hay proveedores en tu padrón. Los registra Fortex.
                  </span>
                )}
            </div>
          )}
        </div>

        {/* Se dice en la pantalla y no solo en el README: el portal sabe de las
            fianzas que colocó Fortex, y de ninguna otra. Sin esta línea, un
            "Sin registro" se lee como "tu proveedor no cumplió". */}
        {data && (
          <p className="mt-6 text-[11px] text-slate-400 leading-relaxed">
            Este padrón muestra las fianzas registradas en Fortex. Si un proveedor
            contrató su fianza con otro agente, aquí aparecerá como
            <span className="font-medium"> sin registro</span> aunque la tenga:
            pídesela directamente o dile que la tramite con Fortex.
          </p>
        )}
      </main>
    </div>
  );
}
