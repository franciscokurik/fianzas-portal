import { useEffect, useState } from 'react';
import {
  LogOut, Building2, Plus, Save, Download,
  Users, FileText, Files, CheckCircle2, UserPlus, AlertTriangle,
  CreditCard, Trash2, Briefcase, Pencil, X, Bell, ListChecks, Check,
  Paperclip, Upload, FileDown, Mail, KeyRound, UserCog, ShieldCheck, Link2, Layers,
} from 'lucide-react';
import { api, getToken, subirACloudinary } from '../api.js';
import { useAuth } from '../auth.jsx';
import {
  mxn, mxnCents, fmtDate, yaVencio, EstadoBadge, ClaseBadge, InputPesos,
  CumplimientoBadge, TipoClienteBadge, ESTATUS_PROYECTO, etiquetaEstatus,
  ACCEPT_ARCHIVOS, AYUDA_ARCHIVOS, pesoArchivo, revisarArchivo,
} from '../lib.jsx';

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100';
const btnPrimary =
  'flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50';
const btnSecondary =
  'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300';

export default function Admin() {
  const { user, logout } = useAuth();
  // Los tres niveles usan la misma pantalla; lo que cambia es qué se muestra.
  // Ocultar es solo para que no estorbe: quien decide de verdad es el servidor
  // en cada ruta.
  //   vendedor -> solo su cartera, y sin nada de lo que es de la casa.
  //   operador -> todo salvo las cuentas de acceso y la baja de empresas.
  //   admin    -> todo.
  const esAdmin = user?.role === 'admin';
  const esVendedor = user?.role === 'vendedor';
  const puedeOperar = !esVendedor;

  const [clientes, setClientes] = useState([]);
  const [internos, setInternos] = useState([]);
  const [afianzadoras, setAfianzadoras] = useState([]);
  const [tipos, setTipos] = useState([]);
  const [tiposDoc, setTiposDoc] = useState({ proyecto: [], fianza: [] });
  const [tiposDocContratante, setTiposDocContratante] = useState([]);
  const [docsRequeridos, setDocsRequeridos] = useState([]);
  const [recordatorios, setRecordatorios] = useState([]);
  const [sel, setSel] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [msg, setMsg] = useState('');
  const [avisoOp, setAvisoOp] = useState('');
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
  const cargarTiposDoc = () => cargar('/admin/tipos-documento', (d) => {
    setTiposDoc(d.tipos);
    setTiposDocContratante(d.tipos_contratante || []);
  });
  const cargarDocsRequeridos = () => cargar('/admin/documentos-requeridos', (d) => setDocsRequeridos(d.tipos));
  const cargarInternos = () => cargar('/admin/usuarios/internos', (d) => setInternos(d.usuarios));

  useEffect(() => {
    cargarClientes(); cargarAfianzadoras(); cargarTipos();
    cargarRecordatorios(); cargarTiposDoc();
    // Al vendedor estas dos le responden 403 y solo le llenarían la pantalla de
    // errores por algo que no necesita.
    if (puedeOperar) { cargarDocsRequeridos(); cargarInternos(); }
  }, [puedeOperar]);

  // Para el selector de vendedor titular. Se listan todas las cuentas de
  // Fortex y no solo las de rol vendedor, porque un admin o un operador también
  // llevan cuentas propias.
  const vendedores = internos.filter((u) => u.activo);

  function abrirDetalle(id) {
    setSel(id);
    cargar(`/admin/clientes/${id}/detalle`, setDetalle);
  }
  const recargarDetalle = () => sel && cargar(`/admin/clientes/${sel}/detalle`, setDetalle);
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
  // Aparte del verde, y no es cosmético: las rutas devuelven avisos del tipo
  // "quedó ligada PERO el contratante todavía no la ve". Eso iba al banner
  // verde con su palomita, que dice justo lo contrario de lo que el texto
  // advierte. Va en ámbar y sin caducidad: se cierra a mano, para que no se
  // desvanezca antes de leerlo.
  const avisar = (t) => setAvisoOp(t);

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
              <small>{esVendedor ? 'CARTERA DE CLIENTES' : 'ADMINISTRACIÓN DE FIANZAS'}</small>
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
            <p className="portal-eyebrow">{esVendedor ? 'Mi cartera' : 'Centro de operaciones'}</p>
            <h1 className="text-xl font-semibold text-slate-800 flex items-center gap-2">
              <Building2 className="w-5 h-5 text-indigo-600" />
              {esVendedor ? 'Mis clientes' : 'Panel de administración'}
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {user?.nombre} · {esVendedor
                ? 'proyectos, pólizas y documentos de tus clientes'
                : 'gestión de clientes, proyectos y pólizas'}
            </p>
          </div>
        </div>

        {avisoOp && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{avisoOp}</span>
            <button onClick={() => setAvisoOp('')} className="text-amber-500 hover:text-amber-800 shrink-0">✕</button>
          </div>
        )}

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
            {/* Nada de esta columna es del vendedor: son cosas de la casa, no
                de un cliente suyo. */}
            {puedeOperar && (
              <>
                <NuevoCliente
                  vendedores={vendedores}
                  onDone={(id) => { cargarClientes(); flash('Cliente creado'); if (id) abrirDetalle(id); }}
                />
                {/* Las cuentas de acceso son lo único del admin en esta columna. */}
                {esAdmin && (
                  <PersonalFortex
                    internos={internos}
                    onChange={() => { cargarInternos(); cargarClientes(); recargarDetalle(); }}
                    flash={flash}
                  />
                )}
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
                  {esVendedor ? 'Mi cartera' : 'Clientes'} ({clientes.length})
                </h3>
              </div>
              <div className="divide-y divide-slate-100 max-h-[65vh] overflow-y-auto">
                {clientes.map((c) => {
                  const esContratante = c.tipo === 'contratante';
                  // Al contratante lo único que se le alarma es que alguno de
                  // sus proveedores tenga una obra sin fianza vigente: no tiene
                  // pólizas propias, ni expediente, ni papelería.
                  const alerta = esContratante
                    ? c.obras_descubiertas > 0
                    : c.fianzas_vencidas > 0 || c.docs_pendientes > 0
                      || c.papeleria_pendiente > 0 || c.fianzas_por_vencer > 0
                      || c.recordatorios_pendientes > 0;
                  return (
                    <button
                      key={c.id}
                      onClick={() => abrirDetalle(c.id)}
                      className={`w-full text-left px-4 py-2.5 hover:bg-slate-50/60 ${sel === c.id ? 'bg-indigo-50/60' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5 min-w-0">
                          <span className="truncate">{c.razon_social}</span>
                          <TipoClienteBadge tipo={c.tipo} />
                        </span>
                        {alerta && <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />}
                      </div>
                      <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                        {esContratante ? (
                          <>
                            {c.total_proveedores} proveedor(es) en su padrón
                            {c.obras_descubiertas > 0 && (
                              <span className="text-rose-600"> · {c.obras_descubiertas} obra(s) sin fianza vigente</span>
                            )}
                          </>
                        ) : (
                          <>
                            {c.total_proyectos} proyectos · {c.total_fianzas} fianzas · {c.fianzas_vencidas} vencidas
                            {c.total_previos > 0 && (
                              <span className="text-violet-600"> · {c.total_previos} previo(s)</span>
                            )}
                            {c.recordatorios_pendientes > 0 && (
                              <span className="text-amber-600"> · {c.recordatorios_pendientes} recordatorio(s)</span>
                            )}
                            {c.total_contratantes > 0 && (
                              <span className="text-sky-600"> · le surte a {c.total_contratantes} contratante(s)</span>
                            )}
                          </>
                        )}
                      </p>
                      {/* El vendedor titular de la cuenta. */}
                      <p className="text-[11px] mt-0.5">
                        {c.vendedor_nombre
                          ? <span className="text-slate-400">{c.vendedor_nombre}</span>
                          : <span className="text-slate-300">Sin vendedor</span>}
                        <span className="text-slate-300"> · {c.total_usuarios} usuario(s)</span>
                      </p>
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
                  : esVendedor
                    ? 'Aún no tienes clientes asignados. Te los asigna un operador.'
                    : 'Todavía no hay clientes. Da de alta el primero desde "Agregar cliente".'}
              </div>
            ) : (
              <DetalleCliente
                // Remonta el detalle al cambiar de cliente. Sin esto, el
                // formulario "Agregar proveedor" del padrón se queda abierto y
                // con lo tecleado: se empieza a capturar un proveedor para
                // Delta, se hace clic en otro contratante, y al guardar el alta
                // se va al padrón equivocado.
                key={detalle.cliente.id}
                detalle={detalle}
                esAdmin={esAdmin}
                puedeOperar={puedeOperar}
                vendedores={vendedores}
                clientes={clientes}
                tiposDocContratante={tiposDocContratante}
                avisar={avisar}
                onEliminado={() => {
                  setSel(null);
                  setDetalle(null);
                  cargarClientes();
                  cargarRecordatorios();
                  cargarInternos(); // cambian los conteos de cartera
                }}
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
            <span className="text-xs text-slate-500 flex items-center gap-1.5">
              <ClaseBadge clase={r.clase} />
              <span className="font-mono">{r.numero_poliza}</span>
              <span>
                {r.proyecto_nombre && `· ${r.proyecto_nombre} `}· {r.afianzadora_nombre}
              </span>
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

function DetalleCliente({
  detalle, esAdmin, puedeOperar, vendedores, clientes = [], tiposDocContratante = [],
  afianzadoras, tipos, tiposDoc, onChange, onEliminado, flash, avisar,
}) {
  const {
    cliente, usuarios = [], lineas = [], proyectos = [],
    fianzas = [], documentos, papeleria,
    // Solo vienen cuando es un contratante (la API contesta con la forma que le
    // toca a cada tipo, no con listas vacías; ver routes/admin.js).
    proveedores = [], suspendidos = [], obras = [], metricas,
    lineas_proveedores: lineasProveedores = [],
    // Y solo cuando es un fiado: a qué contratantes les surte.
    contratantes = [],
  } = detalle;
  const esContratante = cliente.tipo === 'contratante';
  // Los contratantes que se le pueden ligar a una obra. Sale de la lista que ya
  // está cargada: no hace falta otra ruta.
  const contratantesDisponibles = clientes.filter((c) => c.tipo === 'contratante');
  const [errorBaja, setErrorBaja] = useState('');
  const lineaTotal = lineas.reduce((s, l) => s + (l.linea_credito || 0), 0);
  const disponibleTotal = lineas.reduce((s, l) => s + (l.disponible || 0), 0);
  // Los previos quedan fuera de todas las cifras de dinero: son lo que se
  // cotizó, no lo que la afianzadora emitió. Se cuentan aparte para saber
  // cuántos están en trámite.
  const emitidas = fianzas.filter((f) => f.clase !== 'previo');
  const previos = fianzas.length - emitidas.length;
  const afianzadoTotal = emitidas
    .filter((f) => f.estado !== 'vencida')
    .reduce((s, f) => s + (f.monto_afianzado || 0), 0);
  const sumaPrimaNeta = emitidas.reduce((s, f) => s + (f.prima_neta || 0), 0);
  const sumaPrimaTotal = emitidas.reduce((s, f) => s + (f.prima_total || 0), 0);

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

  // Hermana de descargar(), pero por ID. La carpeta del contratante se arma con
  // panoramaDelContratante, que a propósito NUNCA selecciona la url: pasearla
  // por el front solo para poder pedirla de vuelta sería darle una liga
  // permanente de Cloudinary a algo que no la necesita.
  // Recibe el documento completo, no solo el id, porque el nombre del archivo
  // hace falta: sin él se bajaba un "documento-7" sin extensión que en Windows
  // no abre nada. Y el fallo se reporta por 'avisar' —el estado de error de
  // quien llama— y no por flash(), que es el banner VERDE de éxito con palomita.
  async function descargarPorId(doc, avisar = flash) {
    try {
      const res = await fetch(`/api/admin/documentos/${doc.id}/archivo`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!res.ok) {
        avisar('No se pudo descargar el archivo. Puede que ya no esté disponible.');
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.nombre_archivo || `documento-${doc.id}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      avisar('No se pudo descargar el archivo. Revisa tu conexión e inténtalo de nuevo.');
    }
  }

  // Se pide teclear la razón social, no un "¿estás seguro?": esto se lleva las
  // pólizas, el expediente y los accesos del fiado, y no hay deshacer.
  async function eliminar() {
    setErrorBaja('');
    const escrito = prompt(
      esContratante
        // Lo que hay que decirle es lo que se lleva de OTROS: las obras de sus
        // proveedores no se borran, pero quedan desligadas y esas empresas
        // dejan de tener quién les vigile la fianza.
        ? `Esto elimina a "${cliente.razon_social}":\n`
          + `· su padrón de ${proveedores.length} proveedor(es)\n`
          + `· ${usuarios.length} acceso(s) al portal\n`
          + `· la liga de ${obras.length} obra(s) de sus proveedores (las obras y sus `
          + 'pólizas NO se borran: son de ellos y se quedan)\n\n'
          + 'No se puede deshacer. Para confirmar, escribe la razón social exacta:'
        : `Esto elimina a "${cliente.razon_social}" con TODO su historial:\n`
          + `· ${proyectos.length} proyecto(s)\n`
          + `· ${fianzas.length} fianza(s)\n`
          + `· ${usuarios.length} acceso(s) al portal\n`
          + '· su expediente, papelería y archivos\n\n'
          + 'No se puede deshacer. Para confirmar, escribe la razón social exacta:'
    );
    if (!escrito) return;

    try {
      const r = await api.del(`/admin/clientes/${cliente.id}`, { confirmar: escrito });
      flash(`${r.cliente} eliminado (${r.borrado.fianzas} fianza(s), ${r.borrado.archivos} archivo(s))`);
      onEliminado();
    } catch (e) {
      setErrorBaja(e.message);
    }
  }

  return (
    <>
      {/* Encabezado del cliente */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
              {cliente.razon_social}
              <TipoClienteBadge tipo={cliente.tipo} />
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {cliente.rfc || 'Sin RFC'}
              {cliente.telefono && ` · ${cliente.telefono}`}
              {esContratante && ' · no compra fianzas: se las exige a sus proveedores'}
            </p>
          </div>
          <div className="flex items-end gap-2">
            {/* Cambiar de vendedor no es del vendedor: nadie se queda ni se
                quita clientes a sí mismo. */}
            {puedeOperar ? (
              <AsignarVendedor
                clienteId={cliente.id}
                vendedorId={cliente.vendedor_id}
                vendedores={vendedores}
                onChange={() => { onChange(); flash('Vendedor actualizado'); }}
              />
            ) : (
              <span className="text-[11px] text-slate-400">En tu cartera</span>
            )}
            {/* Dar de baja la empresa se lleva su historial y no tiene deshacer:
                eso sí queda solo para el administrador. */}
            {esAdmin && (
              <button
                onClick={eliminar}
                className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`}
                title="Eliminar cliente con todo su historial"
              >
                <Trash2 className="h-3.5 w-3.5" /> Eliminar
              </button>
            )}
          </div>
        </div>

        {errorBaja && (
          <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {errorBaja}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          {esContratante ? (
            <>
              <Pill label="Proveedores" valor={String(metricas?.proveedores ?? 0)}
                    ayuda="Empresas en su padrón: a quién le exige fianza" />
              <Pill label="Obras vigentes" valor={String(metricas?.obras_vivas ?? 0)}
                    ayuda="Obras de sus proveedores ligadas a él que todavía se juzgan (en proceso, terminadas o entregadas). Las cerradas y canceladas se listan pero no cuentan." />
              <Pill label="Sin fianza vigente" valor={String(metricas?.obras_descubiertas ?? 0)}
                    tono={metricas?.obras_descubiertas ? 'rose' : 'emerald'}
                    ayuda="Obras sin ninguna póliza vigente registrada en Fortex. Es su lista de pendientes —y la de venta." />
              <Pill label="Cobertura a su favor" valor={mxn(metricas?.monto_afianzado)} tono="sky"
                    ayuda="Suma de lo que cubren hoy las fianzas de sus proveedores" />
            </>
          ) : (
            <>
              <Pill label="Línea total" valor={mxn(lineaTotal)} />
              <Pill label="Disponible" valor={mxn(disponibleTotal)} tono="emerald" />
              <Pill label="Monto afianzado" valor={mxn(afianzadoTotal)} tono="sky"
                    ayuda="Suma de lo que cubren las fianzas vigentes. No incluye previos: todavía no se emiten." />
              <Pill label="Prima total" valor={mxn(sumaPrimaTotal)} tono="violet"
                    ayuda="Lo que el fiado paga: prima neta + derecho de póliza + IVA. Sin previos." />
              <Pill label="Prima neta" valor={mxn(sumaPrimaNeta)}
                    ayuda="La tarifa de la afianzadora, sin derecho de póliza ni IVA" />
              {previos > 0 && (
                <Pill label="Previos" valor={String(previos)}
                      ayuda="Capturados pero sin emitir: no cuentan en las cifras de arriba" />
              )}
            </>
          )}
        </div>

        {/* A qué desarrolladores le surte este fiado, y por lo tanto quién le
            está viendo las fianzas de qué obras. Conviene tenerlo a la vista
            ANTES de ligarle otra obra. */}
        {!esContratante && contratantes.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-500">Le surte a:</span>
            {contratantes.map((ct) => {
              // Un padrón suspendido con obras todavía ligadas es un estado
              // real y hay que verlo, pero NO se puede pintar como si el
              // contratante estuviera viendo esas fianzas: no las ve.
              const activo = ct.activo === 1;
              return (
                <span
                  key={ct.id}
                  className={`text-[11px] px-1.5 py-0.5 rounded border ${
                    activo
                      ? 'bg-sky-50 text-sky-700 border-sky-100'
                      : 'bg-slate-50 text-slate-500 border-slate-200'
                  }`}
                  title={activo
                    ? `Ve las fianzas de ${ct.obras_ligadas} obra(s) de este fiado`
                    : `Suspendió a este fiado de su padrón: hoy NO ve nada, aunque `
                      + `${ct.obras_ligadas} obra(s) sigan ligadas`}
                >
                  {ct.razon_social}
                  <span className={activo ? 'text-sky-400 tabular-nums' : 'text-slate-400 tabular-nums'}>
                    {' '}· {ct.obras_ligadas} obra(s){activo ? '' : ' · suspendido'}
                  </span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Quiénes pueden entrar por este fiado */}
      <UsuariosCliente
        clienteId={cliente.id}
        usuarios={usuarios}
        esAdmin={esAdmin}
        onChange={onChange}
        flash={flash}
      />

      {esContratante && (
        <ProyectosDelContratante
          contratanteId={cliente.id}
          contratanteNombre={cliente.razon_social}
          proyectos={proyectos}
          proveedores={proveedores}
          suspendidos={suspendidos}
          clientes={clientes}
          tipos={tipos}
          lineasProveedores={lineasProveedores}
          puedeLigarContratante={puedeOperar}
          onChange={onChange}
          flash={flash}
          avisar={avisar}
        />
      )}

      {esContratante && (
        <PadronProveedores
          contratanteId={cliente.id}
          proveedores={proveedores}
          suspendidos={suspendidos}
          obras={obras}
          clientes={clientes}
          tiposDoc={tiposDocContratante}
          descargar={descargarPorId}
          puedeOperar={puedeOperar}
          onChange={onChange}
          flash={flash}
        />
      )}

      {!esContratante && (
      <>
      {/* Líneas de crédito por afianzadora */}
      <LineasCredito
        clienteId={cliente.id}
        lineas={lineas}
        afianzadoras={afianzadoras}
        puedeEditar={puedeOperar}
        onChange={() => { onChange(); flash('Línea de crédito actualizada'); }}
      />

      {/* Proyectos con sus fianzas */}
      <Proyectos
        clienteId={cliente.id}
        proyectos={proyectos}
        afianzadoras={afianzadoras}
        tipos={tipos}
        tiposDoc={tiposDoc}
        contratantes={contratantesDisponibles}
        puedeLigarContratante={puedeOperar}
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
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
   Los PROYECTOS de un contratante, desde el panel
   --------------------------------------------------------------------------
   El desarrollador los registra desde su portal —es lo que pidió— y Fortex por
   la misma puerta, porque al dar de alta la cuenta hay que capturarlos antes de
   que él entre por primera vez, y sin proyecto no hay a qué ligarle las obras.

   Aquí se ve además lo que el portal del contratante NO le muestra: la línea de
   crédito de cada proveedor y cuánto le queda disponible. Eso es de la empresa
   del proveedor, no de este proyecto, y con eso se le negocia precio. */

/* --------------------------------------------------------------------------
   Las PARTIDAS de un proyecto de contratante, desde el panel
   --------------------------------------------------------------------------
   El desarrollador las captura desde su portal, pero al darle de alta la cuenta
   hay que armarle la obra antes de que entre: sin partidas no hay a qué
   asignarle los contratos, y esa asignación sí es de Fortex.

   Se pinta con lo que ya trae el panorama (mismas partidas, mismos requisitos,
   mismo estado que ve él) — aquí no se vuelve a consultar nada. */

function FormPartidaPanel({ inicial, tipos = [], onSubmit, onCancel }) {
  const [f, setF] = useState({
    nombre: inicial?.nombre || '',
    alcance: inicial?.alcance || '',
    monto_estimado: inicial?.monto_estimado ?? 0,
    orden: inicial?.orden ?? 50,
  });
  const [requisitos, setRequisitos] = useState(
    () => new Set((inicial?.requisitos || []).map((r) => r.tipo_fianza_id))
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const alternar = (id) => setRequisitos((antes) => {
    const nuevo = new Set(antes);
    if (nuevo.has(id)) nuevo.delete(id); else nuevo.add(id);
    return nuevo;
  });

  async function guardar() {
    setError('');
    if (!f.nombre.trim()) return setError('El nombre de la partida es obligatorio.');
    setBusy(true);
    try {
      await onSubmit({ ...f, requisitos: [...requisitos] });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 ml-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/40">
      <p className="text-[11px] font-medium text-slate-600 mb-2">
        {inicial ? 'Editar partida' : 'Nueva partida'}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <div className="sm:col-span-2">
          <input value={f.nombre} onChange={set('nombre')} placeholder="Muros y albañilería *"
                 className={inputCls} />
        </div>
        <input value={f.alcance} onChange={set('alcance')} placeholder="Alcance" className={inputCls} />
        <input type="number" value={f.orden} onChange={set('orden')} placeholder="Orden"
               className={inputCls} title="Menor primero: cimentación 10, acabados 90" />
        <div className="sm:col-span-2">
          <InputPesos
            valor={f.monto_estimado}
            onChange={(c) => setF((s) => ({ ...s, monto_estimado: c }))}
            className={inputCls}
          />
        </div>
      </div>

      {/* Sin esto, la partida solo puede decir "tiene fianza", nunca "le falta
          la de anticipo". Es todo el punto del nivel. */}
      <p className="text-[11px] text-slate-500 mt-2 mb-1">Qué fianzas exige esta partida:</p>
      <div className="flex flex-wrap gap-1.5">
        {tipos.map((t) => (
          <button
            key={t.id}
            onClick={() => alternar(t.id)}
            className={`text-[11px] px-2 py-1 rounded-md border ${
              requisitos.has(t.id)
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'
            }`}
          >
            {t.nombre}
          </button>
        ))}
      </div>
      {requisitos.size === 0 && (
        <p className="text-[11px] text-amber-700 mt-1.5">
          Sin nada marcado, esta partida saldrá verde con cualquier fianza.
        </p>
      )}

      {error && (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="flex gap-2 mt-2">
        <button onClick={guardar} disabled={busy} className={btnSecondary}>
          <Save className="h-3.5 w-3.5" /> {busy ? 'Guardando…' : 'Guardar'}
        </button>
        <button onClick={onCancel} className={btnSecondary}>
          <X className="h-3.5 w-3.5" /> Cancelar
        </button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Asignar contratista a una partida, sin salir de aquí
   --------------------------------------------------------------------------
   Hace lo MISMO que capturar la obra en el detalle del proveedor: crea el
   proyecto del fiado ya apuntando a la partida, y de ahí el servidor deriva el
   desarrollo y el contratante (ver resolverPartida en routes/admin.js). No es
   una segunda forma de ligar, es la misma ruta con el camino corto.

   Existe porque el hueco se ve AQUÍ: la partida dice "sin contratista" en la
   pantalla del contratante, y para taparlo había que salirse, buscar al
   proveedor entre todos los clientes y volver a elegir en tres selects lo que
   esta pantalla ya sabe.

   Solo pide lo que no se puede adivinar. Fechas, notas y estatus se completan
   después en la obra: aquí lo que se quiere es cerrar el hueco rápido. */

// "Cimentaciones Vega SA de CV" -> "Cimentaciones Vega". Solo para el nombre
// que se autocompleta: el contrato se llama como la obra, no como el acta
// constitutiva, y "Muros – Acabados Solís SA de CV" no cabe en el renglón.
const corto = (razonSocial) =>
  String(razonSocial || '')
    .replace(/,?\s+(S\.?A\.?\s*(de\s*C\.?V\.?)?|S\.?\s*de\s*R\.?L\.?(\s*de\s*C\.?V\.?)?|S\.?A\.?P\.?I\.?\s*de\s*C\.?V\.?|S\.?C\.?)\.?$/i, '')
    .trim() || String(razonSocial || '').trim();

function AsignarContratista({
  partida, contratanteId, contratanteNombre, proveedores, suspendidos, clientes,
  onListo, onCancel,
}) {
  const [f, setF] = useState({
    client_id: '',
    nombre: '',
    numero_contrato: '',
    monto_contrato: 0,
  });
  // Para no pisar lo que el operador escribió: el nombre se autocompleta solo
  // mientras no lo haya tocado.
  const [nombreTocado, setNombreTocado] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const enPadron = new Set(proveedores.map((p) => p.id));
  const enSuspendidos = new Set(suspendidos.map((p) => p.id));
  // Los demás fiados: el caso real de "acabo de contratar a alguien nuevo".
  // Se ofrecen porque ligarlos los mete al padrón solo (asegurarEnPadron), así
  // que obligar a darlos de alta antes sería un paso de más sin ninguna
  // garantía extra. Los contratantes se quedan fuera: el servidor los rechaza
  // (exigirFiado) y ofrecerlos sería ofrecer un error.
  const otros = clientes.filter(
    (c) => c.tipo === 'fiado' && !enPadron.has(c.id) && !enSuspendidos.has(c.id)
  );

  const nombreDelProveedor = (id) => {
    const n = Number(id);
    return proveedores.find((p) => p.id === n)?.razon_social
      || suspendidos.find((p) => p.id === n)?.razon_social
      || clientes.find((c) => c.id === n)?.razon_social
      || '';
  };

  function elegirProveedor(id) {
    setF((s) => ({
      ...s,
      client_id: id,
      // "Muros y albañilería – Vega": la misma forma que ya tienen las obras
      // capturadas a mano, para que la lista no se vea de dos épocas.
      nombre: nombreTocado ? s.nombre : (id ? `${partida.nombre} – ${corto(nombreDelProveedor(id))}` : ''),
    }));
  }

  async function guardar() {
    setError('');
    if (!f.client_id) return setError('Elige al contratista.');
    if (!f.nombre.trim()) return setError('El nombre del contrato es obligatorio.');
    setBusy(true);
    try {
      // Solo partida_id: el desarrollo y el contratante los deriva el servidor.
      // Mandarlos también sería repetir un dato que él ya sabe, y si alguno
      // viniera mal contestaría 400 por contradicción.
      const r = await api.post('/admin/proyectos', {
        client_id: Number(f.client_id),
        nombre: f.nombre.trim(),
        numero_contrato: f.numero_contrato || null,
        monto_contrato: f.monto_contrato,
        partida_id: partida.id,
        // El respaldo legible de la póliza. No autoriza nada —eso es
        // contratante_id— pero es el texto que va impreso.
        beneficiario: contratanteNombre || null,
      });
      await onListo(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 ml-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50/40">
      <p className="text-[11px] font-medium text-slate-600 mb-2">
        Asignar contratista a “{partida.nombre}”
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <div className="sm:col-span-2">
          <label className="text-[11px] text-slate-500 mb-1 block">Contratista<Req /></label>
          <select
            value={f.client_id}
            onChange={(e) => elegirProveedor(e.target.value)}
            className={inputCls}
          >
            <option value="">Elige al fiado que la va a hacer…</option>
            {proveedores.length > 0 && (
              <optgroup label="En el padrón de este contratante">
                {proveedores.map((p) => (
                  <option key={p.id} value={p.id}>{p.razon_social}</option>
                ))}
              </optgroup>
            )}
            {otros.length > 0 && (
              <optgroup label="Otros fiados (se agregan al padrón al ligarlos)">
                {otros.map((c) => (
                  <option key={c.id} value={c.id}>{c.razon_social}</option>
                ))}
              </optgroup>
            )}
            {/* Los suspendidos se ofrecen pero se dice qué va a pasar: la obra
                queda ligada y el contratante NO la ve. Esconderlos haría que el
                operador los buscara en "otros fiados" y no los encontrara. */}
            {suspendidos.length > 0 && (
              <optgroup label="Suspendidos en el padrón — el contratante no la vería">
                {suspendidos.map((p) => (
                  <option key={p.id} value={p.id}>{p.razon_social}</option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-[11px] text-slate-500 mb-1 block">Nombre del contrato<Req /></label>
          <input
            value={f.nombre}
            onChange={(e) => { setNombreTocado(true); setF({ ...f, nombre: e.target.value }); }}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">N° de contrato</label>
          <input
            value={f.numero_contrato}
            onChange={(e) => setF({ ...f, numero_contrato: e.target.value })}
            className={inputCls}
          />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Monto del contrato</label>
          <InputPesos
            valor={f.monto_contrato}
            onChange={(c) => setF((s) => ({ ...s, monto_contrato: c }))}
            className={inputCls}
          />
        </div>
      </div>

      {error && (
        <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-2">
        <button onClick={guardar} disabled={busy} className={btnSecondary}>
          <Save className="h-3.5 w-3.5" /> {busy ? 'Asignando…' : 'Asignar'}
        </button>
        <button onClick={onCancel} className={btnSecondary}>
          <X className="h-3.5 w-3.5" /> Cancelar
        </button>
        <span className="text-[11px] text-slate-400">
          Fechas, estatus y pólizas se capturan luego en la obra del proveedor.
        </span>
      </div>
    </div>
  );
}

function PartidasDelProyecto({
  contratanteId, contratanteNombre, proyecto, tipos, nombreDe,
  proveedores = [], suspendidos = [], clientes = [], puedeLigarContratante,
  onChange, flash, avisar,
}) {
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [asignando, setAsignando] = useState(null);
  const [error, setError] = useState('');

  const partidas = proyecto.partidas || [];
  const sinPartida = proyecto.obras_sin_partida || [];

  async function borrar(pa) {
    setError('');
    if (!confirm(`¿Borrar la partida "${pa.nombre}"? No borra ninguna obra ni póliza.`)) return;
    try {
      await api.del(`/admin/clientes/${contratanteId}/partidas/${pa.id}`);
      onChange();
      flash('Partida borrada');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <Layers className="w-3.5 h-3.5 text-slate-400" />
        <p className="text-[11px] font-medium text-slate-600">
          Partidas ({partidas.length})
        </p>
        <button
          onClick={() => { setCreando((c) => !c); setEditando(null); }}
          className={`${btnSecondary} ml-auto`}
        >
          <Plus className={`h-3 w-3 transition-transform ${creando ? 'rotate-45' : ''}`} />
          Partida
        </button>
      </div>

      {error && (
        <div className="mt-2 ml-3 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {creando && (
        <FormPartidaPanel
          tipos={tipos}
          onCancel={() => setCreando(false)}
          onSubmit={async (datos) => {
            await api.post(
              `/admin/clientes/${contratanteId}/proyectos/${proyecto.id}/partidas`, datos
            );
            setCreando(false);
            onChange();
            flash('Partida creada');
          }}
        />
      )}
      {editando && (
        <FormPartidaPanel
          inicial={editando}
          tipos={tipos}
          onCancel={() => setEditando(null)}
          onSubmit={async (datos) => {
            await api.put(`/admin/clientes/${contratanteId}/partidas/${editando.id}`, datos);
            setEditando(null);
            onChange();
            flash('Partida actualizada');
          }}
        />
      )}

      <div className="mt-1.5 pl-3 border-l-2 border-slate-100 space-y-2">
        {partidas.map((pa) => (
          <div key={pa.id}>
            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-slate-700 font-medium">{pa.nombre}</span>
              {pa.monto_estimado > 0 && (
                <span className="text-slate-400 tabular-nums">{mxn(pa.monto_estimado)}</span>
              )}
              <CumplimientoBadge
                estado={pa.estado_cobertura}
                verificada={pa.requisitos.length > 0}
              />
              {/* El atajo va en la partida porque es donde se ve el hueco.
                  Solo para quien puede ligar: al vendedor el servidor le
                  contestaría 403, así que ofrecerle el botón sería ofrecerle un
                  error. */}
              {puedeLigarContratante && (
                <button
                  onClick={() => {
                    setAsignando(asignando === pa.id ? null : pa.id);
                    setCreando(false); setEditando(null);
                  }}
                  className={btnSecondary}
                  title="Asignar contratista a esta partida"
                >
                  <UserPlus className="h-3 w-3" />
                  {!pa.contratos?.length && <span>Asignar contratista</span>}
                </button>
              )}
              <button onClick={() => { setEditando(pa); setCreando(false); setAsignando(null); }}
                      className={btnSecondary} title="Editar partida">
                <Pencil className="h-3 w-3" />
              </button>
              <button onClick={() => borrar(pa)}
                      className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`}
                      title="Borrar partida">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>

            <p className="text-[11px] text-slate-500 pl-1">
              exige:{' '}
              {pa.requisitos.length
                ? pa.requisitos.map((r) => {
                    const falta = pa.faltantes.some((x) => x.tipo_fianza_id === r.tipo_fianza_id);
                    return (
                      <span key={r.tipo_fianza_id} className={falta ? 'text-rose-600 font-medium' : ''}>
                        {r.tipo_fianza}{falta ? ' (falta)' : ''}{' '}
                      </span>
                    );
                  })
                : <span className="text-amber-700">nada capturado</span>}
            </p>

            {asignando === pa.id && (
              <AsignarContratista
                partida={pa}
                contratanteId={contratanteId}
                contratanteNombre={contratanteNombre}
                proveedores={proveedores}
                suspendidos={suspendidos}
                clientes={clientes}
                onCancel={() => setAsignando(null)}
                onListo={async (r) => {
                  setAsignando(null);
                  onChange();
                  flash('Contratista asignado');
                  // El aviso va aparte y en ámbar: dice que la obra quedó
                  // ligada PERO que el contratante todavía no la ve.
                  if (r?.aviso) avisar?.(r.aviso);
                }}
              />
            )}

            {/* Quién la está haciendo. Es lo único de este nivel que el
                contratante NO puede capturar: ligar la obra de una empresa le
                abre sus pólizas. */}
            {pa.contratos?.length
              ? pa.contratos.map((o) => (
                  <p key={o.id} className="text-[11px] text-slate-500 pl-1 flex flex-wrap items-center gap-1.5">
                    <Briefcase className="w-3 h-3 text-slate-300 shrink-0" />
                    <span className="text-slate-600">{nombreDe(o.client_id)}</span>
                    <span className="text-slate-400">{o.nombre}</span>
                    <CumplimientoBadge
                      estado={o.estado_cobertura}
                      verificada={o.cobertura_verificada}
                    />
                    {/* A QUIÉN se le pide qué. Con dos contratistas en la misma
                        partida, el faltante del encabezado no dice de quién es. */}
                    {o.faltantes?.length > 0 && (
                      <span className="text-rose-600 font-medium">
                        le falta {o.faltantes.map((f) => f.tipo_fianza).join(' y ')}
                      </span>
                    )}
                  </p>
                ))
              : (
                <p className="text-[11px] text-slate-400 pl-1">
                  {puedeLigarContratante
                    ? 'sin contratista — usa "Asignar contratista" aquí arriba'
                    : 'sin contratista — lo asigna un operador'}
                </p>
              )}
          </div>
        ))}

        {!partidas.length && !creando && (
          <p className="text-[11px] text-slate-400">
            Sin partidas. Puede armarlas él desde su portal, o créaselas aquí para poder
            asignarle los contratos.
          </p>
        )}
      </div>

      {/* Los contratos que están en el proyecto pero en ninguna partida. Es lo
          capturado antes de que las partidas existieran: se dice, no se
          esconde, porque es captura pendiente. */}
      {sinPartida.length > 0 && (
        <div className="mt-2 ml-3 rounded-lg border border-amber-200 bg-amber-50/60 p-2">
          <p className="text-[11px] font-medium text-amber-800">
            {sinPartida.length} contrato(s) sin partida:
          </p>
          {sinPartida.map((o) => (
            <p key={o.id} className="text-[11px] text-amber-700 pl-1">
              {nombreDe(o.client_id)} · {o.nombre}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

function ProyectosDelContratante({
  contratanteId, contratanteNombre, proyectos, proveedores, suspendidos = [],
  clientes = [], tipos, lineasProveedores, puedeLigarContratante,
  onChange, flash, avisar,
}) {
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState('');

  const nombreDe = (id) => proveedores.find((p) => p.id === id)?.razon_social || 'Proveedor';

  async function borrar(p) {
    setError('');
    if (!confirm(`¿Borrar el proyecto "${p.nombre}" de este contratante? No borra ninguna obra.`)) return;
    try {
      await api.del(`/admin/clientes/${contratanteId}/proyectos/${p.id}`);
      onChange();
      flash('Proyecto borrado');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">
          Proyectos del contratante ({proyectos.length})
        </h3>
        <button onClick={() => { setCreando((c) => !c); setEditando(null); }} className={`${btnSecondary} ml-auto`}>
          <Plus className={`h-3.5 w-3.5 transition-transform ${creando ? 'rotate-45' : ''}`} />
          Nuevo proyecto
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {creando && (
        <FormProyectoContratante
          onCancel={() => setCreando(false)}
          onSubmit={async (datos) => {
            await api.post(`/admin/clientes/${contratanteId}/proyectos`, datos);
            setCreando(false);
            onChange();
            flash('Proyecto creado');
          }}
        />
      )}
      {editando && (
        <FormProyectoContratante
          inicial={editando}
          onCancel={() => setEditando(null)}
          onSubmit={async (datos) => {
            await api.put(`/admin/clientes/${contratanteId}/proyectos/${editando.id}`, datos);
            setEditando(null);
            onChange();
            flash('Proyecto actualizado');
          }}
        />
      )}

      <div className="divide-y divide-slate-100">
        {proyectos.map((p) => {
          return (
            <div key={p.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-slate-800">{p.nombre}</span>
                  {p.clave && <span className="text-[11px] font-mono text-slate-500"> {p.clave}</span>}
                  <p className="text-[11px] text-slate-500">
                    {etiquetaEstatus(p.estatus)}
                    {p.ubicacion && ` · ${p.ubicacion}`}
                    {p.monto_inversion > 0 && ` · inversión ${mxn(p.monto_inversion)}`}
                  </p>
                  <p className="text-[11px] text-slate-500 tabular-nums">
                    {p.total_partidas > 0 && `${p.total_partidas} partida(s) · `}
                    {p.total_proveedores} proveedor(es) · {p.total_obras} obra(s)
                    {p.partidas_sin_contratista > 0 && (
                      <span className="text-slate-500"> · {p.partidas_sin_contratista} sin contratar</span>
                    )}
                    {(p.partidas_descubiertas ?? p.obras_descubiertas) > 0 && (
                      <span className="text-rose-600">
                        {' · '}{p.partidas_descubiertas ?? p.obras_descubiertas} sin fianza completa
                      </span>
                    )}
                    {p.monto_afianzado > 0 && (
                      <span className="text-slate-400"> · {mxn(p.monto_afianzado)} afianzado</span>
                    )}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <CumplimientoBadge
                    estado={p.cumplimiento}
                    verificada={p.total_partidas > 0 && p.partidas_sin_requisitos === 0}
                  />
                  <button onClick={() => { setEditando(p); setCreando(false); }} className={btnSecondary} title="Editar proyecto">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => borrar(p)}
                    className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`}
                    title="Borrar proyecto"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Las obras van DENTRO de su partida: es la misma pantalla que
                  ve el desarrollador, y así el operador captura viendo lo que él
                  va a leer. */}
              <PartidasDelProyecto
                contratanteId={contratanteId}
                contratanteNombre={contratanteNombre}
                proyecto={p}
                tipos={tipos}
                nombreDe={nombreDe}
                proveedores={proveedores}
                suspendidos={suspendidos}
                clientes={clientes}
                puedeLigarContratante={puedeLigarContratante}
                onChange={onChange}
                flash={flash}
                avisar={avisar}
              />

              {/* Lo que este proyecto le aparta a cada proveedor. Es lo que el
                  contratante también ve; la línea completa va abajo y solo aquí. */}
              {p.consumo?.length > 0 && (
                <div className="mt-2 pl-3 space-y-0.5">
                  {p.consumo.map((c) => (
                    <p key={`${c.proveedor_id}:${c.afianzadora_id}`} className="text-[11px] text-slate-500 tabular-nums">
                      <CreditCard className="h-3 w-3 inline text-slate-300 mr-1" />
                      {nombreDe(c.proveedor_id)} / {c.afianzadora_nombre}: aparta{' '}
                      <span className="font-semibold text-slate-700">{mxn(c.comprometido)}</span>
                      {' '}en {c.polizas} póliza(s)
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {!proyectos.length && !creando && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            Este contratante no tiene proyectos todavía. Puede registrarlos él desde su
            portal, o créaselos aquí para poder ligarle las obras de sus proveedores.
          </div>
        )}
      </div>

      {/* La línea de crédito de sus proveedores. ESTO NO LO VE EL CONTRATANTE:
          es de la empresa del proveedor y es el dato con el que se le negocia
          precio. Aquí sirve para contestar "¿le cabe otra fianza en esta obra?". */}
      {lineasProveedores.length > 0 && (
        <div className="border-t border-slate-200">
          <div className="px-4 py-2 bg-slate-50/60 flex items-center gap-2">
            <CreditCard className="w-3.5 h-3.5 text-slate-500" />
            <p className="text-[11px] font-medium text-slate-600">
              Crédito afianzable de sus proveedores
              <span className="font-normal text-slate-400">
                {' '}· es de la empresa, no del proyecto. El contratante NO ve esta tabla.
              </span>
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="text-left px-3 py-2">Proveedor</th>
                  <th className="text-left px-3 py-2">Afianzadora</th>
                  <th className="text-right px-3 py-2">Línea autorizada</th>
                  <th className="text-right px-3 py-2">Comprometido (todas sus obras)</th>
                  <th className="text-right px-3 py-2">Disponible</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lineasProveedores.map((l) => (
                  <tr key={`${l.proveedor_id}:${l.afianzadora_id}`} className="hover:bg-slate-50/40">
                    <td className="px-3 py-1.5 text-slate-700 font-medium">{nombreDe(l.proveedor_id)}</td>
                    <td className="px-3 py-1.5 text-slate-600">{l.afianzadora_nombre}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{mxn(l.linea_credito)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{mxn(l.comprometido_total)}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${
                      l.disponible < 0 ? 'text-rose-600' : 'text-emerald-700'
                    }`}>
                      {mxn(l.disponible)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// El formulario del proyecto de un contratante, desde el panel. Los mismos
// campos que el del portal: es la misma tabla y el mismo servicio.
function FormProyectoContratante({ inicial, onSubmit, onCancel }) {
  const [f, setF] = useState({
    nombre: inicial?.nombre || '',
    clave: inicial?.clave || '',
    ubicacion: inicial?.ubicacion || '',
    monto_inversion: inicial?.monto_inversion ?? 0,
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
      await onSubmit(f);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-slate-200 bg-indigo-50/30 px-4 py-3">
      <p className="text-xs font-medium text-slate-600 mb-2">
        {inicial ? 'Editar proyecto del contratante' : 'Nuevo proyecto del contratante'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="text-[11px] text-slate-500 mb-1 block">Nombre<Req /></label>
          <input value={f.nombre} onChange={set('nombre')} placeholder="Torre Delta Poniente" className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Clave</label>
          <input value={f.clave} onChange={set('clave')} placeholder="TDP-01" className={inputCls} />
        </div>
        <div className="md:col-span-2">
          <label className="text-[11px] text-slate-500 mb-1 block">Ubicación</label>
          <input value={f.ubicacion} onChange={set('ubicacion')} className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Estatus</label>
          <select value={f.estatus} onChange={set('estatus')} className={inputCls}>
            {ESTATUS_PROYECTO.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Monto de inversión</label>
          <InputPesos
            valor={f.monto_inversion}
            onChange={(centavos) => setF((s) => ({ ...s, monto_inversion: centavos }))}
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
        <div className="md:col-span-3">
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

/* --------------------------------------------------------------------------
   Padrón de proveedores de un contratante
   --------------------------------------------------------------------------
   Fortex ve EXACTAMENTE lo que ve el contratante en su portal: la misma
   consulta (panoramaDelContratante) alimenta las dos pantallas. Es a propósito,
   y es lo que hace que esta sección sea segura también para un vendedor: el que
   lleva la cuenta del desarrollador necesita saber a qué proveedor le falta la
   fianza —ahí está su venta—, pero sus proveedores pueden ser clientes de otro
   vendedor, y por aquí no se le escapan primas ni líneas de crédito de nadie. */

function PadronProveedores({
  contratanteId, proveedores, suspendidos = [], obras, clientes,
  tiposDoc = [], descargar, puedeOperar, onChange, flash,
}) {
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const enFalta = proveedores.filter((p) => p.obras_descubiertas > 0).length;

  async function suspender(proveedorId, activo) {
    setError('');
    setBusyId(proveedorId);
    try {
      await api.put(`/admin/clientes/${contratanteId}/proveedores/${proveedorId}`, { activo });
      onChange();
      flash(activo ? 'Proveedor reactivado' : 'Proveedor suspendido del padrón');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function quitar(proveedorId, nombre) {
    setError('');
    if (!confirm(
      `Quitar a "${nombre}" del padrón. Esto NO borra la empresa ni sus pólizas: solo `
      + 'deshace la liga con este contratante.\n\nSi lo que quieres es dejar de trabajar '
      + 'con él conservando el historial, usa Suspender.'
    )) return;
    setBusyId(proveedorId);
    try {
      await api.del(`/admin/clientes/${contratanteId}/proveedores/${proveedorId}`);
      onChange();
      flash('Proveedor quitado del padrón');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">
          Padrón de proveedores ({proveedores.length})
        </h3>
        {enFalta > 0 && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 font-medium">
            {enFalta} en falta
          </span>
        )}
        {puedeOperar && (
          <button onClick={() => setAgregando((a) => !a)} className={`${btnSecondary} ml-auto`}>
            <Plus className={`h-3.5 w-3.5 transition-transform ${agregando ? 'rotate-45' : ''}`} />
            Agregar proveedor
          </button>
        )}
      </div>

      {error && (
        <div className="mx-4 mt-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {agregando && (
        <NuevoProveedor
          contratanteId={contratanteId}
          clientes={clientes}
          // Los suspendidos se reactivan con su botón, no volviéndolos a
          // agregar: así no se pierde de vista que ya estuvieron.
          yaEnPadron={[...proveedores, ...suspendidos].map((p) => p.id)}
          onCancel={() => setAgregando(false)}
          onDone={(msg) => { setAgregando(false); onChange(); flash(msg); }}
        />
      )}

      <div className="divide-y divide-slate-100">
        {proveedores.map((p) => {
          const suyas = obras.filter((o) => o.client_id === p.id);
          return (
            <div key={p.id} className="px-4 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-slate-700">{p.razon_social}</span>
                  <p className="text-[11px] text-slate-500">
                    {p.alias && <span className="text-slate-600">{p.alias} · </span>}
                    {p.rfc || 'Sin RFC'}
                    {p.notas && <span className="text-slate-400"> · {p.notas}</span>}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {p.monto_afianzado > 0 && (
                    <span className="text-[11px] text-slate-500 tabular-nums">
                      {mxn(p.monto_afianzado)} afianzado
                    </span>
                  )}
                  <CumplimientoBadge estado={p.cumplimiento} />
                  {puedeOperar && (
                    <>
                      <button
                        onClick={() => suspender(p.id, false)}
                        disabled={busyId === p.id}
                        className={btnSecondary}
                        title="Suspender del padrón: deja de ver sus obras al instante, pero queda el historial"
                      >
                        Suspender
                      </button>
                      <button
                        onClick={() => quitar(p.id, p.razon_social)}
                        disabled={busyId === p.id}
                        className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`}
                        title="Quitar la liga (no borra la empresa)"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Las obras ligadas, con su cobertura. Es lo mismo que ve él. */}
              {suyas.length > 0 && (
                <div className="mt-1.5 pl-3 border-l-2 border-slate-100 space-y-1">
                  {suyas.map((o) => (
                    <ObraDelPadron
                      key={o.id}
                      obra={o}
                      contratanteId={contratanteId}
                      tiposDoc={tiposDoc}
                      descargar={descargar}
                      onChange={onChange}
                      flash={flash}
                    />
                  ))}
                </div>
              )}
              {!suyas.length && (
                <p className="mt-1 pl-3 text-[11px] text-slate-400">
                  Sin obras ligadas. Ligar la obra se hace en el detalle del proveedor,
                  en el campo "Para" del proyecto.
                </p>
              )}
            </div>
          );
        })}
        {!proveedores.length && !agregando && (
          <div className="px-4 py-8 text-center text-sm text-slate-400">
            Este contratante no tiene proveedores activos todavía. Agrégalos para que
            pueda ver quién le presentó fianza y quién no.
          </div>
        )}
      </div>

      {/* Los suspendidos, aparte y atenuados. El contratante NO los ve; están
          aquí para poder reactivarlos, porque sin esta sección suspender era una
          puerta de un solo sentido. */}
      {suspendidos.length > 0 && (
        <div className="border-t border-slate-200 bg-slate-50/60">
          <p className="px-4 pt-2.5 text-[11px] font-medium text-slate-500">
            Suspendidos ({suspendidos.length})
            <span className="font-normal text-slate-400">
              {' '}· el contratante no los ve, y sus obras ligadas tampoco
            </span>
          </p>
          <div className="divide-y divide-slate-100">
            {suspendidos.map((p) => (
              <div key={p.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0">
                  <span className="text-sm text-slate-500">{p.razon_social}</span>
                  <p className="text-[11px] text-slate-400">
                    {p.alias && <span>{p.alias} · </span>}
                    {p.rfc || 'Sin RFC'}
                    {p.obras_ligadas > 0 && (
                      <span className="text-amber-600">
                        {' '}· {p.obras_ligadas} obra(s) siguen ligadas
                      </span>
                    )}
                  </p>
                </div>
                {puedeOperar && (
                  <button
                    onClick={() => suspender(p.id, true)}
                    disabled={busyId === p.id}
                    className={`${btnSecondary} ml-auto`}
                    title="Volver a ponerlo en el padrón: el contratante vuelve a ver sus obras ligadas"
                  >
                    Reactivar
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Un renglón de obra dentro del padrón, con la carpeta del contratante detrás
// del clip.
//
// La carpeta es la MISMA que él ve en su portal, y Fortex sube por la misma
// puerta: en la práctica el proveedor le entrega la fianza en papel al
// desarrollador o directo a Fortex, y las dos cosas pasan. Lo único que cambia
// es el 'subido_por', que queda a la vista para saber quién la consiguió.
function ObraDelPadron({ obra: o, contratanteId, tiposDoc, descargar, onChange, flash }) {
  const [abierta, setAbierta] = useState(false);
  const docs = o.mis_documentos || [];

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Briefcase className="w-3 h-3 text-slate-300 shrink-0" />
        <span className="text-slate-600">{o.nombre}</span>
        <span className="text-slate-400">{etiquetaEstatus(o.estatus)}</span>
        <CumplimientoBadge estado={o.estado_cobertura} verificada={o.cobertura_verificada} />
        <span className="text-slate-400 tabular-nums">
          {o.fianzas.length} póliza(s){o.total_previos > 0 && ` · ${o.total_previos} previo(s)`}
        </span>
        <button
          onClick={() => setAbierta((a) => !a)}
          className={`${btnSecondary} ml-auto ${docs.length ? 'text-indigo-700 border-indigo-200' : ''}`}
          title="Documentos que el contratante recibió de esta obra"
        >
          <Paperclip className="h-3 w-3" />
          {docs.length > 0 && <span className="tabular-nums">{docs.length}</span>}
        </button>
      </div>

      {abierta && (
        <CarpetaDelContratante
          contratanteId={contratanteId}
          obraId={o.id}
          documentos={docs}
          tipos={tiposDoc}
          descargar={descargar}
          onChange={onChange}
          flash={flash}
        />
      )}
    </div>
  );
}

// La carpeta del contratante sobre una obra, desde el panel. Es hermana de
// DocsEntidad, pero el dueño del archivo es el CONTRATANTE y no el fiado de la
// obra: por eso la subida se firma con su client_id y se registra por su ruta.
function CarpetaDelContratante({
  contratanteId, obraId, documentos, tipos, descargar, onChange, flash,
}) {
  const [tipoDoc, setTipoDoc] = useState(tipos[0]?.clave || 'fianza_presentada');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');

  async function subir(archivo) {
    if (!archivo) return;
    setError('');
    const problema = revisarArchivo(archivo);
    if (problema) return setError(problema);

    setSubiendo(true);
    try {
      // Bajo la carpeta del CONTRATANTE, que es de quien es el archivo.
      const subido = await subirACloudinary(contratanteId, archivo);
      await api.post(`/admin/clientes/${contratanteId}/obras/${obraId}/documentos`,
        { ...subido, tipo_doc: tipoDoc });
      onChange();
      flash('Documento subido a la carpeta del contratante');
    } catch (e) {
      setError(e.message);
    } finally {
      setSubiendo(false);
    }
  }

  async function quitar(id) {
    setError('');
    try {
      await api.del(`/admin/documentos/${id}`);
      onChange();
      flash('Documento eliminado');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="mt-1.5 mb-2 rounded-lg border border-slate-200 bg-slate-50/60 p-2.5">
      <p className="text-[11px] font-medium text-slate-600 mb-1.5">
        Documentos que el contratante recibió
        <span className="font-normal text-slate-400">
          {' '}· son de él, el proveedor no los ve. Un PDF aquí no es una póliza capturada.
        </span>
      </p>

      {documentos.length > 0 && (
        <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white mb-2">
          {documentos.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px]">
              <Paperclip className="h-3 w-3 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700 shrink-0">{d.tipo_doc_nombre}</span>
              <span className="text-slate-500 truncate">{d.nombre_archivo}</span>
              <span className="text-slate-400 tabular-nums shrink-0">{pesoArchivo(d.size_bytes)}</span>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                {d.subido_por === 'fortex' ? 'lo cargamos' : 'lo cargó él'}
              </span>
              <button onClick={() => descargar(d, setError)} className={`${btnSecondary} ml-auto shrink-0`}>
                <FileDown className="h-3 w-3" /> Ver
              </button>
              <button
                onClick={() => quitar(d.id)}
                className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600 shrink-0`}
                title="Eliminar documento"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={tipoDoc}
          onChange={(e) => setTipoDoc(e.target.value)}
          className="text-[11px] px-2 py-1 rounded-md border border-slate-200 bg-white text-slate-700"
        >
          {tipos.map((t) => <option key={t.clave} value={t.clave}>{t.nombre}</option>)}
        </select>
        <label className={`${btnSecondary} cursor-pointer ${subiendo ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload className="h-3 w-3" /> {subiendo ? 'Subiendo…' : 'Subir'}
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
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

// Un proveedor se liga eligiéndolo de los clientes que ya existen, o se crea
// aquí mismo. Lo segundo es el caso normal: casi nunca está dado de alta, y
// mandar al operador a "Agregar cliente" le pediría un correo y una contraseña
// que de un proveedor al que solo se le vigila la fianza casi nunca se tienen.
function NuevoProveedor({ contratanteId, clientes, yaEnPadron, onCancel, onDone }) {
  const [modo, setModo] = useState('nuevo'); // 'nuevo' | 'existente'
  const [f, setF] = useState({
    proveedor_id: '', razon_social: '', rfc: '', telefono: '',
    alias: '', notas: '', email: '', password: '', nombre_contacto: '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Solo fiados, y solo los que no estén ya en el padrón.
  const candidatos = clientes.filter(
    (c) => c.tipo !== 'contratante' && c.id !== contratanteId && !yaEnPadron.includes(c.id)
  );

  async function guardar() {
    setError('');
    if (modo === 'existente' && !f.proveedor_id) return setError('Elige un cliente.');
    if (modo === 'nuevo' && !f.razon_social.trim()) {
      return setError('La razón social del proveedor es obligatoria.');
    }
    if (modo === 'nuevo' && f.email && f.password.length < 8) {
      return setError('Si le vas a dar acceso, la contraseña inicial debe tener al menos 8 caracteres.');
    }
    setBusy(true);
    try {
      // Solo se mandan las llaves que este modo de verdad captura. Mandar
      // `notas: ''` desde una pestaña que no dibuja ese campo le borraba al
      // contratante la nota que tenía escrita.
      const cuerpo = modo === 'existente'
        ? { proveedor_id: f.proveedor_id, ...(f.alias.trim() ? { alias: f.alias } : {}) }
        : f;
      const r = await api.post(`/admin/clientes/${contratanteId}/proveedores`, cuerpo);
      onDone(r.creado ? 'Proveedor creado y agregado al padrón' : 'Proveedor agregado al padrón');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-slate-200 bg-indigo-50/30 px-4 py-3">
      <div className="flex items-center gap-1 mb-3">
        {[['nuevo', 'Proveedor nuevo'], ['existente', 'Ya es cliente']].map(([k, label]) => (
          <button
            key={k}
            onClick={() => setModo(k)}
            className={`text-xs px-2.5 py-1 rounded-md border ${
              modo === k
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'border-slate-200 text-slate-600 hover:bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {modo === 'existente' ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div className="md:col-span-2">
            <label className="text-[11px] text-slate-500 mb-1 block">Cliente<Req /></label>
            <select value={f.proveedor_id} onChange={set('proveedor_id')} className={inputCls}>
              <option value="">Elige…</option>
              {candidatos.map((c) => (
                <option key={c.id} value={c.id}>{c.razon_social}</option>
              ))}
            </select>
            {!candidatos.length && (
              <p className="text-[11px] text-slate-400 mt-1">
                No hay clientes disponibles: o ya están todos en el padrón, o hay que crearlos.
              </p>
            )}
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Qué le surte</label>
            <input value={f.alias} onChange={set('alias')} placeholder="Estructura, acabados…" className={inputCls} />
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <div className="md:col-span-2">
              <label className="text-[11px] text-slate-500 mb-1 block">Razón social<Req /></label>
              <input value={f.razon_social} onChange={set('razon_social')} className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Qué le surte</label>
              <input value={f.alias} onChange={set('alias')} placeholder="Estructura, acabados…" className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">RFC</label>
              <input value={f.rfc} onChange={set('rfc')} className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Teléfono</label>
              <input value={f.telefono} onChange={set('telefono')} className={inputCls} />
            </div>
            <div>
              <label className="text-[11px] text-slate-500 mb-1 block">Notas</label>
              <input value={f.notas} onChange={set('notas')} className={inputCls} />
            </div>
          </div>

          <div className="border-t border-slate-200 mt-3 pt-2.5">
            <p className="text-[11px] font-medium text-slate-600">
              Acceso al portal <span className="font-normal text-slate-400">· opcional</span>
            </p>
            <p className="text-[11px] text-slate-400 mb-2">
              Déjalo vacío si el proveedor no va a entrar. Su fianza la captura Fortex
              y el contratante la ve igual.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">Nombre o puesto</label>
                <input value={f.nombre_contacto} onChange={set('nombre_contacto')} className={inputCls} />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">Correo</label>
                <input type="email" value={f.email} onChange={set('email')} className={inputCls} />
              </div>
              <div>
                <label className="text-[11px] text-slate-500 mb-1 block">Contraseña inicial</label>
                <input type="text" value={f.password} onChange={set('password')} placeholder="mínimo 8 caracteres" className={inputCls} />
              </div>
            </div>
          </div>
        </>
      )}

      {error && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={guardar} disabled={busy} className={btnPrimary}>
          <Save className="w-4 h-4" /> {busy ? 'Guardando…' : 'Agregar al padrón'}
        </button>
        <button onClick={onCancel} className={btnSecondary}><X className="h-3.5 w-3.5" /> Cancelar</button>
      </div>
    </div>
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
    const problema = revisarArchivo(archivo);
    if (problema) return setError(problema);

    setBusyId(typeId);
    try {
      // Va directo a Cloudinary; a la API solo se le dice dónde quedó.
      const subido = await subirACloudinary(clienteId, archivo);
      await api.post(`/admin/clientes/${clienteId}/documentos/${typeId}`, subido);
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
   El vendedor titular de la cuenta.
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
        <option value="">Sin asignar</option>
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

  async function cambiarCorreo(u) {
    const correo = prompt(`Nuevo correo para ${u.nombre}:`, u.email);
    if (!correo || correo.trim() === u.email) return;
    setError('');
    try {
      await api.put(`/admin/usuarios/${u.id}`, { email: correo.trim() });
      onChange();
      flash('Correo actualizado');
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
                <button onClick={() => cambiarCorreo(u)} className={btnSecondary} title="Cambiar correo">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
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
   Personal de Fortex: vendedores, operadores y administradores
   -------------------------------------------------------------------------- */

function PersonalFortex({ internos = [], onChange, flash }) {
  const vacio = { nombre: '', email: '', password: '', role: 'operador' };
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

  // Borrar de veras, no desactivar: es para las cuentas que nunca debieron
  // existir (las de demostración, o una creada con el correo equivocado).
  async function borrar(u) {
    if (!confirm(`¿Borrar definitivamente la cuenta de ${u.nombre} <${u.email}>?\n\n`
      + (u.clientes_asignados
        ? `Sus ${u.clientes_asignados} cliente(s) quedarán sin vendedor asignado.\n\n`
        : '')
      + 'Si esta persona sí trabajó en el portal, mejor desactívala con la ✕ para conservar el registro.')) return;

    setError('');
    try {
      await api.del(`/admin/usuarios/${u.id}/permanente`);
      onChange();
      flash('Cuenta eliminada');
    } catch (e) {
      setError(e.message);
    }
  }

  // Aquí es donde se corrige el correo de la propia cuenta de administrador
  // cuando la que quedó sembrada no es la que se usa de verdad.
  async function editar(u, campo, etiqueta) {
    const valor = prompt(`${etiqueta} de ${u.nombre}:`, campo === 'email' ? u.email : '');
    if (!valor) return;
    setError('');
    try {
      await api.put(`/admin/usuarios/${u.id}`, { [campo]: valor.trim() });
      onChange();
      flash(campo === 'email' ? 'Correo actualizado' : 'Contraseña actualizada');
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
            El vendedor solo ve y edita los clientes que le asignes. El operador hace toda la
            operación sobre todos. El administrador además maneja estas cuentas y puede dar de
            baja empresas. El correo debe ser del dominio de Fortex.
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
                <option value="operador">Operador</option>
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
                    {u.email} · {u.role}
                    {u.clientes_asignados > 0 && ` · titular de ${u.clientes_asignados}`}
                  </p>
                </div>
                <button
                  onClick={() => editar(u, 'email', 'Nuevo correo')}
                  className="text-slate-300 hover:text-indigo-600 shrink-0"
                  title="Cambiar correo"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => editar(u, 'password', 'Nueva contraseña (mínimo 8 caracteres)')}
                  className="text-slate-300 hover:text-indigo-600 shrink-0"
                  title="Reponer contraseña"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => cambiarActivo(u)}
                  className="text-slate-300 hover:text-amber-600 shrink-0"
                  title={u.activo ? 'Desactivar (sigue en la lista)' : 'Reactivar'}
                >
                  {u.activo ? <X className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => borrar(u)}
                  className="text-slate-300 hover:text-rose-600 shrink-0"
                  title="Borrar definitivamente"
                >
                  <Trash2 className="h-3.5 w-3.5" />
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
    rose: 'bg-rose-50 text-rose-700',
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
        {/* La línea es el riesgo que asume la casa. El vendedor la consulta para
            saber cuánto le queda disponible al cliente, pero no la mueve. */}
        {!puedeEditar && (
          <span className="text-[11px] text-slate-400 ml-auto">Las autoriza un operador</span>
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

function Proyectos({
  clienteId, proyectos, afianzadoras, tipos, tiposDoc,
  contratantes = [], puedeLigarContratante, onChange, flash,
}) {
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
          contratantes={contratantes}
          puedeLigarContratante={puedeLigarContratante}
          onCancel={() => setCreando(false)}
          onSubmit={async (datos) => {
            const r = await api.post('/admin/proyectos', { client_id: clienteId, ...datos });
            setCreando(false);
            onChange();
            // El servidor avisa si la obra quedó ligada a un contratante que
            // tiene suspendido a este proveedor: se ligó, pero todavía no la ve.
            flash('Proyecto creado');
            if (r.aviso) avisar(r.aviso);
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
            contratantes={contratantes}
            puedeLigarContratante={puedeLigarContratante}
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

function Proyecto({
  proyecto: p, proyectos, clienteId, afianzadoras, tipos, tiposDoc,
  contratantes = [], puedeLigarContratante, onChange, flash,
}) {
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
            {/* Que se vea sin abrir nada: las pólizas de esta obra las está
                viendo otra empresa. */}
            {p.contratante_nombre && (
              <p className="text-[11px] mt-0.5 inline-flex items-center gap-1 text-sky-700">
                <Link2 className="h-3 w-3" />
                Las ve <span className="font-medium">{p.contratante_nombre}</span>
                {p.desarrollo_nombre
                  ? <span className="text-sky-500"> · en «{p.desarrollo_nombre}»</span>
                  : <span className="text-amber-600" title="El contratante la ve, pero le sale suelta: no está dentro de ninguno de sus proyectos."> · sin agrupar</span>}
              </p>
            )}
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
            clienteId={clienteId}
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
          contratantes={contratantes}
          puedeLigarContratante={puedeLigarContratante}
          onCancel={() => setEditando(false)}
          onSubmit={async (datos) => {
            const r = await api.put(`/admin/proyectos/${p.id}`, datos);
            setEditando(false);
            onChange();
            flash('Proyecto actualizado');
            if (r.aviso) avisar(r.aviso);
          }}
        />
      )}

      {abierto && (
        <div className="bg-slate-50/40 border-t border-slate-100">
          <TablaFianzas
            clienteId={clienteId}
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
              <Plus className={`h-3.5 w-3.5 transition-transform ${nuevaFianza ? 'rotate-45' : ''}`} /> Agregar fianza o previo a este proyecto
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
                flash(datos.clase === 'previo' ? 'Previo agregado' : 'Fianza agregada');
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TablaFianzas({ clienteId, fianzas, proyectos, afianzadoras, tipos, tiposDoc, onChange, flash }) {
  const [editandoId, setEditandoId] = useState(null);
  const [docsAbiertos, setDocsAbiertos] = useState(null);

  if (!fianzas.length) {
    return <div className="px-4 py-5 text-center text-xs text-slate-400">Sin fianzas ni previos en este proyecto.</div>;
  }

  async function borrar(f) {
    await api.del(`/admin/fianzas/${f.id}`);
    onChange();
    flash(f.clase === 'previo' ? 'Previo eliminado' : 'Fianza eliminada');
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
                      flash(datos.clase === 'previo' ? 'Previo actualizado' : 'Fianza actualizada');
                    }}
                  />
                </td>
              </tr>
            ) : (
              <tr key={f.id} className="hover:bg-white/70">
                <td className="px-3 py-1.5 text-slate-700">
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono">{f.numero_poliza}</span>
                    <ClaseBadge clase={f.clase} />
                  </span>
                </td>
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
                    <button onClick={() => setEditandoId(f.id)} className={btnSecondary} title={f.clase === 'previo' ? 'Editar previo' : 'Editar fianza'}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => borrar(f)} className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`} title={f.clase === 'previo' ? 'Eliminar previo' : 'Eliminar fianza'}>
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
                    {f.clase === 'previo' ? 'Documentos del previo' : 'Documentos de la fianza'}{' '}
                    <span className="font-mono text-slate-400">{f.numero_poliza}</span>
                  </p>
                  <DocsEntidad
                    clienteId={clienteId}
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

function DocsEntidad({ clienteId, entidad, id, documentos = [], tipos = [], onChange, flash }) {
  const [tipoDoc, setTipoDoc] = useState(tipos[0]?.clave || 'otro');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');

  async function subir(archivo) {
    if (!archivo) return;
    setError('');
    const problema = revisarArchivo(archivo);
    if (problema) return setError(problema);

    setSubiendo(true);
    try {
      // Va directo a Cloudinary; a la API solo se le dice dónde quedó.
      const subido = await subirACloudinary(clienteId, archivo);
      await api.post(`/admin/${entidad}/${id}/documentos`, { ...subido, tipo_doc: tipoDoc });
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

function FormProyecto({
  inicial, contratantes = [], puedeLigarContratante, onSubmit, onCancel,
}) {
  const [f, setF] = useState({
    nombre: inicial?.nombre || '',
    numero_contrato: inicial?.numero_contrato || '',
    beneficiario: inicial?.beneficiario || '',
    monto_contrato: inicial?.monto_contrato ?? 0, // centavos
    fecha_inicio: inicial?.fecha_inicio || '',
    fecha_termino: inicial?.fecha_termino || '',
    estatus: inicial?.estatus || 'en_proceso',
    notas: inicial?.notas || '',
    // Vacío = la obra no es para ningún contratante del portal, que es el caso
    // normal (CFE, el IMSS, un municipio). Se manda siempre, incluso vacío, para
    // poder DESLIGAR una obra: el servidor distingue "no vino el campo" de
    // "vino vacío" (ver camposAActualizar en routes/admin.js).
    contratante_id: inicial?.contratante_id ?? '',
    // Y dentro de QUÉ proyecto de ese contratante va. Es agrupación, no permiso:
    // el servidor deriva el contratante del proyecto cuando viene, así que las
    // dos columnas no pueden discrepar.
    desarrollo_id: inicial?.desarrollo_id ?? '',
    // Y dentro de qué PARTIDA de ese proyecto: los muros, la electricidad. Es
    // el nivel donde de verdad se exige la fianza, y el que manda: el servidor
    // deriva de ella el proyecto y el contratante.
    partida_id: inicial?.partida_id ?? '',
  });
  // Los proyectos del contratante elegido. Se piden al elegirlo porque son de
  // él: no hay una lista global que sirva.
  const [proyectosDelContratante, setProyectosDelContratante] = useState([]);
  const [partidasDelProyecto, setPartidasDelProyecto] = useState([]);

  useEffect(() => {
    if (!f.contratante_id) { setProyectosDelContratante([]); return; }
    let vigente = true;
    api.get(`/admin/clientes/${f.contratante_id}/proyectos`)
      .then((d) => { if (vigente) setProyectosDelContratante(d.proyectos || []); })
      .catch(() => { if (vigente) setProyectosDelContratante([]); });
    return () => { vigente = false; };
  }, [f.contratante_id]);

  // Las partidas del proyecto elegido, por lo mismo: son de él.
  useEffect(() => {
    if (!f.contratante_id || !f.desarrollo_id) { setPartidasDelProyecto([]); return; }
    let vigente = true;
    api.get(`/admin/clientes/${f.contratante_id}/proyectos/${f.desarrollo_id}/partidas`)
      .then((d) => { if (vigente) setPartidasDelProyecto(d.partidas || []); })
      .catch(() => { if (vigente) setPartidasDelProyecto([]); });
    return () => { vigente = false; };
  }, [f.contratante_id, f.desarrollo_id]);
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
        {/* Distinto del beneficiario de texto libre, y a propósito: el
            beneficiario es quién aparece en la póliza (casi siempre CFE, el
            IMSS o un municipio, que no entran al portal). ESTO es quién va a
            VER estas fianzas desde su cuenta. */}
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">
            Para (contratante del portal)
          </label>
          {puedeLigarContratante ? (
            <>
              <select
                value={f.contratante_id ?? ''}
                // Al cambiar de contratante se limpia el proyecto: un desarrollo
                // del contratante anterior no vale para el nuevo, y el select se
                // esconde al vaciar "Para" pero el estado sobrevivía — así el
                // formulario mandaba el desarrollo viejo y el servidor volvía a
                // derivar de él el contratante que se quería quitar.
                onChange={(e) => setF((s) => ({
                  ...s, contratante_id: e.target.value, desarrollo_id: '', partida_id: '',
                }))}
                className={inputCls}
                disabled={!contratantes.length}
              >
                <option value="">No es para un contratante del portal</option>
                {contratantes.map((c) => (
                  <option key={c.id} value={c.id}>{c.razon_social}</option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                {contratantes.length
                  ? (f.contratante_id
                    ? 'Ese contratante va a ver las pólizas de ESTA obra (no las demás de este cliente).'
                    : 'Déjalo así si la obra no es para un contratante dado de alta en el portal.')
                  : 'Todavía no hay ninguna cuenta de tipo contratante.'}
              </p>
            </>
          ) : (
            <p className="text-[11px] text-slate-400 py-2">
              {inicial?.contratante_nombre
                ? `${inicial.contratante_nombre} ve las fianzas de esta obra.`
                : 'Sin contratante.'}
              {' '}Solo un operador puede cambiarlo: le abre las pólizas a otra empresa.
            </p>
          )}
        </div>
        {/* En qué proyecto del contratante va esta obra. Es lo que le arma al
            desarrollador la torre completa en un lugar; sin esto sus obras le
            salen sueltas, una por proveedor. */}
        {puedeLigarContratante && f.contratante_id && (
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">
              Proyecto del contratante
            </label>
            <select
              value={f.desarrollo_id ?? ''}
              // La partida se limpia siempre: era de OTRO proyecto, y dejarla
              // haría que las tres columnas discreparan. El servidor rechaza esa
              // combinación con 400, pero mandarla ya sería un error de captura
              // que el operador no pidió.
              onChange={(e) => setF((s) => ({
                ...s, desarrollo_id: e.target.value, partida_id: '',
              }))}
              className={inputCls}
              disabled={!proyectosDelContratante.length}
            >
              <option value="">Sin agrupar en ningún proyecto</option>
              {proyectosDelContratante.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}{p.clave ? ` (${p.clave})` : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              {proyectosDelContratante.length
                ? 'La obra aparece agrupada dentro de ese proyecto en el portal del contratante.'
                : 'Ese contratante todavía no tiene proyectos. Puedes crearle uno en su detalle.'}
            </p>
          </div>
        )}
        {/* Qué PEDAZO del proyecto está haciendo este fiado. Es lo que el
            desarrollador pidió: no "Vega tiene una obra en la torre", sino
            "los muros los hace Vega y le exijo cumplimiento y anticipo".

            Elegirla fija también el proyecto y el contratante —el servidor los
            deriva de ella—, así que las tres columnas nunca discrepan. */}
        {puedeLigarContratante && f.contratante_id && f.desarrollo_id && (
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">
              Partida del proyecto
            </label>
            <select
              value={f.partida_id ?? ''}
              onChange={(e) => setF((s) => ({ ...s, partida_id: e.target.value }))}
              className={inputCls}
              disabled={!partidasDelProyecto.length}
            >
              <option value="">Sin asignar a ninguna partida</option>
              {partidasDelProyecto.map((pa) => (
                <option key={pa.id} value={pa.id}>
                  {pa.nombre}
                  {pa.requisitos?.length
                    ? ` — exige ${pa.requisitos.map((r) => r.tipo_fianza).join(' + ')}`
                    : ''}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              {partidasDelProyecto.length
                ? 'La obra aparece dentro de esa partida, y el portal compara sus fianzas '
                  + 'contra lo que la partida exige.'
                : 'Ese proyecto todavía no tiene partidas. Créaselas en el detalle del '
                  + 'contratante, o déjala sin asignar.'}
            </p>
          </div>
        )}
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

// Fianza emitida o previo: los MISMOS campos: un previo es lo que se cotizó y
// el día que la afianzadora emite se pasa a fianza sin recapturar nada (solo
// cambia esta opción). Lo único que cambia es que el previo no entra en las
// cifras de dinero ni en los avisos de vencimiento.
const CLASES = [
  ['fianza', 'Fianza', 'Póliza ya emitida por la afianzadora'],
  ['previo', 'Previo', 'Todavía no se emite: no suma en montos ni línea de crédito'],
];

function SelectorClase({ valor, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
      {CLASES.map(([clave, etiqueta, ayuda]) => (
        <button
          key={clave}
          type="button"
          onClick={() => onChange(clave)}
          title={ayuda}
          className={`px-3 py-1.5 text-xs rounded-md font-medium transition-colors ${
            valor === clave
              ? clave === 'previo'
                ? 'bg-violet-600 text-white'
                : 'bg-indigo-600 text-white'
              : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          {etiqueta}
        </button>
      ))}
    </div>
  );
}

function FormFianza({ inicial, proyectos, proyectoId, afianzadoras, tipos, onSubmit, onCancel }) {
  const [f, setF] = useState({
    // Lo que se captura casi siempre es una póliza; el previo se marca a mano.
    clase: inicial?.clase || 'fianza',
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
  const esPrevio = f.clase === 'previo';

  async function guardar() {
    setError('');
    if (!f.proyecto_id) return setError('Selecciona el proyecto al que pertenece la fianza.');
    if (!f.afianzadora_id) return setError('Selecciona la afianzadora.');
    if (!f.numero_poliza.trim()) {
      return setError(esPrevio
        ? 'Captura el número del previo (o la referencia con la que lo pediste).'
        : 'Captura el número de póliza.');
    }
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
        <p className="text-xs font-medium text-slate-600">
          {inicial
            ? `Editar ${esPrevio ? 'previo' : 'fianza'} ${inicial.numero_poliza}`
            : esPrevio ? 'Nuevo previo' : 'Nueva fianza'}
        </p>
        <SelectorClase valor={f.clase} onChange={(clase) => setF((s) => ({ ...s, clase }))} />
        <span className="text-[11px] text-slate-500">
          {esPrevio
            ? 'Se capturan los mismos datos; el previo no suma en montos, línea de crédito ni avisos.'
            : 'Póliza emitida: suma en montos, línea de crédito y avisos de vencimiento.'}
        </span>
      </div>

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
            <label className="text-[11px] text-slate-500 mb-1 block">
              N° de póliza<Req />
              {esPrevio && <span className="text-slate-400 font-normal"> · o la referencia del previo</span>}
            </label>
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
          <Save className="w-4 h-4" /> {busy ? 'Guardando…' : esPrevio ? 'Guardar previo' : 'Guardar fianza'}
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
    razon_social: '', rfc: '', telefono: '', tipo: 'fiado', vendedor_id: '',
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
            <label className="text-[11px] text-slate-500 mb-1 block">Tipo de cuenta<Req /></label>
            <select value={f.tipo} onChange={set('tipo')} className={inputCls}>
              <option value="fiado">Fiado — compra fianzas</option>
              <option value="contratante">Contratante — se las exige a sus proveedores</option>
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              {f.tipo === 'contratante'
                ? 'No tendrá pólizas, líneas de crédito ni expediente. Al entrar verá el '
                  + 'padrón de sus proveedores y qué fianza presentó cada uno.'
                : 'Lo de siempre: obras, pólizas, líneas de crédito y expediente.'}
            </p>
          </div>
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Vendedor</label>
            <select value={f.vendedor_id} onChange={set('vendedor_id')} className={inputCls}>
              <option value="">Sin asignar</option>
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
            {f.tipo === 'contratante'
              ? 'Después, desde su detalle, le armas el padrón de proveedores. Ahí mismo '
                + 'puedes dar de alta a un proveedor que todavía no sea cliente.'
              : 'Después puedes agregarle más personas desde el detalle del cliente. Las líneas '
                + 'de crédito se asignan por afianzadora, también desde ahí.'}
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
