// El portal del CONTRATANTE: el desarrollador que no compra fianzas, las exige.
//
// Es el hermano de Dashboard.jsx, pero la pregunta que contesta es otra. El
// fiado entra a ver cuánto tiene y cuánto paga; el desarrollador entra a ver UNA
// cosa: cuál de sus proveedores no le ha presentado la fianza. Por eso lo
// primero de la pantalla es el renglón en falta, no un total de dinero.
//
// Dos pantallas: el PADRÓN (la lista, con lo que falta arriba) y el DETALLE de un
// proveedor, al que se llega picándole. Lo único que se escribe desde aquí es la
// carpeta de la obra: la fianza que el proveedor entregó en papel, el contrato.
// Esos archivos son del contratante, no del proveedor.
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  LogOut, ShieldCheck, AlertTriangle, Users, Briefcase, FileDown, ChevronRight,
  ArrowLeft, Upload, Paperclip, Trash2, CheckCircle2,
} from 'lucide-react';
import { api, getToken, subirACloudinary } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  mxn, mxnCents, fmtDate, EstadoBadge, ClaseBadge, CumplimientoBadge, estaDescubierta,
  etiquetaEstatus, ACCEPT_ARCHIVOS, AYUDA_ARCHIVOS, pesoArchivo, revisarArchivo,
} from '../lib.jsx';

const btnChico =
  'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300';

// La descarga pasa por la API, que vuelve a comprobar que ese archivo sea de una
// obra que este contratante alcanza. Un <a href> no llevaría el token.
//
// Si falla, HAY QUE DECIRLO: mientras la pestaña está abierta, Fortex puede haber
// dado de baja el documento o suspendido al proveedor, y entonces la API contesta
// 404. Tragándose el error, el usuario aprieta tres veces y concluye que el
// portal está roto.
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

/* --------------------------------------------------------------------------
   La tabla de pólizas de una obra
   -------------------------------------------------------------------------- */

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

/* --------------------------------------------------------------------------
   La carpeta de la obra: lo que el contratante recibió o guarda
   --------------------------------------------------------------------------
   Es SU carpeta, no la del proveedor: el archivo se sube bajo su propia cuenta
   y el proveedor no lo ve. Y un PDF aquí NO es una póliza capturada — no mueve
   ninguna cifra de la pantalla. Es el papel que respalda que sí la presentó, y
   le sirve a Fortex para capturarla si acaba colocándola. */

