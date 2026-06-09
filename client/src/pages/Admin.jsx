import { useEffect, useState } from 'react';
import {
  ShieldCheck, LogOut, Building2, Plus, Save, Download,
  Users, FileText, Files, CheckCircle2,
} from 'lucide-react';
import { api, getToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import { mxn, mxnCents, fmtDate, EstadoBadge } from '../lib.jsx';

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100';
const btnPrimary =
  'flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50';
const btnSecondary =
  'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300';

export default function Admin() {
  const { logout } = useAuth();
  const [clientes, setClientes] = useState([]);
  const [afianzadoras, setAfianzadoras] = useState([]);
  const [sel, setSel] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [msg, setMsg] = useState('');

  const cargarClientes = () => api.get('/admin/clientes').then((d) => setClientes(d.clientes));
  const cargarAfianzadoras = () => api.get('/admin/afianzadoras').then((d) => setAfianzadoras(d.afianzadoras));

  useEffect(() => { cargarClientes(); cargarAfianzadoras(); }, []);

  function abrirDetalle(id) {
    setSel(id);
    api.get(`/admin/clientes/${id}/detalle`).then(setDetalle);
  }
  const recargarDetalle = () => sel && api.get(`/admin/clientes/${sel}/detalle`).then(setDetalle);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-slate-700">Fortex · Administración de Fianzas</span>
          </div>
          <button onClick={logout} className={btnSecondary}>
            <LogOut className="h-3.5 w-3.5" /> Salir
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" /> Panel de administración
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">Home Office · gestión de clientes y pólizas</p>
          </div>
        </div>

        {msg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {msg}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Columna izquierda */}
          <div className="space-y-4">
            <NuevaAfianzadora onDone={() => { cargarAfianzadoras(); flash('Afianzadora agregada'); }} />

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">Clientes ({clientes.length})</h3>
              </div>
              <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
                {clientes.map((c) => {
                  const alerta = c.fianzas_vencidas > 0 || c.docs_pendientes > 0 || c.papeleria_pendiente > 0 || c.fianzas_por_vencer > 0;
                  return (
                    <button
                      key={c.id}
                      onClick={() => abrirDetalle(c.id)}
                      className={`w-full text-left px-4 py-2.5 hover:bg-slate-50/60 ${sel === c.id ? 'bg-indigo-50/60' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-700">{c.razon_social}</span>
                        {alerta && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                        {c.total_fianzas} fianzas · {c.fianzas_vencidas} vencidas · {c.docs_pendientes} docs pend.
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Columna derecha: detalle */}
          <div className="lg:col-span-2 space-y-4">
            {!detalle ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center text-sm text-slate-400">
                Selecciona un cliente para ver y gestionar su información.
              </div>
            ) : (
              <DetalleCliente
                detalle={detalle}
                afianzadoras={afianzadoras}
                onChange={() => { recargarDetalle(); cargarClientes(); }}
                flash={flash}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function NuevaAfianzadora({ onDone }) {
  const [nombre, setNombre] = useState('');
  async function add() {
    if (!nombre) return;
    await api.post('/admin/afianzadoras', { nombre });
    setNombre('');
    onDone();
  }
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Agregar afianzadora</h3>
      <div className="flex gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className={inputCls} />
        <button onClick={add} className={btnPrimary}><Plus className="w-4 h-4" /> Añadir</button>
      </div>
    </div>
  );
}

function DetalleCliente({ detalle, afianzadoras, onChange, flash }) {
  const { cliente, fianzas, documentos, papeleria } = detalle;

  function descargar(rel) {
    fetch(`/api/admin/descargar?path=${encodeURIComponent(rel)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = rel.split('/').pop(); a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <>
      {/* Encabezado del cliente */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-base font-semibold text-slate-800">{cliente.razon_social}</h2>
        <p className="text-xs text-slate-500 mt-0.5">{cliente.rfc} · {cliente.email}</p>
        <div className="mt-2 inline-flex items-center gap-1.5 text-xs bg-emerald-50 text-emerald-700 px-2 py-1 rounded-md">
          Línea de crédito: <span className="font-semibold tabular-nums">{mxn(cliente.linea_credito)}</span>
        </div>
      </div>

      {/* Fianzas */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">Fianzas ({fianzas.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2">Póliza</th>
                <th className="text-left px-3 py-2">Afianzadora</th>
                <th className="text-left px-3 py-2">Tipo</th>
                <th className="text-right px-3 py-2">Prima</th>
                <th className="text-left px-3 py-2">Vigencia</th>
                <th className="text-left px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fianzas.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50/40">
                  <td className="px-3 py-1.5 font-mono text-slate-700">{f.numero_poliza}</td>
                  <td className="px-3 py-1.5 text-slate-600">{f.afianzadora_nombre}</td>
                  <td className="px-3 py-1.5 text-slate-700 font-medium">{f.tipo_fianza}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{mxnCents(f.prima_neta)}</td>
                  <td className="px-3 py-1.5 text-slate-600">{fmtDate(f.fecha_vigencia)}</td>
                  <td className="px-3 py-1.5"><EstadoBadge estado={f.estado} /></td>
                </tr>
              ))}
              {!fianzas.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">Sin fianzas.</td></tr>}
            </tbody>
          </table>
        </div>
        <NuevaFianza clienteId={cliente.id} afianzadoras={afianzadoras} onDone={() => { onChange(); flash('Fianza agregada'); }} />
      </div>

      {/* Documentos */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <FileText className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">Documentos del cliente</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {documentos.map((d) => (
            <div key={d.document_type_id} className="flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-50/40">
              <span className="text-slate-700">{d.nombre}</span>
              <span className="flex items-center gap-3">
                {d.uploaded_at ? (
                  <>
                    <span className="text-[11px] text-slate-500">{fmtDate(d.uploaded_at)}</span>
                    {d.file_path && (
                      <button onClick={() => descargar(d.file_path)} className={btnSecondary}>
                        <Download className="h-3.5 w-3.5" /> Descargar
                      </button>
                    )}
                  </>
                ) : <EstadoBadge estado="pendiente" />}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Papelería específica */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
          <Files className="w-4 h-4 text-slate-500" />
          <h3 className="text-sm font-semibold text-slate-700">Papelería específica</h3>
        </div>
        <div className="divide-y divide-slate-100">
          {papeleria.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-slate-50/40">
              <span className="flex-1 text-slate-700">
                {p.descripcion}
                {p.afianzadora_nombre && <span className="text-slate-400"> · {p.afianzadora_nombre}</span>}
              </span>
              <EstadoBadge estado={p.estado} />
              {p.file_path && (
                <button onClick={() => descargar(p.file_path)} className={btnSecondary}>
                  <Download className="h-3.5 w-3.5" /> Ver
                </button>
              )}
            </div>
          ))}
          {!papeleria.length && <div className="px-4 py-6 text-center text-xs text-slate-400">Sin solicitudes.</div>}
        </div>
        <NuevaPapeleria clienteId={cliente.id} afianzadoras={afianzadoras} onDone={() => { onChange(); flash('Solicitud creada'); }} />
      </div>
    </>
  );
}

function Req() { return <span className="text-rose-500">*</span>; }

function NuevaFianza({ clienteId, afianzadoras, onDone }) {
  const empty = { afianzadora_id: '', numero_poliza: '', tipo_fianza: '', prima_neta: '', monto_afianzado: '', fecha_inicio: '', fecha_vigencia: '' };
  const [f, setF] = useState(empty);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    if (!f.afianzadora_id || !f.numero_poliza || !f.tipo_fianza) return;
    await api.post('/admin/fianzas', { client_id: clienteId, ...f });
    setF(empty);
    onDone();
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
      <p className="text-xs font-medium text-slate-600 mb-2">Agregar fianza</p>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Afianzadora<Req /></label>
          <select value={f.afianzadora_id} onChange={set('afianzadora_id')} className={inputCls}>
            <option value="">Selecciona…</option>
            {afianzadoras.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">N° de póliza<Req /></label>
          <input value={f.numero_poliza} onChange={set('numero_poliza')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Tipo de fianza<Req /></label>
          <input value={f.tipo_fianza} onChange={set('tipo_fianza')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Prima neta</label>
          <input type="number" value={f.prima_neta} onChange={set('prima_neta')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Monto afianzado</label>
          <input type="number" value={f.monto_afianzado} onChange={set('monto_afianzado')} className={inputCls} />
        </div>
        <div className="hidden md:block" />
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Fecha inicio</label>
          <input type="date" value={f.fecha_inicio} onChange={set('fecha_inicio')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Fecha vigencia</label>
          <input type="date" value={f.fecha_vigencia} onChange={set('fecha_vigencia')} className={inputCls} />
        </div>
      </div>
      <button onClick={guardar} className={`${btnPrimary} mt-3`}><Save className="w-4 h-4" /> Guardar fianza</button>
    </div>
  );
}

function NuevaPapeleria({ clienteId, afianzadoras, onDone }) {
  const [descripcion, setDesc] = useState('');
  const [afianzadora_id, setAfi] = useState('');

  async function guardar() {
    if (!descripcion) return;
    await api.post('/admin/papeleria', { client_id: clienteId, afianzadora_id: afianzadora_id || null, descripcion });
    setDesc(''); setAfi('');
    onDone();
  }

  return (
    <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
      <p className="text-xs font-medium text-slate-600 mb-2">Solicitar papelería puntual</p>
      <div className="flex flex-col md:flex-row gap-2">
        <select value={afianzadora_id} onChange={(e) => setAfi(e.target.value)} className={`${inputCls} md:w-48`}>
          <option value="">General…</option>
          {afianzadoras.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <input value={descripcion} onChange={(e) => setDesc(e.target.value)} placeholder="Descripción de lo solicitado" className={inputCls} />
        <button onClick={guardar} className={btnPrimary}><Plus className="w-4 h-4" /> Crear</button>
      </div>
    </div>
  );
}
