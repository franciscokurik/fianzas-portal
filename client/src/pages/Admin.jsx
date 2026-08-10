import { useEffect, useState } from 'react';
import {
  LogOut, Building2, Plus, Save, Download,
  Users, FileText, Files, CheckCircle2, UserPlus, AlertTriangle,
  CreditCard, Trash2, Briefcase, Pencil, X, Bell, ListChecks, Check,
  Paperclip, Upload, FileDown, Mail, KeyRound, UserCog,
} from 'lucide-react';
import { api, getToken } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  mxn, mxnCents, fmtDate, yaVencio, EstadoBadge, InputPesos,
  ACCEPT_ARCHIVOS, AYUDA_ARCHIVOS, pesoArchivo,
} from '../lib.jsx';

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100';
const btnPrimary =
  'flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50';
const btnSecondary =
  'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300';

const ESTATUS_PROYECTO = [
  ['en_proceso', 'En proceso'],
  ['terminado', 'Terminado'],
  ['entregado', 'Entregado'],
  ['cerrado', 'Cerrado'],
  ['cancelado', 'Cancelado'],
];
const etiquetaEstatus = (v) => (ESTATUS_PROYECTO.find(([k]) => k === v) || [, v])[1];

export default function Admin() {
  const { user, logout } = useAuth();
  // El vendedor usa esta misma pantalla, acotada a su cartera. Ocultar lo que no
  // le toca es para que no estorbe: quien manda es el servidor en cada ruta.
  const esAdmin = user?.role === 'admin';

  const [clientes, setClientes] = useState([]);
  const [internos, setInternos] = useState([]);
  const [afianzadoras, setAfianzadoras] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [tiposDoc, setTiposDoc] = useState({ proyecto: [], fianza: [] });
  const [docsRequeridos, setDocsRequeridos] = useState([]);
  const [recordatorios, setRecordatorios] = useState([]);
  const [sel, setSel] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [msg, setMsg] = useState('');
  const [errorCarga, setErrorCarga] = useState('');

  // Si una carga falla, hay que DECIRLO. Antes el error se tragaba y la
  // pantalla mostraba "(0)", que se lee como "no hay nada" en vez de
  // "no se pudo consultar" — y hace pensar que lo que guardaste se perdió.
  const cargar = (ruta, aplicar) =>
    api.get(ruta).then(aplicar).catch((e) => setErrorCarga(e.message));

  const cargarClientes = () => cargar('/admin/clientes', (d) => setClientes(d.clientes));
  const cargarAfianzadoras = () => cargar('/admin/afianzadoras', (d) => setAfianzadoras(d.afianzadoras));
  const cargarTipos = () => cargar('/admin/tipos-fianza', (d) => setTipos(d.tipos));
  const cargarRecordatorios = () => cargar('/admin/recordatorios', (d) => setRecordatorios(d.recordatorios));
  const cargarTiposDoc = () => cargar('/admin/tipos-documento', (d) => setTiposDoc(d.tipos));
  const cargarDocsRequeridos = () => cargar('/admin/documentos-requeridos', (d) => setDocsRequeridos(d.tipos));
  const cargarInternos = () => cargar('/admin/usuarios/internos', (d) => setInternos(d.usuarios));

  useEffect(() => {
    cargarClientes(); cargarAfianzadoras(); cargarTipos();
    cargarRecordatorios(); cargarTiposDoc();
    // Los catálogos globales y el personal solo los administra Home Office; al
    // vendedor esas rutas le responden 403 y ensuciarían la pantalla de errores.
    if (esAdmin) { cargarDocsRequeridos(); cargarInternos(); }
  }, [esAdmin]);

  const vendedores = internos.filter((u) => u.role === 'vendedor' && u.activo);

  function abrirDetalle(id) {
    setSel(id);
    cargar(`/admin/clientes/${id}/detalle`, setDetalle);
  }
  const recargarDetalle = () => sel && cargar(`/admin/clientes/${sel}/detalle`, setDetalle);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };

  // Cualquier cambio en fianzas puede mover los recordatorios pendientes.
  const refrescarTodo = () => { recargarDetalle(); cargarClientes(); cargarRecordatorios(); };

  return (
    <div className="portal-shell portal-admin min-h-screen">
      <header className="portal-topbar bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="portal-topbar-inner max-w-[1400px] mx-auto px-6 py-3">
          <span className="portal-monogram" aria-hidden="true">F</span>
          <div className="portal-brand">
            <span className="portal-brand-name text-sm font-semibold text-slate-700">
              <strong>FORTEX</strong>
              <small>{esAdmin ? 'ADMINISTRACIÓN DE FIANZAS' : 'CARTERA DE CLIENTES'}</small>
            </span>
          </div>
          <div className="portal-topbar-actions">
            <button onClick={logout} className={`${btnSecondary} portal-logout`}>
              <LogOut className="h-3.5 w-3.5" /> Salir
            </button>
          </div>
        </div>
      </header>

      <main className="portal-main max-w-[1400px] mx-auto px-6 py-6">
        <div className="portal-page-heading flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <p className="portal-eyebrow">{esAdmin ? 'Centro de operaciones' : 'Mi cartera'}</p>
            <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" />
              {esAdmin ? 'Panel de administración' : 'Mis clientes'}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {esAdmin
                ? 'Home Office · gestión de clientes, proyectos y pólizas'
                : `${user?.nombre || 'Vendedor'} · proyectos, pólizas y documentos de tus clientes`}
            </p>
          </div>
        </div>

        {msg && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 flex items-center gap-2 mb-4">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {msg}
          </div>
        )}

        {errorCarga && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">No se pudo cargar la información.</p>
              <p className="text-xs mt-0.5 text-rose-700">{errorCarga}</p>
              <p className="text-xs mt-1 text-rose-700">
                Las listas de abajo pueden verse vacías aunque los datos existan.
                Si es la primera vez tras un despliegue, falta correr <code>/api/setup</code>.
              </p>
            </div>
            <button onClick={() => setErrorCarga('')} className="text-rose-400 hover:text-rose-700 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <Recordatorios
          recordatorios={recordatorios}
          onAbrirCliente={abrirDetalle}
          onAtendido={() => { cargarRecordatorios(); recargarDetalle(); flash('Recordatorio marcado como atendido'); }}
        />

        {/* Cuatro columnas y a partir de xl, no tres desde lg: el detalle lleva
            la tabla de fianzas, que son diez columnas y pide ~805px. Con un
            tercio del ancho, o con un cuarto por debajo de 1280px, no cabía y
            aparecía scroll horizontal. Más angosto que eso se apila y el
            detalle se queda con el ancho completo. */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
          {/* Columna izquierda */}
          <div className="space-y-4">
            {esAdmin && (
              <>
                <NuevoCliente
                  vendedores={vendedores}
                  onDone={(id) => { cargarClientes(); flash('Cliente creado'); if (id) abrirDetalle(id); }}
                />
                <PersonalFortex
                  internos={internos}
                  onChange={() => { cargarInternos(); cargarClientes(); recargarDetalle(); }}
                  flash={flash}
                />
                <NuevaAfianzadora onDone={() => { cargarAfianzadoras(); flash('Afianzadora agregada'); }} />
                <CatalogoTipos tipos={tipos} onChange={cargarTipos} flash={flash} />
                {/* Cambiar el catálogo mueve la lista de pendientes de todos los
                    fiados, así que también se refresca el detalle abierto. */}
                <CatalogoDocumentos
                  tipos={docsRequeridos}
                  onChange={() => { cargarDocsRequeridos(); recargarDetalle(); cargarClientes(); }}
                  flash={flash}
                />
              </>
            )}

            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-700">
                  {esAdmin ? 'Clientes' : 'Mi cartera'} ({clientes.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
                {clientes.map((c) => {
                  const alerta = c.fianzas_vencidas > 0 || c.docs_pendientes > 0
                    || c.papeleria_pendiente > 0 || c.fianzas_por_vencer > 0
                    || c.recordatorios_pendientes > 0;
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
                        {c.total_proyectos} proyectos · {c.total_fianzas} fianzas · {c.fianzas_vencidas} vencidas
                        {c.recordatorios_pendientes > 0 && (
                          <span className="text-amber-600"> · {c.recordatorios_pendientes} recordatorio(s)</span>
                        )}
                      </p>
                      {/* A quién le toca. Sin esto, Home Office no distingue lo
                          asignado de lo que nadie está atendiendo. */}
                      {esAdmin && (
                        <p className="text-[11px] mt-0.5">
                          {c.vendedor_nombre
                            ? <span className="text-slate-400">{c.vendedor_nombre}</span>
                            : <span className="text-amber-600">Sin vendedor asignado</span>}
                          <span className="text-slate-300"> · {c.total_usuarios} usuario(s)</span>
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Columna derecha: detalle */}
          <div className="xl:col-span-3 space-y-4">
            {!detalle ? (
              <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center text-sm text-slate-400">
                {clientes.length
                  ? 'Selecciona un cliente para ver y gestionar su información.'
                  : esAdmin
                    ? 'Todavía no hay clientes. Da de alta el primero desde "Agregar cliente".'
                    : 'Aún no tienes clientes asignados. Home Office te los asigna.'}
              </div>
            ) : (
              <DetalleCliente
                detalle={detalle}
                esAdmin={esAdmin}
                vendedores={vendedores}
                afianzadoras={afianzadoras}
                tipos={tipos}
                tiposDoc={tiposDoc}
                onChange={refrescarTodo}
                flash={flash}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Recordatorios internos (solo Fortex; el cliente no los ve)
   -------------------------------------------------------------------------- */

function Recordatorios({ recordatorios, onAbrirCliente, onAtendido }) {
  if (!recordatorios.length) return null;

  async function atender(id) {
    await api.put(`/admin/fianzas/${id}/recordatorio`, { atendido: true });
    onAtendido();
  }

  return (
    <div className="bg-white border border-amber-200 rounded-lg overflow-hidden mb-4">
      <div className="px-4 py-2.5 border-b border-amber-200 bg-amber-50 flex items-center gap-2">
        <Bell className="w-4 h-4 text-amber-600" />
        <h3 className="text-sm font-semibold text-amber-800">
          Recordatorios ({recordatorios.length})
        </h3>
        <span className="text-[11px] text-amber-700/70 ml-auto">Uso interno · no visible para el cliente</span>
      </div>
      <div className="divide-y divide-slate-100">
        {recordatorios.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-amber-50/30">
            <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium shrink-0 ${
              r.dias_restantes < 0 ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {r.dias_restantes < 0 ? `Vencido ${Math.abs(r.dias_restantes)}d` : `En ${r.dias_restantes}d`}
            </span>
            <button
              onClick={() => onAbrirCliente(r.client_id)}
              className="text-slate-700 font-medium hover:text-indigo-700 hover:underline"
            >
              {r.razon_social}
            </button>
            <span className="text-xs text-slate-500">
              <span className="font-mono">{r.numero_poliza}</span>
              {r.proyecto_nombre && ` · ${r.proyecto_nombre}`} · {r.afianzadora_nombre}
            </span>
            {r.nota_recordatorio && (
              <span className="text-xs text-slate-600 basis-full sm:basis-auto flex-1">{r.nota_recordatorio}</span>
            )}
            <button onClick={() => atender(r.id)} className={`${btnSecondary} ml-auto`}>
              <Check className="h-3.5 w-3.5" /> Atendido
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Catálogo de tipos de fianza (editable por el admin)
   -------------------------------------------------------------------------- */

function CatalogoTipos({ tipos, onChange, flash }) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState('');

  async function agregar() {
    const n = nombre.trim();
    if (!n) return;
    await api.post('/admin/tipos-fianza', { nombre: n });
    setNombre('');
    onChange();
    flash('Tipo de fianza agregado');
  }

  async function quitar(id) {
    await api.del(`/admin/tipos-fianza/${id}`);
    onChange();
    flash('Tipo de fianza desactivado');
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"
      >
        <ListChecks className="w-4 h-4 text-indigo-600" /> Tipos de fianza ({tipos.length})
        <Plus className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>
      {open && (
        <div className="p-4 space-y-2.5">
          <div className="flex gap-2">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && agregar()}
              placeholder="Nuevo tipo…"
              className={inputCls}
            />
            <button onClick={agregar} className={btnPrimary}><Plus className="w-4 h-4" /></button>
          </div>
          <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto border border-slate-100 rounded-lg">
            {tipos.map((t) => (
              <div key={t.id} className="flex items-center justify-between px-3 py-1.5 text-xs">
                <span className="text-slate-700">{t.nombre}</span>
                <button
                  onClick={() => quitar(t.id)}
                  className="text-slate-300 hover:text-rose-600"
                  title="Desactivar (las fianzas que ya lo usan lo conservan)"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Catálogo de documentos requeridos (los que se le piden a TODOS los fiados)
   -------------------------------------------------------------------------- */

function CatalogoDocumentos({ tipos, onChange, flash }) {
  const vacio = { nombre: '', periodicidad_meses: '', alerta_dias: 30 };
  const [open, setOpen] = useState(false);
  const [nuevo, setNuevo] = useState(vacio);
  const [editandoId, setEditandoId] = useState(null);
  const [edit, setEdit] = useState(vacio);
  const [error, setError] = useState('');

  const conError = (accion) => async () => {
    setError('');
    try { await accion(); } catch (e) { setError(e.message); }
  };

  const agregar = conError(async () => {
    if (!nuevo.nombre.trim()) return setError('Ponle nombre al documento.');
    await api.post('/admin/documentos-requeridos', nuevo);
    setNuevo(vacio);
    onChange();
    flash('Documento agregado al catálogo');
  });

  const guardar = conError(async () => {
    await api.put(`/admin/documentos-requeridos/${editandoId}`, edit);
    setEditandoId(null);
    onChange();
    flash('Documento actualizado');
  });

  const quitar = (id) => conError(async () => {
    await api.del(`/admin/documentos-requeridos/${id}`);
    onChange();
    flash('Documento quitado del catálogo');
  })();

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"
      >
        <FileText className="w-4 h-4 text-indigo-600" /> Documentos requeridos ({tipos.length})
        <Plus className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>
      {open && (
        <div className="p-4 space-y-2.5">
          <p className="text-[11px] text-slate-400">
            Lo que se le pide a todos los fiados. Los meses de vigencia hacen que el
            documento se marque por vencer y se avise por correo.
          </p>

          <div className="space-y-2 border border-slate-100 rounded-lg p-2.5 bg-slate-50/60">
            <input
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              placeholder="Nombre del documento…"
              className={inputCls}
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Vigencia (meses)</label>
                <input
                  type="number" min="0"
                  value={nuevo.periodicidad_meses}
                  onChange={(e) => setNuevo({ ...nuevo, periodicidad_meses: e.target.value })}
                  placeholder="no vence"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-500 mb-1 block">Avisar (días antes)</label>
                <input
                  type="number" min="1"
                  value={nuevo.alerta_dias}
                  onChange={(e) => setNuevo({ ...nuevo, alerta_dias: e.target.value })}
                  className={inputCls}
                />
              </div>
            </div>
            <button onClick={agregar} className={`${btnPrimary} w-full justify-center`}>
              <Plus className="w-4 h-4" /> Agregar al catálogo
            </button>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg max-h-72 overflow-y-auto">
            {tipos.map((t) => (
              editandoId === t.id ? (
                <div key={t.id} className="p-2.5 space-y-2 bg-indigo-50/30">
                  <input value={edit.nombre} onChange={(e) => setEdit({ ...edit, nombre: e.target.value })} className={inputCls} />
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number" min="0" placeholder="no vence"
                      value={edit.periodicidad_meses}
                      onChange={(e) => setEdit({ ...edit, periodicidad_meses: e.target.value })}
                      className={inputCls}
                    />
                    <input
                      type="number" min="1"
                      value={edit.alerta_dias}
                      onChange={(e) => setEdit({ ...edit, alerta_dias: e.target.value })}
                      className={inputCls}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={guardar} className={btnSecondary}><Save className="h-3.5 w-3.5" /> Guardar</button>
                    <button onClick={() => setEditandoId(null)} className={btnSecondary}><X className="h-3.5 w-3.5" /> Cancelar</button>
                  </div>
                </div>
              ) : (
                <div key={t.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <div className="flex-1 min-w-0">
                    <p className="text-slate-700 truncate">{t.nombre}</p>
                    <p className="text-[10px] text-slate-400">
                      {t.periodicidad_meses ? `cada ${t.periodicidad_meses} meses` : 'sin vencimiento'}
                      {' · '}aviso {t.alerta_dias} días
                      {t.cargados > 0 && ` · ${t.cargados} cargado(s)`}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setEditandoId(t.id);
                      setEdit({
                        nombre: t.nombre,
                        periodicidad_meses: t.periodicidad_meses ?? '',
                        alerta_dias: t.alerta_dias,
                      });
                    }}
                    className="text-slate-300 hover:text-indigo-600 shrink-0"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => quitar(t.id)}
                    className="text-slate-300 hover:text-rose-600 shrink-0"
                    title="Quitar del catálogo"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            ))}
            {!tipos.length && (
              <p className="px-3 py-3 text-xs text-slate-400">
                No hay documentos en el catálogo: a los fiados no se les pedirá nada.
              </p>
            )}
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Detalle del cliente
   -------------------------------------------------------------------------- */

function DetalleCliente({ detalle, esAdmin, vendedores, afianzadoras, tipos, tiposDoc, onChange, flash }) {
  const {
    cliente, usuarios = [], lineas = [], proyectos = [],
    fianzas = [], documentos, papeleria,
  } = detalle;
  const lineaTotal = lineas.reduce((s, l) => s + (l.linea_credito || 0), 0);
  const disponibleTotal = lineas.reduce((s, l) => s + (l.disponible || 0), 0);
  const afianzadoTotal = fianzas
    .filter((f) => f.estado !== 'vencida')
    .reduce((s, f) => s + (f.monto_afianzado || 0), 0);
  const sumaPrimaNeta = fianzas.reduce((s, f) => s + (f.prima_neta || 0), 0);
  const sumaPrimaTotal = fianzas.reduce((s, f) => s + (f.prima_total || 0), 0);

  async function descargar(rel) {
    const res = await fetch(`/api/admin/descargar?path=${encodeURIComponent(rel)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    // Antes se hacía blob() a ciegas: cuando el archivo no estaba, se bajaba un
    // archivo con el JSON del error dentro y parecía que sí había descargado.
    if (!res.ok) {
      flash('No se pudo descargar el archivo.');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = rel.split('/').pop(); a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      {/* Encabezado del cliente */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">{cliente.razon_social}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {cliente.rfc || 'Sin RFC'}
              {cliente.telefono && ` · ${cliente.telefono}`}
            </p>
          </div>
          {/* Mover de cartera es de Home Office: un vendedor no se asigna
              clientes a sí mismo. Él solo ve a quién le toca. */}
          {esAdmin ? (
            <AsignarVendedor
              clienteId={cliente.id}
              vendedorId={cliente.vendedor_id}
              vendedores={vendedores}
              onChange={() => { onChange(); flash('Cartera actualizada'); }}
            />
          ) : (
            <span className="text-[11px] text-slate-400">En tu cartera</span>
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Pill label="Línea total" valor={mxn(lineaTotal)} />
          <Pill label="Disponible" valor={mxn(disponibleTotal)} tono="emerald" />
          <Pill label="Monto afianzado" valor={mxn(afianzadoTotal)} tono="sky"
                ayuda="Suma de lo que cubren las fianzas vigentes" />
          <Pill label="Prima total" valor={mxn(sumaPrimaTotal)} tono="violet"
                ayuda="Lo que el fiado paga: prima neta + derecho de póliza + IVA" />
          <Pill label="Prima neta" valor={mxn(sumaPrimaNeta)}
                ayuda="La tarifa de la afianzadora, sin derecho de póliza ni IVA" />
        </div>
      </div>

      {/* Quiénes pueden entrar por este fiado */}
      <UsuariosCliente
        clienteId={cliente.id}
        usuarios={usuarios}
        esAdmin={esAdmin}
        onChange={onChange}
        flash={flash}
      />

      {/* Líneas de crédito por afianzadora */}
      <LineasCredito
        clienteId={cliente.id}
        lineas={lineas}
        afianzadoras={afianzadoras}
        puedeEditar={esAdmin}
        onChange={() => { onChange(); flash('Línea de crédito actualizada'); }}
      />

      {/* Proyectos con sus fianzas */}
      <Proyectos
        clienteId={cliente.id}
        proyectos={proyectos}
        afianzadoras={afianzadoras}
        tipos={tipos}
        tiposDoc={tiposDoc}
        onChange={onChange}
        flash={flash}
      />

      {/* Expediente del fiado */}
      <ExpedienteCliente
        clienteId={cliente.id}
        documentos={documentos}
        descargar={descargar}
        onChange={onChange}
        flash={flash}
      />

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

/* --------------------------------------------------------------------------
   Expediente del fiado: Fortex carga los papeles en nombre del cliente
   -------------------------------------------------------------------------- */

function ExpedienteCliente({ clienteId, documentos = [], descargar, onChange, flash }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const pendientes = documentos.filter((d) => !d.uploaded_at).length;

  async function subir(typeId, archivo) {
    if (!archivo) return;
    setError('');
    setBusyId(typeId);
    try {
      const datos = new FormData();
      datos.append('archivo', archivo);
      await api.upload(`/admin/clientes/${clienteId}/documentos/${typeId}`, datos);
      onChange();
      flash('Documento cargado al expediente');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function quitar(typeId) {
    setError('');
    try {
      await api.del(`/admin/clientes/${clienteId}/documentos/${typeId}`);
      onChange();
      flash('Documento eliminado');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <FileText className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">Expediente del fiado</h3>
        <span className="text-[11px] text-slate-500 ml-auto">
          {pendientes > 0 ? `${pendientes} pendiente(s)` : 'completo'}
        </span>
      </div>

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {documentos.map((d) => {
          const cargado = Boolean(d.uploaded_at);
          const subiendo = busyId === d.document_type_id;
          return (
            <div key={d.document_type_id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-slate-50/40">
              <div className="flex-1 min-w-[240px]">
                <p className="text-slate-700 font-medium">{d.nombre}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {cargado ? (
                    <>
                      {d.original_name} {pesoArchivo(d.size_bytes) && `· ${pesoArchivo(d.size_bytes)}`}
                      {' · '}{fmtDate(d.uploaded_at)}
                      {d.vencimiento && ` · vence ${fmtDate(d.vencimiento)}`}
                      {' · '}
                      <span className={d.subido_por === 'fortex' ? 'text-indigo-600' : ''}>
                        {d.subido_por === 'fortex' ? 'cargado por Fortex' : 'cargado por el cliente'}
                      </span>
                    </>
                  ) : (
                    d.periodicidad_meses ? `Se renueva cada ${d.periodicidad_meses} meses` : 'Sin vencimiento'
                  )}
                </p>
              </div>

              <EstadoBadge
                estado={!cargado ? 'pendiente' : yaVencio(d.vencimiento) ? 'vencido' : 'al_dia'}
              />

              {cargado && d.file_path && (
                <button onClick={() => descargar(d.file_path)} className={btnSecondary}>
                  <Download className="h-3.5 w-3.5" /> Descargar
                </button>
              )}

              {/* Fortex carga el papel cuando le llega por correo, sin esperar
                  a que el fiado entre al portal a subirlo. */}
              <label className={`${btnSecondary} cursor-pointer ${subiendo ? 'opacity-50' : ''}`}>
                <Upload className="h-3.5 w-3.5" />
                {subiendo ? 'Subiendo…' : cargado ? 'Reemplazar' : 'Cargar'}
                <input
                  type="file"
                  accept={ACCEPT_ARCHIVOS}
                  className="sr-only"
                  disabled={subiendo}
                  onChange={(e) => { subir(d.document_type_id, e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>

              {cargado && (
                <button
                  onClick={() => quitar(d.document_type_id)}
                  className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`}
                  title="Quitar del expediente"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          );
        })}
        {!documentos.length && (
          <div className="px-4 py-6 text-center text-xs text-slate-400">
            No hay documentos en el catálogo. Agrégalos desde "Documentos requeridos".
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-slate-100 text-[11px] text-slate-400">
        {AYUDA_ARCHIVOS}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Cartera: a qué vendedor le toca este fiado
   -------------------------------------------------------------------------- */

function AsignarVendedor({ clienteId, vendedorId, vendedores = [], onChange }) {
  const [error, setError] = useState('');

  async function asignar(valor) {
    setError('');
    try {
      await api.put(`/admin/clientes/${clienteId}/vendedor`, { vendedor_id: valor || null });
      onChange();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="text-right">
      <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1">Vendedor</label>
      <select
        value={vendedorId || ''}
        onChange={(e) => asignar(e.target.value)}
        className={`${inputCls} w-auto min-w-44`}
      >
        <option value="">Sin asignar (Home Office)</option>
        {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
      </select>
      {error && <p className="text-[11px] text-rose-600 mt-1">{error}</p>}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Usuarios del fiado: varias personas de la misma empresa, cada una con su
   correo, viendo todas lo mismo.
   -------------------------------------------------------------------------- */

function UsuariosCliente({ clienteId, usuarios = [], esAdmin, onChange, flash }) {
  const vacio = { nombre: '', email: '', password: '' };
  const [nuevo, setNuevo] = useState(vacio);
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const activos = usuarios.filter((u) => u.activo).length;

  async function agregar() {
    setError('');
    if (!nuevo.nombre.trim() || !nuevo.email.trim() || !nuevo.password) {
      return setError('Nombre, correo y contraseña son obligatorios.');
    }
    setBusy(true);
    try {
      await api.post('/admin/usuarios', { ...nuevo, role: 'client', client_id: clienteId });
      setNuevo(vacio);
      setAbierto(false);
      onChange();
      flash('Usuario agregado');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function cambiarActivo(u) {
    setError('');
    try {
      await api.put(`/admin/usuarios/${u.id}`, { activo: !u.activo });
      onChange();
      flash(u.activo ? 'Acceso desactivado' : 'Acceso reactivado');
    } catch (e) {
      setError(e.message);
    }
  }

  async function reponerClave(u) {
    const clave = prompt(`Nueva contraseña para ${u.email} (mínimo 8 caracteres):`);
    if (!clave) return;
    setError('');
    try {
      await api.put(`/admin/usuarios/${u.id}`, { password: clave });
      flash('Contraseña actualizada. Pásasela a la persona.');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <Users className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">Accesos del cliente ({activos})</h3>
        {esAdmin && (
          <button onClick={() => setAbierto((a) => !a)} className={`${btnSecondary} ml-auto`}>
            <UserPlus className={`h-3.5 w-3.5 transition-transform ${abierto ? 'rotate-45' : ''}`} /> Agregar persona
          </button>
        )}
      </div>

      {abierto && (
        <div className="border-b border-slate-200 bg-indigo-50/30 px-4 py-3">
          <p className="text-[11px] text-slate-500 mb-2">
            Cada persona entra con su propio correo y ve las mismas fianzas y documentos de la empresa.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Nombre o puesto<Req /></label>
              <input
                value={nuevo.nombre}
                onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
                placeholder="Contabilidad, Residencia de obra…"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Correo<Req /></label>
              <input
                type="email"
                value={nuevo.email}
                onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Contraseña inicial<Req /></label>
              <input
                type="text"
                value={nuevo.password}
                onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
                placeholder="mínimo 8 caracteres"
                className={inputCls}
              />
            </div>
          </div>
          <button onClick={agregar} disabled={busy} className={`${btnPrimary} mt-3`}>
            <Save className="w-4 h-4" /> {busy ? 'Guardando…' : 'Crear acceso'}
          </button>
        </div>
      )}

      {error && (
        <div className="border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="divide-y divide-slate-100">
        {usuarios.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-sm hover:bg-slate-50/40">
            <Mail className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <div className="flex-1 min-w-[200px]">
              <p className={`font-medium ${u.activo ? 'text-slate-700' : 'text-slate-400 line-through'}`}>
                {u.nombre}
              </p>
              <p className="text-[11px] text-slate-500">{u.email}</p>
            </div>
            <EstadoBadge estado={u.activo ? 'al_dia' : 'vencido'} />
            {esAdmin && (
              <>
                <button onClick={() => reponerClave(u)} className={btnSecondary} title="Reponer contraseña">
                  <KeyRound className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => cambiarActivo(u)}
                  className={`${btnSecondary} ${u.activo ? 'hover:border-rose-300 hover:text-rose-600' : ''}`}
                >
                  {u.activo ? 'Desactivar' : 'Reactivar'}
                </button>
              </>
            )}
          </div>
        ))}
        {!usuarios.length && (
          <div className="px-4 py-6 text-center text-xs text-slate-400">
            Este cliente no tiene con qué entrar al portal.
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Personal de Fortex: vendedores y administradores
   -------------------------------------------------------------------------- */

function PersonalFortex({ internos = [], onChange, flash }) {
  const vacio = { nombre: '', email: '', password: '', role: 'vendedor' };
  const [open, setOpen] = useState(false);
  const [nuevo, setNuevo] = useState(vacio);
  const [error, setError] = useState('');

  async function agregar() {
    setError('');
    if (!nuevo.nombre.trim() || !nuevo.email.trim() || !nuevo.password) {
      return setError('Nombre, correo y contraseña son obligatorios.');
    }
    try {
      await api.post('/admin/usuarios', nuevo);
      setNuevo(vacio);
      onChange();
      flash('Cuenta de Fortex creada');
    } catch (e) {
      setError(e.message);
    }
  }

  async function cambiarActivo(u) {
    setError('');
    try {
      await api.put(`/admin/usuarios/${u.id}`, { activo: !u.activo });
      onChange();
      flash(u.activo ? 'Cuenta desactivada' : 'Cuenta reactivada');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"
      >
        <UserCog className="w-4 h-4 text-indigo-600" /> Personal de Fortex ({internos.length})
        <Plus className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>
      {open && (
        <div className="p-4 space-y-2.5">
          <p className="text-[11px] text-slate-400">
            Los vendedores solo ven los clientes que les asignes. El correo debe ser del dominio de Fortex.
          </p>

          <div className="space-y-2 border border-slate-100 rounded-lg p-2.5 bg-slate-50/60">
            <input
              value={nuevo.nombre}
              onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })}
              placeholder="Nombre de la persona"
              className={inputCls}
            />
            <input
              type="email"
              value={nuevo.email}
              onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })}
              placeholder="nombre@fortex.mx"
              className={inputCls}
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={nuevo.password}
                onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })}
                placeholder="Contraseña (8+)"
                className={inputCls}
              />
              <select
                value={nuevo.role}
                onChange={(e) => setNuevo({ ...nuevo, role: e.target.value })}
                className={inputCls}
              >
                <option value="vendedor">Vendedor</option>
                <option value="admin">Administrador</option>
              </select>
            </div>
            <button onClick={agregar} className={`${btnPrimary} w-full justify-center`}>
              <UserPlus className="w-4 h-4" /> Crear cuenta
            </button>
          </div>

          <div className="divide-y divide-slate-100 border border-slate-100 rounded-lg max-h-64 overflow-y-auto">
            {internos.map((u) => (
              <div key={u.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <div className="flex-1 min-w-0">
                  <p className={`truncate ${u.activo ? 'text-slate-700' : 'text-slate-400 line-through'}`}>
                    {u.nombre}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">
                    {u.email} · {u.role === 'admin' ? 'administrador' : `${u.clientes_asignados} cliente(s)`}
                  </p>
                </div>
                <button
                  onClick={() => cambiarActivo(u)}
                  className="text-slate-300 hover:text-rose-600 shrink-0"
                  title={u.activo ? 'Desactivar' : 'Reactivar'}
                >
                  {u.activo ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                </button>
              </div>
            ))}
          </div>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Pill({ label, valor, tono = 'slate', ayuda }) {
  const tonos = {
    slate: 'bg-slate-50 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-700',
    sky: 'bg-sky-50 text-sky-700',
    violet: 'bg-violet-50 text-violet-700',
  };
  return (
    <div className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md ${tonos[tono]}`} title={ayuda}>
      {label}: <span className="font-semibold tabular-nums">{valor}</span>
    </div>
  );
}

function Req() { return <span className="text-rose-500">*</span>; }

/* --------------------------------------------------------------------------
   Líneas de crédito
   -------------------------------------------------------------------------- */

function LineasCredito({ clienteId, lineas, afianzadoras, puedeEditar, onChange }) {
  const [edits, setEdits] = useState({}); // afianzadora_id -> valor en edición
  const [nuevaAfi, setNuevaAfi] = useState('');
  const [nuevoMonto, setNuevoMonto] = useState(0); // en centavos

  const usadas = new Set(lineas.map((l) => l.afianzadora_id));
  const disponiblesParaAgregar = afianzadoras.filter((a) => !usadas.has(a.id));

  async function guardar(afianzadora_id, linea_credito) {
    // linea_credito ya viene en centavos desde InputPesos.
    await api.put(`/admin/clientes/${clienteId}/lineas`, { afianzadora_id, linea_credito });
    setEdits((e) => { const n = { ...e }; delete n[afianzadora_id]; return n; });
    onChange();
  }

  async function eliminar(afianzadora_id) {
    await api.del(`/admin/clientes/${clienteId}/lineas/${afianzadora_id}`);
    onChange();
  }

  async function agregar() {
    if (!nuevaAfi) return;
    await api.put(`/admin/clientes/${clienteId}/lineas`, { afianzadora_id: Number(nuevaAfi), linea_credito: nuevoMonto });
    setNuevaAfi(''); setNuevoMonto(0);
    onChange();
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">Líneas de crédito por afianzadora</h3>
        {/* La línea es el riesgo que asume la casa: la fija Home Office. El
            vendedor la consulta para saber cuánto le queda disponible. */}
        {!puedeEditar && (
          <span className="text-[11px] text-slate-400 ml-auto">Las autoriza Home Office</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="text-left px-3 py-2">Afianzadora</th>
              <th className="text-right px-3 py-2">Línea autorizada</th>
              <th className="text-right px-3 py-2">Comprometido</th>
              <th className="text-right px-3 py-2">Disponible</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {lineas.map((l) => {
              const editing = edits[l.afianzadora_id] ?? l.linea_credito;
              const negativo = l.disponible < 0;
              return (
                <tr key={l.afianzadora_id} className="hover:bg-slate-50/40">
                  <td className="px-3 py-1.5 text-slate-700 font-medium">{l.afianzadora_nombre}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {puedeEditar ? (
                      <InputPesos
                        valor={editing}
                        onChange={(centavos) => setEdits((s) => ({ ...s, [l.afianzadora_id]: centavos }))}
                        className="w-32 px-2 py-1 text-right rounded-md border border-slate-200 bg-white tabular-nums focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
                      />
                    ) : (
                      <span className="text-slate-700">{mxn(l.linea_credito)}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{mxn(l.comprometido)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${negativo ? 'text-rose-600' : 'text-emerald-700'}`}>
                    {mxn(l.disponible)}
                  </td>
                  <td className="px-3 py-1.5">
                    {puedeEditar && (
                      <div className="flex items-center justify-end gap-1.5">
                        <button onClick={() => guardar(l.afianzadora_id, editing)} className={btnSecondary} title="Guardar">
                          <Save className="h-3.5 w-3.5" />
                        </button>
                        <button onClick={() => eliminar(l.afianzadora_id)} className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`} title="Quitar línea">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {!lineas.length && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin líneas de crédito asignadas.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {puedeEditar && disponiblesParaAgregar.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
          <p className="text-xs font-medium text-slate-600 mb-2">Asignar línea a otra afianzadora</p>
          <div className="flex flex-col md:flex-row gap-2">
            <select value={nuevaAfi} onChange={(e) => setNuevaAfi(e.target.value)} className={`${inputCls} md:w-56`}>
              <option value="">Selecciona afianzadora…</option>
              {disponiblesParaAgregar.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
            <InputPesos valor={nuevoMonto} onChange={setNuevoMonto} placeholder="Monto de la línea" className={inputCls} />
            <button onClick={agregar} className={btnPrimary}><Plus className="w-4 h-4" /> Asignar</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Proyectos y sus fianzas
   -------------------------------------------------------------------------- */

function Proyectos({ clienteId, proyectos, afianzadoras, tipos, tiposDoc, onChange, flash }) {
  const [creando, setCreando] = useState(false);

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <Briefcase className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">Proyectos ({proyectos.length})</h3>
        <button onClick={() => setCreando((c) => !c)} className={`${btnSecondary} ml-auto`}>
          <Plus className={`h-3.5 w-3.5 transition-transform ${creando ? 'rotate-45' : ''}`} /> Nuevo proyecto
        </button>
      </div>

      {creando && (
        <FormProyecto
          onCancel={() => setCreando(false)}
          onSubmit={async (datos) => {
            await api.post('/admin/proyectos', { client_id: clienteId, ...datos });
            setCreando(false);
            onChange();
            flash('Proyecto creado');
          }}
        />
      )}

      <div className="divide-y divide-slate-100">
        {proyectos.map((p) => (
          <Proyecto
            key={p.id}
            proyecto={p}
            proyectos={proyectos}
            clienteId={clienteId}
            afianzadoras={afianzadoras}
            tipos={tipos}
            tiposDoc={tiposDoc}
            onChange={onChange}
            flash={flash}
          />
        ))}
        {!proyectos.length && !creando && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            Este cliente no tiene proyectos. Crea uno para poder registrar sus fianzas.
          </div>
        )}
      </div>
    </div>
  );
}

function Proyecto({ proyecto: p, proyectos, clienteId, afianzadoras, tipos, tiposDoc, onChange, flash }) {
  const [abierto, setAbierto] = useState(true);
  const [editando, setEditando] = useState(false);
  const [nuevaFianza, setNuevaFianza] = useState(false);
  const [verDocs, setVerDocs] = useState(false);
  const [error, setError] = useState('');
  const docs = p.documentos || [];

  async function borrar() {
    setError('');
    try {
      await api.del(`/admin/proyectos/${p.id}`);
      onChange();
      flash('Proyecto eliminado');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {/* Encabezado del proyecto */}
      <div className="px-4 py-3 hover:bg-slate-50/40">
        <div className="flex flex-wrap items-start gap-3">
          <button onClick={() => setAbierto((a) => !a)} className="flex-1 text-left min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-800">{p.nombre}</span>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-600">
                {etiquetaEstatus(p.estatus)}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {p.numero_contrato && <span className="font-mono">{p.numero_contrato}</span>}
              {p.beneficiario && <span> · {p.beneficiario}</span>}
              {p.fecha_termino && <span> · termina {fmtDate(p.fecha_termino)}</span>}
            </p>
          </button>

          <div className="flex flex-wrap items-center gap-2">
            {p.monto_contrato > 0 && (
              <Pill label="Contrato" valor={mxn(p.monto_contrato)} />
            )}
            <Pill label="Afianzado" valor={mxn(p.monto_afianzado)} tono="sky" />
            {p.pct_contrato_afianzado != null && (
              <span className="text-[11px] text-slate-500 tabular-nums">
                {p.pct_contrato_afianzado}% del contrato
              </span>
            )}
            <button
              onClick={() => setVerDocs((v) => !v)}
              className={`${btnSecondary} ${docs.length ? 'text-indigo-700 border-indigo-200' : ''}`}
              title="Contrato y documentos del proyecto"
            >
              <Paperclip className="h-3.5 w-3.5" />
              {docs.length > 0 && <span className="tabular-nums">{docs.length}</span>}
            </button>
            <button onClick={() => setEditando((e) => !e)} className={btnSecondary} title="Editar proyecto">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={borrar} className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`} title="Eliminar proyecto">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
          </div>
        )}
      </div>

      {verDocs && (
        <div className="border-t border-slate-200 bg-slate-50/60 px-4 py-3">
          <p className="text-xs font-medium text-slate-600 mb-2">
            Documentos del proyecto <span className="text-slate-400">· contrato, convenios, acta de entrega</span>
          </p>
          <DocsEntidad
            entidad="proyectos"
            id={p.id}
            documentos={docs}
            tipos={tiposDoc.proyecto || []}
            onChange={onChange}
            flash={flash}
          />
        </div>
      )}

      {editando && (
        <FormProyecto
          inicial={p}
          onCancel={() => setEditando(false)}
          onSubmit={async (datos) => {
            await api.put(`/admin/proyectos/${p.id}`, datos);
            setEditando(false);
            onChange();
            flash('Proyecto actualizado');
          }}
        />
      )}

      {abierto && (
        <div className="bg-slate-50/40 border-t border-slate-100">
          <TablaFianzas
            fianzas={p.fianzas || []}
            proyectos={proyectos}
            afianzadoras={afianzadoras}
            tipos={tipos}
            tiposDoc={tiposDoc}
            onChange={onChange}
            flash={flash}
          />
          <div className="px-4 py-2.5 border-t border-slate-100">
            <button onClick={() => setNuevaFianza((n) => !n)} className={btnSecondary}>
              <Plus className={`h-3.5 w-3.5 transition-transform ${nuevaFianza ? 'rotate-45' : ''}`} /> Agregar fianza a este proyecto
            </button>
          </div>
          {nuevaFianza && (
            <FormFianza
              proyectos={proyectos}
              proyectoId={p.id}
              afianzadoras={afianzadoras}
              tipos={tipos}
              onCancel={() => setNuevaFianza(false)}
              onSubmit={async (datos) => {
                await api.post('/admin/fianzas', { client_id: clienteId, ...datos });
                setNuevaFianza(false);
                onChange();
                flash('Fianza agregada');
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TablaFianzas({ fianzas, proyectos, afianzadoras, tipos, tiposDoc, onChange, flash }) {
  const [editandoId, setEditandoId] = useState(null);
  const [docsAbiertos, setDocsAbiertos] = useState(null);

  if (!fianzas.length) {
    return <div className="px-4 py-5 text-center text-xs text-slate-400">Sin fianzas en este proyecto.</div>;
  }

  async function borrar(id) {
    await api.del(`/admin/fianzas/${id}`);
    onChange();
    flash('Fianza eliminada');
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-white/60 text-slate-500 uppercase tracking-wider text-[10px]">
          <tr>
            <th className="text-left px-3 py-2">Póliza</th>
            <th className="text-left px-3 py-2">Afianzadora</th>
            <th className="text-left px-3 py-2">Tipo</th>
            <th className="text-right px-3 py-2">Monto afianzado</th>
            {/* Una sola columna con las dos primas: la total arriba (lo que se
                paga) y la neta debajo. Separarlas en dos columnas volvía a
                sacar scroll horizontal en la tabla. */}
            <th className="text-right px-3 py-2">Prima total</th>
            <th className="text-left px-3 py-2">Vigencia</th>
            <th className="text-left px-3 py-2">Recordatorio</th>
            <th className="text-left px-3 py-2">Estado</th>
            <th className="text-center px-3 py-2">Docs</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {fianzas.map((f) => (
            editandoId === f.id ? (
              <tr key={f.id}>
                <td colSpan={10} className="p-0">
                  <FormFianza
                    inicial={f}
                    proyectos={proyectos}
                    proyectoId={f.proyecto_id}
                    afianzadoras={afianzadoras}
                    tipos={tipos}
                    onCancel={() => setEditandoId(null)}
                    onSubmit={async (datos) => {
                      await api.put(`/admin/fianzas/${f.id}`, datos);
                      setEditandoId(null);
                      onChange();
                      flash('Fianza actualizada');
                    }}
                  />
                </td>
              </tr>
            ) : (
              <tr key={f.id} className="hover:bg-white/70">
                <td className="px-3 py-1.5 font-mono text-slate-700">{f.numero_poliza}</td>
                <td className="px-3 py-1.5 text-slate-600">{f.afianzadora_nombre}</td>
                <td className="px-3 py-1.5 text-slate-700 font-medium">{f.tipo_fianza}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">{mxnCents(f.monto_afianzado)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                  {mxnCents(f.prima_total)}
                  <span className="block text-[10px] text-slate-400">neta {mxnCents(f.prima_neta)}</span>
                </td>
                <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{fmtDate(f.fecha_vigencia)}</td>
                <td className="px-3 py-1.5">
                  {f.fecha_recordatorio ? (
                    <span
                      className={`tabular-nums ${
                        f.recordatorio_atendido_el ? 'text-slate-400 line-through'
                        : f.dias_para_recordatorio <= 7 ? 'text-amber-700 font-medium'
                        : 'text-slate-600'
                      }`}
                      title={f.nota_recordatorio || ''}
                    >
                      {fmtDate(f.fecha_recordatorio)}
                    </span>
                  ) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-3 py-1.5"><EstadoBadge estado={f.estado} /></td>
                <td className="px-3 py-1.5 text-center">
                  <button
                    onClick={() => setDocsAbiertos((d) => (d === f.id ? null : f.id))}
                    className={`inline-flex items-center gap-1 px-1.5 py-1 rounded-md border text-[11px] ${
                      f.documentos?.length
                        ? 'border-indigo-200 text-indigo-700 bg-indigo-50/60'
                        : 'border-slate-200 text-slate-400 hover:border-indigo-300'
                    }`}
                    title="Carátula y documentos de la fianza"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    <span className="tabular-nums">{f.documentos?.length || 0}</span>
                  </button>
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => setEditandoId(f.id)} className={btnSecondary} title="Editar fianza">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => borrar(f.id)} className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`} title="Eliminar fianza">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            )
          )).flatMap((fila, i) => {
            const f = fianzas[i];
            if (docsAbiertos !== f.id || editandoId === f.id) return [fila];
            return [fila, (
              <tr key={`docs-${f.id}`} className="bg-indigo-50/20">
                <td colSpan={10} className="px-4 py-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">
                    Documentos de la fianza <span className="font-mono text-slate-400">{f.numero_poliza}</span>
                  </p>
                  <DocsEntidad
                    entidad="fianzas"
                    id={f.id}
                    documentos={f.documentos || []}
                    tipos={tiposDoc.fianza || []}
                    onChange={onChange}
                    flash={flash}
                  />
                </td>
              </tr>
            )];
          })}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Documentos colgados de un proyecto (contrato) o de una fianza (carátula)
   -------------------------------------------------------------------------- */

function DocsEntidad({ entidad, id, documentos = [], tipos = [], onChange, flash }) {
  const [tipoDoc, setTipoDoc] = useState(tipos[0]?.clave || 'otro');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');

  async function subir(archivo) {
    if (!archivo) return;
    setError('');
    setSubiendo(true);
    try {
      const datos = new FormData();
      datos.append('archivo', archivo);
      datos.append('tipo_doc', tipoDoc);
      await api.upload(`/admin/${entidad}/${id}/documentos`, datos);
      onChange();
      flash('Documento subido');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubiendo(false);
    }
  }

  async function quitar(docId) {
    setError('');
    try {
      await api.del(`/admin/documentos/${docId}`);
      onChange();
      flash('Documento eliminado');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="space-y-2">
      {documentos.length > 0 && (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
          {documentos.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700 shrink-0">{d.tipo_doc_nombre}</span>
              <span className="text-slate-500 truncate">{d.nombre_archivo}</span>
              <span className="text-slate-400 tabular-nums shrink-0">{pesoArchivo(d.size_bytes)}</span>
              <a
                href={d.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${btnSecondary} ml-auto shrink-0`}
              >
                <FileDown className="h-3.5 w-3.5" /> Ver
              </a>
              <button
                onClick={() => quitar(d.id)}
                className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600 shrink-0`}
                title="Eliminar documento"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={tipoDoc} onChange={(e) => setTipoDoc(e.target.value)} className={`${inputCls} w-auto min-w-48`}>
          {tipos.map((t) => <option key={t.clave} value={t.clave}>{t.nombre}</option>)}
        </select>

        <label className={`${btnSecondary} cursor-pointer ${subiendo ? 'opacity-50' : ''}`}>
          <Upload className="h-3.5 w-3.5" />
          {subiendo ? 'Subiendo…' : 'Elegir archivo'}
          <input
            type="file"
            accept={ACCEPT_ARCHIVOS}
            className="sr-only"
            disabled={subiendo}
            onChange={(e) => { subir(e.target.files?.[0]); e.target.value = ''; }}
          />
        </label>
        <span className="text-[11px] text-slate-400">{AYUDA_ARCHIVOS}</span>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Formularios
   -------------------------------------------------------------------------- */

function FormProyecto({ inicial, onSubmit, onCancel }) {
  const [f, setF] = useState({
    nombre: inicial?.nombre || '',
    numero_contrato: inicial?.numero_contrato || '',
    beneficiario: inicial?.beneficiario || '',
    monto_contrato: inicial?.monto_contrato ?? 0, // centavos
    fecha_inicio: inicial?.fecha_inicio || '',
    fecha_termino: inicial?.fecha_termino || '',
    estatus: inicial?.estatus || 'en_proceso',
    notas: inicial?.notas || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    setError('');
    if (!f.nombre.trim()) return setError('El nombre del proyecto es obligatorio.');
    setBusy(true);
    try {
      await onSubmit(f); // monto_contrato ya está en centavos
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-200 bg-indigo-50/30 px-4 py-3">
      <p className="text-xs font-medium text-slate-600 mb-2">
        {inicial ? 'Editar proyecto' : 'Nuevo proyecto'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="text-[11px] text-slate-500 mb-1 block">Nombre del proyecto u obra<Req /></label>
          <input value={f.nombre} onChange={set('nombre')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Estatus</label>
          <select value={f.estatus} onChange={set('estatus')} className={inputCls}>
            {ESTATUS_PROYECTO.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">N° de contrato</label>
          <input value={f.numero_contrato} onChange={set('numero_contrato')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Beneficiario</label>
          <input value={f.beneficiario} onChange={set('beneficiario')} placeholder="CFE, IMSS, municipio…" className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Monto del contrato</label>
          <InputPesos
            valor={f.monto_contrato}
            onChange={(centavos) => setF((s) => ({ ...s, monto_contrato: centavos }))}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Fecha de inicio</label>
          <input type="date" value={f.fecha_inicio} onChange={set('fecha_inicio')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Fecha de término</label>
          <input type="date" value={f.fecha_termino} onChange={set('fecha_termino')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Notas</label>
          <input value={f.notas} onChange={set('notas')} className={inputCls} />
        </div>
      </div>
      {error && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={guardar} disabled={busy} className={btnPrimary}>
          <Save className="w-4 h-4" /> {busy ? 'Guardando…' : 'Guardar proyecto'}
        </button>
        <button onClick={onCancel} className={btnSecondary}><X className="h-3.5 w-3.5" /> Cancelar</button>
      </div>
    </div>
  );
}

// Lista de tipos en forma de checklist: se marca uno solo (el tipo principal).
function ChecklistTipos({ tipos, valor, onChange }) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white max-h-44 overflow-y-auto divide-y divide-slate-100">
      {tipos.map((t) => {
        const activo = Number(valor) === t.id;
        return (
          <label
            key={t.id}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer ${
              activo ? 'bg-indigo-50 text-indigo-800 font-medium' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name="tipo_fianza"
              className="sr-only"
              checked={activo}
              onChange={() => onChange(t.id)}
            />
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${
              activo ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 bg-white'
            }`}>
              {activo && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
            </span>
            {t.nombre}
          </label>
        );
      })}
      {!tipos.length && (
        <p className="px-3 py-3 text-xs text-slate-400">
          No hay tipos en el catálogo. Agrégalos desde "Tipos de fianza".
        </p>
      )}
    </div>
  );
}

function FormFianza({ inicial, proyectos, proyectoId, afianzadoras, tipos, onSubmit, onCancel }) {
  const [f, setF] = useState({
    proyecto_id: inicial?.proyecto_id ?? proyectoId ?? '',
    afianzadora_id: inicial?.afianzadora_id ?? '',
    numero_poliza: inicial?.numero_poliza || '',
    tipo_fianza_id: inicial?.tipo_fianza_id ?? '',
    monto_afianzado: inicial?.monto_afianzado ?? 0, // centavos
    prima_neta: inicial?.prima_neta ?? 0,           // centavos
    prima_total: inicial?.prima_total ?? 0,         // centavos
    fecha_inicio: inicial?.fecha_inicio || '',
    fecha_vigencia: inicial?.fecha_vigencia || '',
    fecha_recordatorio: inicial?.fecha_recordatorio || '',
    nota_recordatorio: inicial?.nota_recordatorio || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    setError('');
    if (!f.proyecto_id) return setError('Selecciona el proyecto al que pertenece la fianza.');
    if (!f.afianzadora_id) return setError('Selecciona la afianzadora.');
    if (!f.numero_poliza.trim()) return setError('Captura el número de póliza.');
    if (!f.tipo_fianza_id) return setError('Marca el tipo de fianza.');
    // La total incluye a la neta más el derecho de póliza y el IVA, así que no
    // puede quedar por debajo. Casi siempre es que se invirtieron los campos.
    if (f.prima_total > 0 && f.prima_total < f.prima_neta) {
      return setError('La prima total no puede ser menor que la neta: incluye el derecho de póliza y el IVA.');
    }
    setBusy(true);
    try {
      // Los montos ya van en centavos.
      await onSubmit({
        ...f,
        proyecto_id: Number(f.proyecto_id),
        afianzadora_id: Number(f.afianzadora_id),
        tipo_fianza_id: Number(f.tipo_fianza_id),
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-slate-200 bg-indigo-50/30 px-4 py-3">
      <p className="text-xs font-medium text-slate-600 mb-2">
        {inicial ? `Editar fianza ${inicial.numero_poliza}` : 'Nueva fianza'}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Datos de la póliza */}
        <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Proyecto<Req /></label>
            <select value={f.proyecto_id} onChange={set('proyecto_id')} className={inputCls}>
              <option value="">Selecciona…</option>
              {proyectos.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
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
            <label className="text-[11px] text-slate-500 mb-1 block">
              Monto afianzado
              <span className="text-slate-400 font-normal"> · lo que cubre la fianza</span>
            </label>
            <InputPesos
              valor={f.monto_afianzado}
              onChange={(centavos) => setF((s) => ({ ...s, monto_afianzado: centavos }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">
              Prima neta
              <span className="text-slate-400 font-normal"> · tarifa de la afianzadora</span>
            </label>
            <InputPesos
              valor={f.prima_neta}
              onChange={(centavos) => setF((s) => ({ ...s, prima_neta: centavos }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">
              Prima total
              <span className="text-slate-400 font-normal"> · con derecho de póliza e IVA</span>
            </label>
            <InputPesos
              valor={f.prima_total}
              onChange={(centavos) => setF((s) => ({ ...s, prima_total: centavos }))}
              className={inputCls}
            />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Fecha de inicio</label>
            <input type="date" value={f.fecha_inicio} onChange={set('fecha_inicio')} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Fecha de vigencia</label>
            <input type="date" value={f.fecha_vigencia} onChange={set('fecha_vigencia')} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">
              Fecha de recordatorio
              <span className="text-slate-400 font-normal"> · interno</span>
            </label>
            <input type="date" value={f.fecha_recordatorio} onChange={set('fecha_recordatorio')} className={inputCls} />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Nota del recordatorio</label>
            <input
              value={f.nota_recordatorio}
              onChange={set('nota_recordatorio')}
              placeholder="Qué hay que hacer ese día"
              className={inputCls}
            />
          </div>
        </div>

        {/* Tipo de fianza */}
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Tipo de fianza<Req /></label>
          <ChecklistTipos
            tipos={tipos}
            valor={f.tipo_fianza_id}
            onChange={(id) => setF((s) => ({ ...s, tipo_fianza_id: id }))}
          />
        </div>
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={guardar} disabled={busy} className={btnPrimary}>
          <Save className="w-4 h-4" /> {busy ? 'Guardando…' : 'Guardar fianza'}
        </button>
        <button onClick={onCancel} className={btnSecondary}><X className="h-3.5 w-3.5" /> Cancelar</button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Altas simples
   -------------------------------------------------------------------------- */

function NuevoCliente({ vendedores = [], onDone }) {
  const [open, setOpen] = useState(false);
  const empty = {
    razon_social: '', rfc: '', telefono: '', vendedor_id: '',
    nombre_contacto: '', email: '', password: '',
  };
  const [f, setF] = useState(empty);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function guardar() {
    setError('');
    if (!f.razon_social || !f.email || !f.password) {
      setError('Razón social, correo y contraseña son obligatorios.');
      return;
    }
    if (f.password.length < 8) {
      setError('La contraseña inicial debe tener al menos 8 caracteres.');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post('/admin/clientes', f);
      setF(empty);
      setOpen(false);
      onDone(r.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"
      >
        <UserPlus className="w-4 h-4 text-indigo-600" /> Agregar cliente
        <Plus className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${open ? 'rotate-45' : ''}`} />
      </button>
      {open && (
        <div className="p-4 space-y-2.5">
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Razón social<Req /></label>
            <input value={f.razon_social} onChange={set('razon_social')} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">RFC</label>
              <input value={f.rfc} onChange={set('rfc')} className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Teléfono</label>
              <input value={f.telefono} onChange={set('telefono')} className={inputCls} />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Vendedor que lo atiende</label>
            <select value={f.vendedor_id} onChange={set('vendedor_id')} className={inputCls}>
              <option value="">Sin asignar (Home Office)</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </div>

          <div className="border-t border-slate-100 pt-2.5 space-y-2.5">
            <p className="text-[11px] font-medium text-slate-600">Primer acceso al portal</p>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Nombre o puesto del contacto</label>
              <input
                value={f.nombre_contacto}
                onChange={set('nombre_contacto')}
                placeholder="Dirección, Contabilidad…"
                className={inputCls}
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Correo electrónico<Req /></label>
              <input type="email" value={f.email} onChange={set('email')} className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Contraseña inicial<Req /></label>
              <input type="text" value={f.password} onChange={set('password')} placeholder="mínimo 8 caracteres" className={inputCls} />
            </div>
          </div>

          <p className="text-[11px] text-slate-400">
            Después puedes agregarle más personas desde el detalle del cliente. Las líneas
            de crédito se asignan por afianzadora, también desde ahí.
          </p>
          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
            </div>
          )}
          <button onClick={guardar} disabled={busy} className={`${btnPrimary} w-full justify-center`}>
            <Save className="w-4 h-4" /> {busy ? 'Guardando…' : 'Crear cliente'}
          </button>
        </div>
      )}
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