function CarpetaDeObra({ obra, clienteId, tipos, onCambio, avisar }) {
  const [tipoDoc, setTipoDoc] = useState(tipos[0]?.clave || 'fianza_presentada');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const docs = obra.mis_documentos || [];

  async function subir(archivo) {
    if (!archivo) return;
    setError('');
    // Se revisa aquí, antes de pedir la firma: así el usuario se entera de que
    // su escaneo no cabe ANTES de esperar a que se suban ocho megas.
    const problema = revisarArchivo(archivo);
    if (problema) return setError(problema);

    setSubiendo(true);
    try {
      // Va directo a Cloudinary, bajo la carpeta de ESTE contratante; a la API
      // solo se le dice dónde quedó.
      const subido = await subirACloudinary(clienteId, archivo);
      await api.post(`/proveedores/obras/${obra.id}/documentos`, { ...subido, tipo_doc: tipoDoc });
      await onCambio();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubiendo(false);
    }
  }

  async function quitar(id) {
    setError('');
    try {
      await api.del(`/proveedores/documentos/${id}`);
      await onCambio();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40">
      <p className="text-xs font-medium text-slate-600">
        Documentos que recibiste de esta obra
        <span className="font-normal text-slate-400">
          {' '}· son tuyos: el proveedor no los ve
        </span>
      </p>

      {docs.length > 0 && (
        <div className="mt-2 divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700 shrink-0">{d.tipo_doc_nombre}</span>
              <span className="text-slate-500 truncate">{d.nombre_archivo}</span>
              <span className="text-slate-400 tabular-nums shrink-0">{pesoArchivo(d.size_bytes)}</span>
              {/* Quién lo consiguió. Importa: "lo subió Fortex" quiere decir que
                  el proveedor se lo entregó a ellos, no a ti. */}
              {d.subido_por === 'fortex' && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                  lo cargó Fortex
                </span>
              )}
              <button onClick={() => descargar(d, avisar)} className={`${btnChico} ml-auto shrink-0`}>
                <FileDown className="h-3.5 w-3.5" /> Ver
              </button>
              <button
                onClick={() => quitar(d.id)}
                className={`${btnChico} hover:border-rose-300 hover:text-rose-600 shrink-0`}
                title="Quitar este documento"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={tipoDoc}
          onChange={(e) => setTipoDoc(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-slate-200 bg-white text-slate-700"
        >
          {tipos.map((t) => <option key={t.clave} value={t.clave}>{t.nombre}</option>)}
        </select>
        <label className={`${btnChico} cursor-pointer ${subiendo ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload className="h-3.5 w-3.5" />
          {subiendo ? 'Subiendo…' : 'Subir archivo'}
          <input
            type="file"
            accept={ACCEPT_ARCHIVOS}
            className="hidden"
            onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }}
          />
        </label>
        <span className="text-[11px] text-slate-400">{AYUDA_ARCHIVOS}</span>
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Una obra, con sus pólizas y su carpeta
   -------------------------------------------------------------------------- */

function Obra({ obra, clienteId, tipos, onCambio, avisar }) {
  return (
    /* Una obra cerrada o cancelada NO se tiñe de rojo ni lleva chip de
       cumplimiento: no hay cobertura que exigirle, y el servidor ya la dejó
       fuera de los KPIs. En su lugar se dice el estatus, que es el dato que
       explica por qué no se está juzgando. */
    <div className={obra.viva ? filaCls(obra.estado_cobertura) : ''}>
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className={`text-sm font-medium ${obra.viva ? 'text-slate-700' : 'text-slate-500'}`}>
          {obra.nombre}
        </span>
        {obra.numero_contrato && (
          <span className="text-[11px] font-mono text-slate-500">{obra.numero_contrato}</span>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          {obra.monto_contrato > 0 && (
            <span>Contrato <span className="tabular-nums text-slate-700">{mxn(obra.monto_contrato)}</span></span>
          )}
          {obra.viva && obra.monto_contrato > 0 && obra.monto_afianzado > 0 && (
            <span className="text-slate-400">
              {Math.round((obra.monto_afianzado / obra.monto_contrato) * 100)}% afianzado
            </span>
          )}
          {obra.viva ? (
            <CumplimientoBadge estado={obra.estado_cobertura} />
          ) : (
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 whitespace-nowrap"
              title="Esta obra ya no se juzga: no hay cobertura que exigir."
            >
              {etiquetaEstatus(obra.estatus)}
            </span>
          )}
        </div>
      </div>
      <Fianzas obra={obra} avisar={avisar} />
      <CarpetaDeObra
        obra={obra}
        clienteId={clienteId}
        tipos={tipos}
        onCambio={onCambio}
        avisar={avisar}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------
   Pantalla 2: el detalle de un proveedor
   -------------------------------------------------------------------------- */

function DetalleProveedor({ detalle, clienteId, tipos, onVolver, onCambio, avisar }) {
  const { proveedor, obras = [] } = detalle;
  return (
    <>
      <button onClick={onVolver} className={`${btnChico} mb-4`}>
        <ArrowLeft className="h-3.5 w-3.5" /> Volver al padrón
      </button>

      <div className="portal-card bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{proveedor?.razon_social}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {proveedor?.alias && <span className="text-slate-600">{proveedor.alias} · </span>}
              {proveedor?.rfc || 'Sin RFC'}
            </p>
            {proveedor?.notas && (
              <p className="text-[11px] text-slate-400 mt-1">{proveedor.notas}</p>
            )}
          </div>
          <CumplimientoBadge estado={proveedor?.cumplimiento} />
        </div>
      </div>

      <div className="space-y-4">
        {obras.map((o) => (
          <div key={o.id} className="portal-card bg-white border border-slate-200 rounded-lg overflow-hidden">
            <Obra
              obra={o}
              clienteId={clienteId}
              tipos={tipos}
              onCambio={onCambio}
              avisar={avisar}
            />
          </div>
        ))}
        {!obras.length && (
          <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center text-sm text-slate-400">
            Todavía no hay ninguna obra ligada a este proveedor. Pídele a Fortex que la registre.
          </div>
        )}
      </div>
    </>
  );
}

/* --------------------------------------------------------------------------
   Pantalla 1: el padrón
   -------------------------------------------------------------------------- */

function RenglonProveedor({ proveedor, onAbrir }) {
  const enFalta = proveedor.obras_descubiertas > 0;
  return (
    <button
      onClick={onAbrir}
      className={`portal-card w-full text-left bg-white border rounded-lg px-4 py-3 hover:bg-slate-50/60 flex flex-wrap items-center gap-x-3 gap-y-1 ${
        enFalta ? 'border-rose-200' : 'border-slate-200'
      }`}
    >
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
        <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
      </div>
    </button>
  );
}

export default function Proveedores() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [soloEnFalta, setSoloEnFalta] = useState(false);

  const cargarPadron = useCallback(
    () => api.get('/proveedores').then(setData).catch((e) => setError(e.message)),
    []
  );
  // Si el detalle no carga se REGRESA al padrón con el aviso. Quedándose en
  // 'Cargando…' no hay ni botón de volver: la pantalla se queda muerta. Pasa de
  // verdad — a un proveedor lo pueden suspender del padrón mientras esta pestaña
  // está abierta, y entonces la ruta contesta 404.
  const cargarDetalle = useCallback(
    (id) => api.get(`/proveedores/${id}`).then(setDetalle).catch((e) => {
      setError(e.message);
      setSel(null);
      setDetalle(null);
    }),
    []
  );

  useEffect(() => {
    cargarPadron();
    api.get('/proveedores/tipos-documento').then((d) => setTipos(d.tipos)).catch(() => {});
  }, [cargarPadron]);

  // Al subir o quitar un archivo se recargan las dos: el padrón porque de él
  // cuelgan las cifras de arriba, y el detalle porque es lo que está en pantalla.
  const recargar = useCallback(async () => {
    await cargarPadron();
    if (sel) await cargarDetalle(sel);
  }, [cargarPadron, cargarDetalle, sel]);

  function abrir(id) {
    setSel(id);
    setDetalle(null);
    cargarDetalle(id);
  }

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
              <p className="font-medium">No se pudo cargar la información.</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {aviso && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2 mb-5">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{aviso}</span>
            <button onClick={() => setAviso('')} className="text-amber-500 hover:text-amber-800 shrink-0">✕</button>
          </div>
        )}

        {sel ? (
          detalle ? (
            <DetalleProveedor
              detalle={detalle}
              clienteId={user?.client_id}
              tipos={tipos}
              onVolver={() => { setSel(null); setDetalle(null); }}
              onCambio={recargar}
              avisar={setAviso}
            />
          ) : (
            <div className="text-sm text-slate-400 py-10 text-center">Cargando…</div>
          )
        ) : (
          <>
            {/* Lo primero de la pantalla es lo que falta, no un total. */}
            {m?.obras_descubiertas > 0 && (
              <div className="portal-alert rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2 mb-5">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <div>
                  <span className="font-medium">
                    {m.obras_descubiertas} obra(s) sin fianza vigente
                  </span>
                  {' '}en {m.proveedores_en_falta} proveedor(es).{' '}
                  <button onClick={() => setSoloEnFalta((v) => !v)} className="underline hover:no-underline">
                    {soloEnFalta ? 'Ver todos' : 'Ver solo esos'}
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

            <div className="space-y-2">
              {proveedores.map((p) => (
                <RenglonProveedor key={p.id} proveedor={p} onAbrir={() => abrir(p.id)} />
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
          </>
        )}

        {/* Se dice en la pantalla y no solo en el README: el portal sabe de las
            fianzas que colocó Fortex, y de ninguna otra. Sin esta línea, un
            "Sin registro" se lee como "tu proveedor no cumplió". */}
        {data && (
          <p className="mt-6 text-[11px] text-slate-400 leading-relaxed">
            Este padrón muestra las fianzas registradas en Fortex. Si un proveedor
            contrató su fianza con otro agente, aquí aparecerá como
            <span className="font-medium"> sin registro</span> aunque la tenga: puedes
            subir el PDF que te entregó en <span className="font-medium">Documentos que
            recibiste</span>, dentro de la obra, y pedirle a Fortex que la capture.
          </p>
        )}
      </main>
    </div>
  );
}
