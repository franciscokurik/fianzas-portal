import { useEffect, useState } from 'react';
import { Routes, Route, Navigate, Link, useNavigate, useParams } from 'react-router-dom';
import {
  Building2, Plus, Save, Download,
  Users, FileText, Files, CheckCircle2, UserPlus, AlertTriangle,
  CreditCard, Trash2, Briefcase, Pencil, X, ListChecks, Check,
  Paperclip, Upload, FileDown, Mail, KeyRound, UserCog, ShieldCheck,
  Settings, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, Search,
} from 'lucide-react';
import { api, getToken, subirACloudinary } from '../api.js';
import { useAuth } from '../auth.jsx';
import AppShell from '../components/admin/AppShell.jsx';
import Comisiones from './Comisiones.jsx';
import {
  mxn, mxnCents, fmtDate, yaVencio, EstadoBadge, ClaseBadge, InputPesos,
  CumplimientoBadge, TipoClienteBadge, ESTATUS_PROYECTO, etiquetaEstatus,
  ACCEPT_ARCHIVOS, AYUDA_ARCHIVOS, pesoArchivo, revisarArchivo,
  pendientesDelFiado, pendientesDelContratante, estadoDocCliente,
} from '../lib.jsx';

// Los controles del sistema de FortexLink: campo de 32px y botón de 31px, a
// 6px de radio; el foco es un borde más oscuro con un halo casi invisible, no
// un anillo de color.
const inputCls =
  'w-full h-8 px-2.5 text-[13px] border border-slate-200 rounded-md bg-white text-slate-800 focus:outline-none focus:border-[#b9b9c2] focus:shadow-[0_0_0_4px_var(--ring)] transition-colors';
const btnPrimary =
  'inline-flex items-center gap-1.5 h-[31px] px-3 bg-indigo-600 text-white rounded-md text-[12.5px] font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50';
const btnSecondary =
  'inline-flex items-center gap-1.5 h-[28px] px-2.5 border border-slate-200 bg-white text-slate-600 rounded-md text-[12.5px] font-medium hover:bg-[#f7f7f8] hover:border-slate-300 transition-colors disabled:opacity-50';

// Los grupos en que se pintan los pendientes, en este orden. El tono de cada
// pendiente (lib.jsx) dice a qué grupo va. Se pinta UNA etiqueta por grupo y el
// texto de cada pendiente en gris: antes cada chip llevaba su propio color y con
// seis encendidos la pantalla parecía un semáforo descompuesto.
const GRUPOS_PENDIENTE = [
  { tono: 'rose',   label: 'Atender ya',    corto: 'urgente(s)',     punto: 'bg-red-500',    texto: 'text-red-700' },
  { tono: 'amber',  label: 'Pronto',        corto: 'para pronto',    punto: 'bg-amber-500',  texto: 'text-amber-700' },
  { tono: 'slate',  label: 'Por completar', corto: 'por completar',  punto: 'bg-slate-400',  texto: 'text-slate-500' },
  { tono: 'violet', label: 'En trámite',    corto: 'en trámite',     punto: 'bg-blue-400',   texto: 'text-slate-500' },
];

// La marca de cada renglón de la lista de clientes, por tono.
const TONO_ALERTA = {
  rose:  'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
};

// Lo que cada renglón de la lista de clientes tiene que decir, de más a menos
// grave. Solo lo que pide moverse: vencido, por vencer, recordatorios y
// papelería. El expediente incompleto NO entra aquí a propósito: le falta algún
// papel a casi todos los fiados, así que prendía la marca en todos los
// renglones y la marca dejó de significar algo. Se sigue viendo dentro del
// cliente, en "Pronto".
//
// Es la misma regla para la marca, para "Para atender" y para el aviso del
// buscador: escrita una vez, no pueden discrepar.
function alertasDelCliente(c) {
  const a = [];
  if (c.tipo === 'contratante') {
    if (c.obras_descubiertas > 0) {
      a.push({ tono: 'rose', corto: `${c.obras_descubiertas} sin fianza`,
               texto: `${c.obras_descubiertas} contrato(s) sin fianza completa` });
    }
    return a;
  }
  if (c.fianzas_vencidas > 0) {
    a.push({ tono: 'rose', corto: `${c.fianzas_vencidas} vencida(s)`,
             texto: `${c.fianzas_vencidas} póliza(s) vencida(s)` });
  }
  if (c.recordatorios_pendientes > 0) {
    a.push({ tono: 'amber', corto: `${c.recordatorios_pendientes} recordatorio(s)`,
             texto: `${c.recordatorios_pendientes} recordatorio(s) para esta semana` });
  }
  if (c.fianzas_por_vencer > 0) {
    a.push({ tono: 'amber', corto: `${c.fianzas_por_vencer} por vencer`,
             texto: `${c.fianzas_por_vencer} póliza(s) vencen en 30 días o menos` });
  }
  if (c.papeleria_pendiente > 0) {
    a.push({ tono: 'amber', corto: 'papelería',
             texto: `${c.papeleria_pendiente} solicitud(es) de papelería pendiente(s)` });
  }
  return a;
}

// "VENCIDO 30D" se leía como una póliza vencida hace un mes, y lo que estaba
// atrasado era el RECORDATORIO. "EN 0D" quería decir hoy.
function cuandoRecordatorio(dias) {
  if (dias < 0) return { texto: `Atrasado ${Math.abs(dias)} día(s)`, cls: 'bg-rose-50 text-rose-700' };
  if (dias === 0) return { texto: 'Hoy', cls: 'bg-amber-50 text-amber-800' };
  return { texto: `En ${dias} día(s)`, cls: 'bg-slate-100 text-slate-600' };
}

export default function Admin() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  // Los tres niveles usan el mismo panel; lo que cambia es qué se muestra.
  // Ocultar es solo para que no estorbe: quien decide de verdad es el servidor
  // en cada ruta.
  //   vendedor -> solo su cartera y sus comisiones, sin nada de la casa.
  //   operador -> todo salvo las cuentas de acceso, la baja de empresas y las
  //               comisiones.
  //   admin    -> todo.
  const esAdmin = user?.role === 'admin';
  const esVendedor = user?.role === 'vendedor';
  const puedeOperar = !esVendedor;
  const veComisiones = esAdmin || esVendedor;

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
    // Al vendedor no se le piden, y no por lo mismo cada una: /usuarios/internos
    // sí le contesta 403 (es soloOperador), pero /documentos-requeridos le
    // contestaría 200 —es un catálogo de la casa, no dato de nadie— y aun así no
    // le sirve de nada. Se salta la petición, no el permiso.
    //
    // 'internos' se carga para todo puedeOperar aunque la tarjeta de Personal
    // sea solo del admin: el operador la necesita para el selector de vendedor
    // del alta de cliente, y el admin para el filtro de vendedor de comisiones.
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

  // Cada cliente tiene su dirección (/admin/clientes/7): se puede volver con el
  // botón de atrás del navegador y mandar la liga a alguien.
  const irACliente = (id) => navigate(`/admin/clientes/${id}`);

  // ¿Este cliente tiene algo que atender? La misma regla que pinta la marca del
  // renglón (alertasDelCliente), para que el filtro y la marca no discrepen.
  const tienePendiente = (c) => alertasDelCliente(c).length > 0;
  // El número de la campana: recordatorios más clientes con alguna marca. Es
  // lo mismo que enlista "Para atender", no otra cuenta.
  const totalBandeja = recordatorios.length + clientes.filter(tienePendiente).length;

  // Atender un recordatorio mueve también la marca del cliente en la lista.
  // Antes no se recargaba la lista y el renglón seguía diciendo "2
  // recordatorio(s)" con los dos ya atendidos.
  const recordatorioAtendido = () => {
    cargarRecordatorios(); recargarDetalle(); cargarClientes();
    flash('Recordatorio marcado como atendido');
  };

  return (
    <AppShell user={user} onSalir={logout} pendientes={totalBandeja} clientes={clientes}>
      {avisoOp && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{avisoOp}</span>
          <button onClick={() => setAvisoOp('')} className="text-amber-500 hover:text-amber-800 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Flotando y no arriba del contenido: como banner empujaba toda la
          pantalla hacia abajo tres segundos y luego la regresaba, justo
          cuando uno iba a darle clic a algo. */}
      {/* Píldora oscura, centrada abajo: el aviso de "se guardó" de todo
          FortexLink. Un mensaje corto en pasado. */}
      {msg && (
        <div
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-[#101012] text-white px-4 py-2 text-[12.5px] font-medium flex items-center gap-2"
          style={{ boxShadow: 'var(--shadow-md)' }}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-green-400" /> {msg}
        </div>
      )}

      {errorCarga && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium">No se pudo cargar la información.</p>
            <p className="text-xs mt-0.5 text-rose-700">{errorCarga}</p>
            <p className="text-xs mt-1 text-rose-700">
              Las listas pueden verse vacías aunque los datos existan.
              Si es la primera vez tras un despliegue, falta correr <code>/api/setup</code>.
            </p>
          </div>
          <button onClick={() => setErrorCarga('')} className="text-rose-400 hover:text-rose-700 shrink-0">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <Routes>
        <Route
          index
          element={(
            <div className="space-y-3">
              <EncabezadoPagina
                titulo="Para atender"
                sub={esVendedor
                  ? 'Lo que hay que mover hoy en tu cartera'
                  : 'Lo que hay que mover hoy en toda la cartera'}
              />
              {clientes.length ? (
                <ParaAtender
                  recordatorios={recordatorios}
                  clientes={clientes}
                  onAbrirCliente={irACliente}
                  onAtendido={recordatorioAtendido}
                />
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 py-16 text-center text-sm text-slate-400">
                  {esVendedor
                    ? 'Aún no tienes clientes asignados. Te los asigna un operador.'
                    : 'Todavía no hay clientes. Da de alta el primero desde Clientes.'}
                </div>
              )}
            </div>
          )}
        />

        <Route
          path="clientes"
          element={(
            <ListaClientes
              clientes={clientes}
              esVendedor={esVendedor}
              puedeOperar={puedeOperar}
              vendedores={vendedores}
              onNuevo={() => navigate('/admin/clientes/nuevo')}
            />
          )}
        />

        {/* El alta tiene su propia dirección en vez de abrirse encima de la
            lista: al guardar se va directo a la ficha del cliente recién
            creado, y "atrás" regresa a la lista sin dejar nada a medias. */}
        <Route
          path="clientes/nuevo"
          element={puedeOperar ? (
            <div className="space-y-3">
              <VolverA to="/admin/clientes" label="Clientes" />
              <NuevoCliente
                vendedores={vendedores}
                onCancel={() => navigate('/admin/clientes')}
                onDone={(id) => {
                  cargarClientes();
                  flash('Cliente creado');
                  navigate(id ? `/admin/clientes/${id}` : '/admin/clientes');
                }}
              />
            </div>
          ) : <Navigate to="/admin/clientes" replace />}
        />

        <Route
          path="clientes/:id"
          element={(
            <PaginaCliente detalle={detalle} abrir={abrirDetalle}>
              {detalle && (
                <DetalleCliente
                  // Remonta el detalle al cambiar de cliente. Sin esto, el
                  // formulario "Agregar proveedor" del padrón se queda abierto y
                  // con lo tecleado: se empieza a capturar un proveedor para
                  // Delta, se cambia a otro contratante, y al guardar el alta
                  // se va al padrón equivocado.
                  key={detalle.cliente.id}
                  detalle={detalle}
                  esAdmin={esAdmin}
                  puedeOperar={puedeOperar}
                  vendedores={vendedores}
                  clientes={clientes}
                  tiposDocContratante={tiposDocContratante}
                  recordatorios={recordatorios.filter((r) => r.client_id === detalle.cliente.id)}
                  onRecordatorioAtendido={recordatorioAtendido}
                  avisar={avisar}
                  onEliminado={() => {
                    setSel(null);
                    setDetalle(null);
                    cargarClientes();
                    cargarRecordatorios();
                    cargarInternos(); // cambian los conteos de cartera
                    navigate('/admin/clientes');
                  }}
                  afianzadoras={afianzadoras}
                  tipos={tipos}
                  tiposDoc={tiposDoc}
                  onChange={refrescarTodo}
                  flash={flash}
                />
              )}
            </PaginaCliente>
          )}
        />

        <Route
          path="comisiones"
          element={veComisiones ? (
            <Comisiones
              esAdmin={esAdmin}
              vendedores={vendedores}
              afianzadoras={afianzadoras}
              flash={flash}
            />
          ) : <Navigate to="/admin" replace />}
        />

        {/* Los catálogos y el personal tienen su propia sección. Antes vivían
            plegados debajo de la lista de clientes para tenerlos a mano junto
            al expediente; con el menú lateral están a un clic desde cualquier
            lado y dejan de empujar la lista. */}
        <Route
          path="configuracion"
          element={puedeOperar ? (
            <div className="space-y-3">
              <EncabezadoPagina titulo="Configuración" sub="Catálogos de la casa y cuentas de Fortex" />
              <Configuracion
                siempreAbierta
                tipos={tipos}
                docsRequeridos={docsRequeridos}
                internos={internos}
                esAdmin={esAdmin}
                onAfianzadora={() => { cargarAfianzadoras(); flash('Afianzadora agregada'); }}
                onTipos={cargarTipos}
                // Cambiar el catálogo mueve la lista de pendientes de TODOS los
                // fiados, así que también se refresca la lista de clientes.
                onDocumentos={() => { cargarDocsRequeridos(); recargarDetalle(); cargarClientes(); }}
                onInternos={() => { cargarInternos(); cargarClientes(); recargarDetalle(); }}
                flash={flash}
              />
            </div>
          ) : <Navigate to="/admin" replace />}
        />

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AppShell>
  );
}

/* --------------------------------------------------------------------------
   Piezas de página
   -------------------------------------------------------------------------- */

// El encabezado de cada sección: título a la izquierda, acciones a la derecha.
function EncabezadoPagina({ titulo, sub, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold text-slate-800 leading-tight">{titulo}</h2>
        {sub && <p className="text-slate-400 text-xs mt-0.5">{sub}</p>}
      </div>
      {children && <div className="flex items-center gap-1.5 shrink-0">{children}</div>}
    </div>
  );
}

function VolverA({ to, label }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors"
    >
      <ArrowLeft className="h-3.5 w-3.5" /> {label}
    </Link>
  );
}

// La ficha de un cliente, por su dirección. Pide el detalle cada vez que cambia
// el id y no pinta el de otro mientras llega: con la ficha anterior a la vista
// unos segundos, un clic podía caer en el cliente equivocado.
function PaginaCliente({ detalle, abrir, children }) {
  const { id } = useParams();
  const numero = Number(id);
  useEffect(() => { abrir(numero); }, [numero]);

  return (
    <div className="space-y-4">
      <VolverA to="/admin/clientes" label="Clientes" />
      {detalle?.cliente.id === numero
        ? children
        : <p className="py-16 text-center text-sm text-slate-400">Cargando…</p>}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Lista de clientes
   --------------------------------------------------------------------------
   Un listado de verdad, a lo ancho, en vez de la columna angosta de antes: con
   el menú lateral la ficha del cliente tiene su propia página, y aquí cabe una
   columna por dato. Las columnas se escriben una vez y las comparten el
   encabezado y los renglones, para que nunca se desalineen. */

const FILTROS_CLIENTES = [
  { key: 'todos', label: 'Todos' },
  { key: 'pendientes', label: 'Con pendientes' },
  { key: 'fiado', label: 'Fiados' },
  { key: 'contratante', label: 'Contratantes' },
];

const COLS_CLIENTES =
  'grid grid-cols-[minmax(0,1fr)_minmax(0,10rem)_minmax(0,13rem)_minmax(0,9rem)_1rem] gap-x-4 items-center';

function ListaClientes({ clientes, esVendedor, puedeOperar, vendedores, onNuevo }) {
  const [filtro, setFiltro] = useState('todos');
  const [busca, setBusca] = useState('');
  const [vendedor, setVendedor] = useState('todos');

  const conPendiente = (c) => alertasDelCliente(c).length > 0;
  const pasaFiltro = (c, f = filtro) =>
    f === 'todos' || (f === 'pendientes' ? conPendiente(c) : c.tipo === f);
  const termino = busca.trim().toLowerCase();
  const pasaBusqueda = (c) =>
    !termino || `${c.razon_social} ${c.rfc || ''}`.toLowerCase().includes(termino);
  const pasaVendedor = (c) => vendedor === 'todos'
    || (vendedor === 'sin' ? !c.vendedor_id : String(c.vendedor_id) === vendedor);

  const visibles = clientes.filter((c) => pasaFiltro(c) && pasaBusqueda(c) && pasaVendedor(c));
  // Cuántos con pendiente están tapando los filtros. Se dice: un filtro que
  // esconde un pendiente sin avisar es lo mismo que no tenerlo.
  const ocultosConPendiente = clientes.filter((c) => conPendiente(c) && !visibles.includes(c)).length;
  const hayFiltros = filtro !== 'todos' || termino || vendedor !== 'todos';
  const limpiar = () => { setFiltro('todos'); setBusca(''); setVendedor('todos'); };

  return (
    <div className="space-y-3">
      <EncabezadoPagina
        titulo={esVendedor ? 'Mis clientes' : 'Clientes'}
        sub={`${clientes.length} cliente(s) · ${clientes.filter(conPendiente).length} con pendientes`}
      >
        {puedeOperar && (
          <button
            onClick={onNuevo}
            className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Nuevo cliente
          </button>
        )}
      </EncabezadoPagina>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTROS_CLIENTES.map((t) => (
          <button
            key={t.key}
            onClick={() => setFiltro(t.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              filtro === t.key
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
            <span className={`text-[10px] rounded-full px-1 py-px font-semibold leading-none tabular-nums ${
              filtro === t.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {clientes.filter((c) => pasaFiltro(c, t.key)).length}
            </span>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="relative flex-[2] min-w-0">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por razón social o RFC…"
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
          />
        </div>
        {/* El vendedor solo ve su cartera: filtrar por vendedor no le dice nada. */}
        {puedeOperar && (
          <select
            value={vendedor}
            onChange={(e) => setVendedor(e.target.value)}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-slate-700"
          >
            <option value="todos">Todos los vendedores</option>
            {vendedores.map((v) => <option key={v.id} value={String(v.id)}>{v.nombre}</option>)}
            <option value="sin">Sin vendedor</option>
          </select>
        )}
        {hayFiltros && (
          <button
            onClick={limpiar}
            className="px-2.5 py-1.5 text-xs text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap"
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {hayFiltros && ocultosConPendiente > 0 && (
        <p className="text-xs text-amber-700">
          {ocultosConPendiente} cliente(s) con pendientes quedan fuera de estos filtros.{' '}
          <button onClick={limpiar} className="underline hover:no-underline">Ver todos</button>
        </p>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className={`${COLS_CLIENTES} px-5 py-2.5 bg-slate-50 border-b border-slate-200`}>
              {['Cliente', 'Cartera', 'Pendiente', 'Vendedor', ''].map((t, i) => (
                <div key={i} className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.06em]">{t}</div>
              ))}
            </div>

            {!visibles.length ? (
              <div className="py-16 text-center text-slate-400 text-sm">
                {clientes.length ? 'No hay clientes con los filtros seleccionados.' : 'Todavía no hay clientes.'}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {visibles.map((c) => {
                  const alertas = alertasDelCliente(c);
                  const principal = alertas[0];
                  return (
                    <Link
                      key={c.id}
                      to={`/admin/clientes/${c.id}`}
                      className={`${COLS_CLIENTES} px-5 py-3 hover:bg-slate-50 transition-colors group`}
                    >
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 min-w-0">
                          <span className="text-sm font-semibold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">
                            {c.razon_social}
                          </span>
                          <TipoClienteBadge tipo={c.tipo} />
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5 truncate">
                          {c.rfc ? <span className="font-mono">{c.rfc}</span> : 'Sin RFC'}
                        </p>
                      </div>
                      <div className="text-xs text-slate-600 tabular-nums">
                        {c.tipo === 'contratante'
                          ? `${c.total_proveedores} proveedor(es)`
                          : `${c.total_proyectos} obra(s) · ${c.total_fianzas} fianza(s)`}
                      </div>
                      <div className="min-w-0">
                        {/* Lo más grave, en palabras; el resto en el title. */}
                        {principal ? (
                          <span
                            className={`estado-pill ${TONO_ALERTA[principal.tono]}`}
                            title={alertas.map((a) => a.texto).join('\n')}
                          >
                            {principal.corto}{alertas.length > 1 && ` +${alertas.length - 1}`}
                          </span>
                        ) : <span className="text-xs text-slate-300">—</span>}
                      </div>
                      <div className={`text-xs truncate ${c.vendedor_nombre ? 'text-slate-600' : 'text-slate-400'}`}>
                        {c.vendedor_nombre || 'Sin vendedor'}
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500 transition-colors" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Recordatorios internos (solo Fortex; el cliente no los ve)
   --------------------------------------------------------------------------
   Un renglón por recordatorio, y la NOTA primero: es lo que hay que hacer
   ("solicitar liberación a Berkley"). La póliza, la obra y la afianzadora van
   después, en gris, como referencia. Antes era al revés y la tarea quedaba al
   final del renglón, después de cuatro datos que no se leían. */

function RenglonRecordatorio({ r, conCliente, onAbrirCliente, onAtendido }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cuando = cuandoRecordatorio(r.dias_restantes);

  async function atender() {
    setError('');
    setBusy(true);
    try {
      await api.put(`/admin/fianzas/${r.id}/recordatorio`, { atendido: true });
      onAtendido();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3 px-4 py-2.5">
      <span className={`shrink-0 w-[6.5rem] text-center text-[10px] font-medium px-1.5 py-0.5 rounded tabular-nums ${cuando.cls}`}>
        {cuando.texto}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-800">
          {r.nota_recordatorio || 'Dar seguimiento a esta póliza'}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-1.5">
          {conCliente && (
            <>
              <button
                onClick={() => onAbrirCliente(r.client_id)}
                className="text-slate-600 font-medium hover:underline"
              >
                {r.razon_social}
              </button>
              <span>·</span>
            </>
          )}
          <ClaseBadge clase={r.clase} />
          <span className="font-mono">{r.numero_poliza}</span>
          {r.proyecto_nombre && <span>· {r.proyecto_nombre}</span>}
          <span>· {r.afianzadora_nombre}</span>
        </p>
        {error && <p className="text-[11px] text-rose-600 mt-0.5">{error}</p>}
      </div>
      <button onClick={atender} disabled={busy} className={`${btnSecondary} shrink-0`}>
        <Check className="h-3.5 w-3.5" /> {busy ? 'Guardando…' : 'Atendido'}
      </button>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Para atender: el panel sin cliente abierto
   --------------------------------------------------------------------------
   Lo que hay que mover hoy en toda la cartera, en dos listas: los recordatorios
   de la casa y los clientes con alguna marca, de lo más grave a lo menos. La
   lista de la izquierda va por nombre; esta va por urgencia. Antes este panel
   decía "Selecciona un cliente" y los recordatorios vivían en una franja fija
   arriba de todo. */

const PESO_TONO = { rose: 0, amber: 1 };

function ParaAtender({ recordatorios, clientes, onAbrirCliente, onAtendido }) {
  const conAlertas = clientes
    .map((c) => ({ c, alertas: alertasDelCliente(c) }))
    .filter((x) => x.alertas.length)
    .sort((x, y) => (PESO_TONO[x.alertas[0].tono] - PESO_TONO[y.alertas[0].tono])
      || x.c.razon_social.localeCompare(y.c.razon_social, 'es'));

  const encabezado = (titulo, nota) => (
    <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-baseline gap-2">
      <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">{titulo}</p>
      {nota && <p className="text-[11px] text-slate-400">{nota}</p>}
    </div>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {!recordatorios.length && !conAlertas.length ? (
        <p className="px-4 py-10 text-center text-sm text-slate-400">
          Nada pendiente en la cartera por ahora. Abre un cliente de la lista para ver su información.
        </p>
      ) : (
        <div className="divide-y divide-slate-200">
          {recordatorios.length > 0 && (
            <div>
              {encabezado(`Recordatorios (${recordatorios.length})`, 'uso interno, el cliente no los ve')}
              <div className="divide-y divide-slate-100">
                {recordatorios.map((r) => (
                  <RenglonRecordatorio
                    key={r.id}
                    r={r}
                    conCliente
                    onAbrirCliente={onAbrirCliente}
                    onAtendido={onAtendido}
                  />
                ))}
              </div>
            </div>
          )}

          {conAlertas.length > 0 && (
            <div>
              {encabezado(`Clientes con pendientes (${conAlertas.length})`)}
              <div className="divide-y divide-slate-100">
                {conAlertas.map(({ c, alertas }) => (
                  <button
                    key={c.id}
                    onClick={() => onAbrirCliente(c.id)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors group"
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      alertas[0].tono === 'rose' ? 'bg-rose-500' : 'bg-amber-500'
                    }`} />
                    <span className="w-64 shrink-0 min-w-0 flex items-center gap-1.5">
                      <span className="text-xs font-medium text-slate-800 truncate">{c.razon_social}</span>
                      <TipoClienteBadge tipo={c.tipo} />
                    </span>
                    <span className="flex-1 min-w-0 text-xs text-slate-600 truncate">
                      {alertas.map((a) => a.texto).join(' · ')}
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-slate-600 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Catálogo de tipos de fianza (editable por el admin)
   -------------------------------------------------------------------------- */

// 'embebido' = va dentro de la tarjeta de Configuración, que ya tiene su propio
// encabezado y su propia pestaña. Sin esto, agruparlos daba dos encabezados
// encimados y un acordeón dentro de otro.
function CatalogoTipos({ tipos, onChange, flash, embebido }) {
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
    <div className={embebido ? '' : 'bg-white border border-slate-200 rounded-xl overflow-hidden'}>
      {!embebido && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <ListChecks className="w-4 h-4 text-indigo-600" /> Tipos de fianza ({tipos.length})
          <Plus className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${open ? 'rotate-45' : ''}`} />
        </button>
      )}
      {(open || embebido) && (
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

function CatalogoDocumentos({ tipos, onChange, flash, embebido }) {
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
    <div className={embebido ? '' : 'bg-white border border-slate-200 rounded-xl overflow-hidden'}>
      {!embebido && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <FileText className="w-4 h-4 text-indigo-600" /> Documentos requeridos ({tipos.length})
          <Plus className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${open ? 'rotate-45' : ''}`} />
        </button>
      )}
      {(open || embebido) && (
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
  recordatorios = [], onRecordatorioAtendido,
  afianzadoras, tipos, tiposDoc, onChange, onEliminado, flash, avisar,
}) {
  const {
    cliente, usuarios = [], lineas = [], proyectos = [],
    fianzas = [], documentos, papeleria,
    // Solo vienen cuando es un contratante (la API contesta con la forma que le
    // toca a cada tipo, no con listas vacías; ver routes/admin.js).
    proveedores = [], suspendidos = [], obras = [], metricas,
    // Los contratos que EXISTEN y esta pantalla no muestra, porque su proveedor
    // quedó suspendido en el padrón. Solo para Fortex (ver routes/admin.js).
    obras_invisibles: obrasInvisibles = [],
    lineas_proveedores: lineasProveedores = [],
    // Y solo cuando es un fiado: a qué contratantes les surte.
    contratantes = [],
  } = detalle;
  const esContratante = cliente.tipo === 'contratante';

  // La pestaña abierta. Arranca en la que es el trabajo del día —obras o
  // contratos—; y al cambiar de cliente vuelve sola al principio, gratis,
  // porque el panel remonta este componente con key={detalle.cliente.id}.
  const [vista, setVista] = useState(esContratante ? 'contratos' : 'obras');

  // Los pendientes, de una sola fuente. Los mismos números alimentan la barra
  // de chips y los contadores de las pestañas.
  const pendientes = esContratante
    ? pendientesDelContratante({ metricas, suspendidos, lineas_proveedores: lineasProveedores })
    : pendientesDelFiado({ fianzas, documentos, papeleria, proyectos, lineas, usuarios });

  // El contador de "Papeles" cuenta lo que de verdad falta, no solo lo que no
  // se ha subido: un documento VENCIDO se pintaba en rojo en su renglón y el
  // encabezado decía "completo".
  const papelesPendientes =
    documentos.filter((d) => ['pendiente', 'vencido'].includes(estadoDocCliente(d))).length
    + papeleria.filter((p) => p.estado === 'pendiente').length;
  const usuariosActivos = usuarios.filter((u) => u.activo).length;

  // Un pendiente lleva a la pestaña de la que habla. Los del contratante dicen
  // "proyectos" y "padrón" (lib.jsx): aquí se traducen a sus pestañas.
  const irA = (destino) => {
    const pestana = { proyectos: 'contratos', padron: 'proveedores' }[destino] || destino;
    if (['obras', 'credito', 'papeles', 'accesos', 'contratos', 'proveedores'].includes(pestana)) {
      setVista(pestana);
    }
  };
  // Los contratantes que se le pueden ligar a una obra. Sale de la lista que ya
  // está cargada: no hace falta otra ruta.
  const contratantesDisponibles = clientes.filter((c) => c.tipo === 'contratante');
  const [errorBaja, setErrorBaja] = useState('');
  const lineaTotal = lineas.reduce((s, l) => s + (l.linea_credito || 0), 0);
  const disponibleTotal = lineas.reduce((s, l) => s + (l.disponible || 0), 0);
  // Los previos quedan fuera de todas las cifras de dinero: son lo que se
  // cotizó, no lo que la afianzadora emitió. Cuántos van en trámite lo dicen
  // los pendientes ("En trámite").
  const emitidas = fianzas.filter((f) => f.clase !== 'previo');
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

  // Las pestañas, con un número que se pinta en ámbar si adentro hay algo que
  // falta: tabular no puede esconder un pendiente.
  const descubiertas = proyectos.filter((p) => ['sin_fianza', 'vencida', 'sin_fecha'].includes(estadoDeObra(p))).length;
  const agotadas = lineas.filter((l) => l.linea_credito > 0 && l.disponible <= 0).length;
  const pestanas = esContratante
    ? [
        { key: 'contratos', label: 'Contratos', icono: Briefcase,
          cuenta: metricas?.obras_vivas ?? null, alerta: (metricas?.obras_descubiertas ?? 0) > 0 },
        { key: 'proveedores', label: 'Proveedores', icono: ShieldCheck,
          cuenta: proveedores.length,
          alerta: pendientes.some((p) => p.destino === 'padron' && p.tono !== 'violet') },
        { key: 'accesos', label: 'Accesos', icono: Users, cuenta: usuariosActivos },
      ]
    : [
        { key: 'obras', label: 'Obras', icono: Briefcase, cuenta: proyectos.length, alerta: descubiertas > 0 },
        { key: 'credito', label: 'Crédito', icono: CreditCard, cuenta: lineas.length, alerta: agotadas > 0 },
        { key: 'papeles', label: 'Papeles', icono: FileText, cuenta: papelesPendientes || null, alerta: papelesPendientes > 0 },
        { key: 'accesos', label: 'Accesos', icono: Users, cuenta: usuariosActivos },
      ];

  return (
    <>
      {/* La ficha se lee en capas: quién es, cuatro cifras y lo urgente.
          Todo lo demás —obras, crédito, papeles, accesos— va en pestañas, y
          los pendientes que no urgen se cuentan en una línea que se abre. */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-xl font-semibold text-slate-800 leading-tight">{cliente.razon_social}</h2>
              <TipoClienteBadge tipo={cliente.tipo} />
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {cliente.rfc ? <span className="font-mono">{cliente.rfc}</span> : 'Sin RFC'}
              {cliente.telefono && ` · ${cliente.telefono}`}
              {esContratante && ' · exige fianza a sus proveedores'}
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              <span className="text-xs text-slate-400">En tu cartera</span>
            )}
            {/* Dar de baja se lleva el historial y no tiene deshacer: queda solo
                para el administrador, y como icono discreto, no como botón
                al lado de lo que se usa a diario. */}
            {esAdmin && (
              <button
                onClick={eliminar}
                className="p-2 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                title="Dar de baja al cliente con todo su historial"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {errorBaja && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {errorBaja}
          </div>
        )}

        {/* Los hechos. Cuatro y no seis: la prima neta va en la ayuda de la
            total, y los previos en "En trámite" de los pendientes. */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">
          {esContratante ? (
            <>
              <Dato label="Proveedores" valor={String(metricas?.proveedores ?? 0)}
                    ayuda="Empresas en su padrón: a quién le exige fianza" />
              <Dato label="Contratos activos" valor={String(metricas?.obras_vivas ?? 0)}
                    ayuda="Contratos de sus proveedores ligados a él que todavía se juzgan (en proceso, terminados o entregados). Los cerrados y cancelados se listan pero no cuentan." />
              <Dato label="Cobertura a su favor" valor={mxn(metricas?.monto_afianzado)}
                    ayuda="Suma de lo que cubren hoy las fianzas de sus proveedores" />
            </>
          ) : (
            <>
              <Dato label="Línea total" valor={mxn(lineaTotal)} />
              {/* En rojo solo si hay línea y ya no queda nada: en cero no le
                  cabe otra fianza. Sin línea capturada, cero no es una alarma. */}
              <Dato label="Disponible" valor={mxn(disponibleTotal)}
                    alerta={lineaTotal > 0 && disponibleTotal <= 0} />
              <Dato label="Afianzado vigente" valor={mxn(afianzadoTotal)}
                    ayuda="Suma de lo que cubren las fianzas vigentes. No incluye previos: todavía no se emiten." />
              <Dato label="Prima total" valor={mxn(sumaPrimaTotal)}
                    ayuda={`Lo que el fiado paga: prima neta (${mxn(sumaPrimaNeta)}) + derecho de póliza + IVA. Sin previos.`} />
            </>
          )}
        </div>

        {/* A qué desarrolladores le surte este fiado, y por lo tanto quién le
            está viendo las fianzas de qué obras. Conviene saberlo ANTES de
            ligarle otra obra; va en una línea gris, no en chips de color. */}
        {!esContratante && contratantes.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            Le surte a{' '}
            {contratantes.map((ct, i) => (
              <span
                key={ct.id}
                title={ct.activo === 1
                  ? `Ve las fianzas de ${ct.obras_ligadas} obra(s) de este fiado`
                  : `Suspendió a este fiado de su padrón: hoy NO ve nada, aunque `
                    + `${ct.obras_ligadas} obra(s) sigan ligadas`}
              >
                {i > 0 && ', '}
                <span className="text-slate-700">{ct.razon_social}</span>
                {' '}({ct.obras_ligadas} obra{ct.obras_ligadas === 1 ? '' : 's'}
                {ct.activo === 1 ? '' : ', lo suspendió'})
              </span>
            ))}
          </p>
        )}

        {/* FUERA de las pestañas a propósito: es lo que hace honesto tabular. */}
        <Pendientes
          pendientes={pendientes}
          recordatorios={recordatorios}
          onIr={irA}
          onRecordatorioAtendido={onRecordatorioAtendido}
        />
      </div>

      <TiraPestanas pestanas={pestanas} activa={vista} onCambiar={setVista} />

      {/* EL CONTRATANTE. Cada contrato sale una sola vez, en su partida y con
          su estado al lado; los proveedores hablan de las EMPRESAS (quiénes
          son, cómo andan, cuánto crédito les queda), no de sus obras otra
          vez. Van en pestañas como el fiado: juntas eran tres tablas largas
          una debajo de otra. */}
      {esContratante && vista === 'contratos' && (
        <ProyectosDelContratante
          contratanteId={cliente.id}
          contratanteNombre={cliente.razon_social}
          proyectos={proyectos}
          obras={obras}
          proveedores={proveedores}
          suspendidos={suspendidos}
          clientes={clientes}
          obrasInvisibles={obrasInvisibles}
          tipos={tipos}
          tiposDoc={tiposDocContratante}
          descargar={descargarPorId}
          puedeLigarContratante={puedeOperar}
          onChange={onChange}
          flash={flash}
          avisar={avisar}
        />
      )}
      {esContratante && vista === 'proveedores' && (
        <PadronProveedores
          contratanteId={cliente.id}
          proveedores={proveedores}
          suspendidos={suspendidos}
          lineas={lineasProveedores}
          clientes={clientes}
          puedeOperar={puedeOperar}
          onChange={onChange}
          flash={flash}
        />
      )}

      {/* EL FIADO. El crédito tiene su pestaña: antes iba encima de las obras
          porque el formulario de fianza no decía cuánto quedaba con cada
          afianzadora, y ahora cada opción del selector lo dice. */}
      {!esContratante && vista === 'obras' && (
        <Proyectos
          clienteId={cliente.id}
          proyectos={proyectos}
          afianzadoras={afianzadoras}
          tipos={tipos}
          tiposDoc={tiposDoc}
          lineas={lineas}
          contratantes={contratantesDisponibles}
          puedeLigarContratante={puedeOperar}
          onChange={onChange}
          flash={flash}
          avisar={avisar}
        />
      )}
      {!esContratante && vista === 'credito' && (
        <LineasCredito
          clienteId={cliente.id}
          lineas={lineas}
          afianzadoras={afianzadoras}
          puedeEditar={puedeOperar}
          onChange={() => { onChange(); flash('Línea de crédito actualizada'); }}
        />
      )}
      {!esContratante && vista === 'papeles' && (
        <>
          <ExpedienteCliente
            clienteId={cliente.id}
            documentos={documentos}
            descargar={descargar}
            onChange={onChange}
            flash={flash}
          />
          <PapeleriaCliente
            clienteId={cliente.id}
            papeleria={papeleria}
            afianzadoras={afianzadoras}
            descargar={descargar}
            onChange={onChange}
            flash={flash}
          />
        </>
      )}

      {vista === 'accesos' && (
        <UsuariosCliente
          clienteId={cliente.id}
          usuarios={usuarios}
          esAdmin={esAdmin}
          onChange={onChange}
          flash={flash}
        />
      )}
    </>
  );
}

/* --------------------------------------------------------------------------
   Papelería específica
   --------------------------------------------------------------------------
   Sale a su propio componente para poder vivir en la pestaña "Papeles". */

function PapeleriaCliente({ clienteId, papeleria = [], afianzadoras, descargar, onChange, flash }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Files className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Papelería específica</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {papeleria.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm hover:bg-slate-50/40">
            <span className="flex-1 text-slate-700">
              {p.descripcion}
              {/* El número de póliza lo manda el servidor y el JSX lo tiraba.
                  Al separar Papeles de Obras se perdía para siempre a qué
                  póliza pertenece la solicitud; antes se reconstruía con
                  scroll, y con pestañas ya no habría cómo. */}
              {p.numero_poliza && (
                <span className="text-[11px] font-mono text-slate-500"> · {p.numero_poliza}</span>
              )}
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
      <NuevaPapeleria
        clienteId={clienteId}
        afianzadoras={afianzadoras}
        onDone={() => { onChange(); flash('Solicitud creada'); }}
      />
    </div>
  );
}

/* --------------------------------------------------------------------------
   Los PROYECTOS de un contratante, desde el panel
   --------------------------------------------------------------------------
   El desarrollador los registra desde su portal —es lo que pidió— y Fortex por
   la misma puerta, porque al dar de alta la cuenta hay que capturarlos antes de
   que él entre por primera vez, y sin proyecto no hay a qué ligarle las obras.

   Se pinta como UNA tabla: proyecto, partida y un renglón por contrato con su
   estado y lo que le falta. Es la respuesta a "¿quién de sus contratistas no
   está cubierto?" sin tener que cruzar con nada. El crédito de cada proveedor
   —que el contratante no ve— va en el padrón, que habla de empresas. */

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
  const [confirmar, setConfirmar] = useState('');
  const [confirmado, setConfirmado] = useState(false);
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
    // La confirmación era para el proveedor anterior. Dejarla viva sería un sí
    // heredado, que es lo mismo que no haber preguntado.
    setConfirmar('');
    setConfirmado(false);
    setF((s) => ({
      ...s,
      client_id: id,
      // "Muros y albañilería – Vega": la misma forma que ya tienen las obras
      // capturadas a mano, para que la lista no se vea de dos épocas.
      nombre: nombreTocado ? s.nombre : (id ? `${partida.nombre} – ${corto(nombreDelProveedor(id))}` : ''),
    }));
  }

  // Ligar la obra mete al proveedor al padrón del contratante si no estaba, y
  // eso le abre sus pólizas a otra empresa en ese instante. No se deshace. El
  // optgroup lo avisa, pero avisar no es preguntar: se pide un sí explícito.
  const vieneDeFuera = (id) => {
    const n = Number(id);
    return Boolean(n) && !enPadron.has(n) && !enSuspendidos.has(n);
  };

  // Un segundo contrato del MISMO proveedor en la MISMA partida es legítimo
  // —puede haber dos contratos— pero casi siempre es el doble clic de alguien
  // que no vio el primero. El servidor no tiene guarda y no debe tenerla; el
  // aviso va aquí.
  const yaTieneContrato = (id) =>
    (partida.contratos || []).some((o) => o.client_id === Number(id));

  async function guardar() {
    setError('');
    if (!f.client_id) return setError('Elige al contratista.');
    if (!f.nombre.trim()) return setError('El nombre del contrato es obligatorio.');

    if (vieneDeFuera(f.client_id) && !confirmado) {
      return setConfirmar(
        `${nombreDelProveedor(f.client_id)} no está en el padrón de ${contratanteNombre}. `
        + 'Al ligarla queda dentro, y el contratante va a ver las pólizas de esta obra. '
        + 'Eso no se deshace.'
      );
    }
    if (yaTieneContrato(f.client_id) && !confirmado) {
      return setConfirmar(
        `Ya hay un contrato de ${nombreDelProveedor(f.client_id)} en esta partida. `
        + 'Si es otro contrato distinto, adelante; si no, cancela y revisa el que ya está.'
      );
    }

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
        // El beneficiario NO se prellena, aunque sea tentador. Es el texto que
        // va impreso en la póliza y casi siempre es CFE, el IMSS o un municipio
        // —no el contratante del portal—; nadie lo verificó aquí, y si la obra
        // se mueve luego a la partida de otro contratante, quedaría nombrando
        // al anterior. Se captura en la obra, donde el formulario lo explica.
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

      {confirmar && (
        <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-800 flex flex-wrap items-start gap-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span className="flex-1 min-w-[12rem]">{confirmar}</span>
          <button
            onClick={() => { setConfirmado(true); setConfirmar(''); guardar(); }}
            className="underline hover:no-underline font-medium shrink-0"
          >
            Sí, ligar
          </button>
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
          Fechas, beneficiario, estatus y pólizas se capturan luego en la obra
          del proveedor.
        </span>
      </div>
    </div>
  );
}

// Las columnas de la tabla de contratos, escritas una sola vez: el encabezado y
// cada renglón las comparten, y así no se desalinean.
const COLS_CONTRATOS =
  'grid grid-cols-[minmax(0,13rem)_minmax(0,1fr)_7.5rem_7.5rem_2rem] gap-x-3';

// Un botón de puro icono para las acciones de una partida. Tenue a propósito:
// editar o borrar una partida es raro, y en cada renglón compite con el estado,
// que es lo que se viene a ver.
function BotonIcono({ title, onClick, peligro, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-0.5 rounded text-slate-300 transition-colors ${
        peligro ? 'hover:text-rose-600' : 'hover:text-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

// Lo que hay que hacer con un contrato, en palabras. El chip dice el estado y
// esta línea dice QUÉ falta, que es lo único accionable: "Sin fecha" a secas no
// le decía al operador que lo que falta es capturar un dato de Fortex, y "Sin
// registro" no decía que ya hay dos previos en trámite.
//
// Solo para contratos vivos: a uno cerrado no hay cobertura que exigirle.
function notaDelContrato(o) {
  if (!o.viva) return null;
  const falta = (o.faltantes || []).map((f) => f.tipo_fianza).join(' y ');
  const previos = o.total_previos > 0 ? `${o.total_previos} previo(s) en trámite` : null;
  const partes = {
    sin_vigencia: ['Falta capturar la vigencia de su póliza', 'text-amber-700'],
    vencida:      ['Su póliza ya venció', 'text-rose-600'],
    incompleta:   [`Le falta ${falta}`, 'text-rose-600 font-medium'],
    sin_fianza:   [falta ? `Le falta ${falta}` : null, 'text-rose-600 font-medium'],
  }[o.estado_cobertura] || [null, 'text-slate-500'];
  const texto = [partes[0], previos].filter(Boolean).join(' · ');
  return texto ? { texto, cls: partes[1] } : null;
}

// La celda de la partida: nombre, monto y qué exige. Va solo en el primer
// renglón de la partida; los demás contratos de la misma partida la dejan en
// blanco, como en cualquier tabla agrupada.
function CeldaPartida({ pa, conContratos, puedeLigar, onAsignar, onEditar, onBorrar }) {
  return (
    <div className="min-w-0">
      <div className="flex items-start gap-1">
        <p className="text-xs font-medium text-slate-700 leading-snug flex-1 min-w-0">{pa.nombre}</p>
        <div className="flex items-center shrink-0 -mt-0.5">
          {/* Con contratista ya puesto, el atajo queda aquí para un segundo
              contrato; sin él, va grande en la celda de al lado, que es donde
              se ve el hueco. Al vendedor no se le ofrece: el servidor le
              contestaría 403. */}
          {conContratos && puedeLigar && (
            <BotonIcono title="Asignar otro contratista a esta partida" onClick={onAsignar}>
              <UserPlus className="h-3.5 w-3.5" />
            </BotonIcono>
          )}
          <BotonIcono title="Editar partida" onClick={onEditar}>
            <Pencil className="h-3.5 w-3.5" />
          </BotonIcono>
          <BotonIcono title="Borrar partida" onClick={onBorrar} peligro>
            <Trash2 className="h-3.5 w-3.5" />
          </BotonIcono>
        </div>
      </div>
      {pa.monto_estimado > 0 && (
        <p className="text-[11px] text-slate-400 tabular-nums">{mxn(pa.monto_estimado)}</p>
      )}
      {/* Sin esto la partida solo puede decir "tiene fianza", nunca "le falta
          la de anticipo". La falta en sí va en el renglón del contratista, que
          es a quien se le pide. */}
      <p className="text-[11px] text-slate-500">
        {pa.requisitos.length
          ? <>exige {pa.requisitos.map((r) => r.tipo_fianza).join(', ')}</>
          : <span className="text-amber-700">no dice qué fianzas exige</span>}
      </p>
    </div>
  );
}

// Un contrato: quién lo hace, cómo está y qué le falta, con la carpeta del
// contratante detrás del clip. Es el único lugar de la pantalla donde aparece;
// antes salía también dentro del padrón y había que juntar las dos mitades.
function FilaContrato({
  obra: o, partida, nombreDe, contratanteId, tiposDoc, descargar, onChange, flash,
}) {
  const [abierta, setAbierta] = useState(false);
  const docs = o.mis_documentos || [];
  const polizas = o.fianzas.filter((f) => f.clase !== 'previo').length;
  const nota = notaDelContrato(o);
  const proveedor = nombreDe(o.client_id);

  return (
    <>
      {/* Uno cerrado o cancelado se sigue listando —el contrato existe— pero
          atenuado y con su estatus en vez de un veredicto: exigirle cobertura
          lo pintaría de rojo por algo que ya terminó. */}
      <div className={`${COLS_CONTRATOS} px-4 py-2 items-start hover:bg-slate-50/60 transition-colors ${
        o.viva ? '' : 'opacity-60'
      }`}>
        <div className="min-w-0">{partida}</div>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-800 truncate" title={proveedor}>{proveedor}</p>
          <p className="text-[11px] text-slate-400 truncate" title={o.nombre}>
            {o.nombre}
            {o.numero_contrato && <span className="font-mono"> · {o.numero_contrato}</span>}
          </p>
          {nota && <p className={`text-[11px] ${nota.cls}`}>{nota.texto}</p>}
        </div>
        <div>
          {o.viva
            ? <CumplimientoBadge estado={o.estado_cobertura} verificada={o.cobertura_verificada} />
            : (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 whitespace-nowrap">
                {etiquetaEstatus(o.estatus)}
              </span>
            )}
        </div>
        <div className="text-right tabular-nums">
          <p className="text-xs text-slate-700">{o.monto_afianzado > 0 ? mxn(o.monto_afianzado) : '—'}</p>
          <p className="text-[10px] text-slate-400">{polizas} póliza(s)</p>
        </div>
        <div className="flex justify-end">
          <button
            onClick={() => setAbierta((a) => !a)}
            className={`p-1 rounded transition-colors flex items-center gap-0.5 ${
              docs.length ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 hover:text-slate-600'
            }`}
            title="Documentos que el contratante recibió de este contrato"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {docs.length > 0 && <span className="text-[10px] tabular-nums">{docs.length}</span>}
          </button>
        </div>
      </div>

      {abierta && (
        <div className="px-4 pb-2">
          <CarpetaDelContratante
            contratanteId={contratanteId}
            obraId={o.id}
            documentos={docs}
            tipos={tiposDoc}
            descargar={descargar}
            onChange={onChange}
            flash={flash}
          />
        </div>
      )}
    </>
  );
}

// Un proyecto del contratante: su encabezado y, debajo, un renglón por contrato
// agrupado por partida. Los contratos sin partida van al final del proyecto con
// su estado como cualquier otro; antes salían en un recuadro ámbar con el puro
// nombre, y para saber si tenían fianza había que buscarlos en el padrón.
function ProyectoDelContratante({
  p, contratanteId, contratanteNombre, tipos, tiposDoc, nombreDe, resolver, descargar,
  proveedores = [], suspendidos = [], clientes = [], obrasInvisibles = [],
  puedeLigarContratante, onEditar, onBorrar, onChange, flash, avisar,
}) {
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [asignando, setAsignando] = useState(null);
  const [error, setError] = useState('');

  const partidas = p.partidas || [];
  const sinPartida = (p.obras_sin_partida || []).map(resolver);

  // Los contratos que existen y esta pantalla no muestra, por partida. Vienen
  // del panel (obras_invisibles) y no del panorama, porque el panorama es lo que
  // ve el contratante y él no ve a sus suspendidos.
  const invisiblesDe = (partidaId) =>
    obrasInvisibles.filter((o) => o.partida_id === partidaId);

  // Solo una cosa abierta a la vez dentro del proyecto: dos formularios
  // encimados en la misma tabla no se sabe a qué renglón pertenecen.
  const abrir = (que, id = null) => {
    setCreando(que === 'crear' ? (c) => !c : false);
    setEditando(que === 'editar' ? id : null);
    setAsignando(que === 'asignar' ? (a) => (a === id ? null : id) : null);
  };

  async function borrarPartida(pa) {
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

  const filaProps = { nombreDe, contratanteId, tiposDoc, descargar, onChange, flash };

  return (
    <div>
      {/* Encabezado del proyecto. Sin chip de estado a propósito: el "peor de sus
          partes" pintaba un SIN REGISTRO rojo junto al nombre de un proyecto que
          tenía contratistas cubiertos, y se leía como si todo el proyecto
          estuviera mal. Aquí se CUENTA, y el renglón dice quién. */}
      <div className="px-4 py-2.5 flex flex-wrap items-start gap-x-3 gap-y-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">
            {p.nombre}
            {p.clave && <span className="text-[11px] font-mono font-normal text-slate-500"> {p.clave}</span>}
          </p>
          <p className="text-[11px] text-slate-500">
            {etiquetaEstatus(p.estatus)}
            {p.ubicacion && ` · ${p.ubicacion}`}
            {p.monto_inversion > 0 && ` · inversión ${mxn(p.monto_inversion)}`}
          </p>
          <p className="text-[11px] text-slate-500 tabular-nums">
            {p.total_partidas} partida(s) · {p.obras_vivas} contrato(s) activo(s)
            {p.obras_descubiertas > 0 && (
              <span className="text-rose-600 font-medium"> · {p.obras_descubiertas} sin fianza completa</span>
            )}
            {p.partidas_sin_contratista > 0 && ` · ${p.partidas_sin_contratista} partida(s) sin contratar`}
            {p.monto_afianzado > 0 && (
              <span className="text-slate-400"> · {mxn(p.monto_afianzado)} afianzado</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => abrir('crear')} className={btnSecondary}>
            <Plus className={`h-3.5 w-3.5 transition-transform ${creando ? 'rotate-45' : ''}`} />
            Partida
          </button>
          <button onClick={onEditar} className={btnSecondary} title="Editar proyecto">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={onBorrar}
            className={`${btnSecondary} hover:border-rose-300 hover:text-rose-600`}
            title="Borrar proyecto"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mb-2 rounded border border-rose-200 bg-rose-50 p-2 text-[11px] text-rose-700 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {creando && (
        <div className="px-4 pb-3">
          <FormPartidaPanel
            tipos={tipos}
            onCancel={() => setCreando(false)}
            onSubmit={async (datos) => {
              await api.post(
                `/admin/clientes/${contratanteId}/proyectos/${p.id}/partidas`, datos
              );
              setCreando(false);
              onChange();
              flash('Partida creada');
            }}
          />
        </div>
      )}

      <div className="divide-y divide-slate-100 border-t border-slate-100">
        {partidas.map((pa) => {
          const contratos = (pa.contratos || []).map(resolver);
          const celda = (
            <CeldaPartida
              pa={pa}
              conContratos={contratos.length > 0}
              puedeLigar={puedeLigarContratante}
              onAsignar={() => abrir('asignar', pa.id)}
              onEditar={() => abrir('editar', pa.id)}
              onBorrar={() => borrarPartida(pa)}
            />
          );
          const ocultos = invisiblesDe(pa.id);

          return (
            <div key={pa.id}>
              {contratos.length ? contratos.map((o, i) => (
                <FilaContrato key={o.id} obra={o} partida={i === 0 ? celda : null} {...filaProps} />
              )) : (
                <div className={`${COLS_CONTRATOS} px-4 py-2 items-start`}>
                  {celda}
                  <div className="min-w-0">
                    {/* El atajo va aquí porque aquí se ve el hueco. Hace lo
                        mismo que capturar la obra en el detalle del proveedor. */}
                    {puedeLigarContratante ? (
                      <button onClick={() => abrir('asignar', pa.id)} className={btnSecondary}>
                        <UserPlus className="h-3.5 w-3.5" /> Asignar contratista
                      </button>
                    ) : (
                      <p className="text-[11px] text-slate-400">Sin contratista — lo asigna un operador</p>
                    )}
                    {/* Y si SÍ hay contratos pero no se ven porque su proveedor
                        está suspendido, se dice. Sin esto la pantalla invita a
                        asignar lo que ya está asignado, y el segundo clic deja
                        una obra fantasma. */}
                    {ocultos.length > 0 && (
                      <p className="text-[11px] text-amber-700 mt-1">
                        {ocultos.length} contrato(s) ya asignado(s) que no se ven
                        aquí: {ocultos.map((o) => o.proveedor_nombre).join(', ')}
                        {' '}está(n) suspendido(s) en el padrón. Reactívalo(s) abajo.
                      </p>
                    )}
                  </div>
                  <div><CumplimientoBadge estado={pa.estado_cobertura} /></div>
                  <div className="text-right text-xs text-slate-300">—</div>
                  <div />
                </div>
              )}

              {asignando === pa.id && (
                <div className="px-4 pb-3">
                  <AsignarContratista
                    partida={pa}
                    contratanteId={contratanteId}
                    contratanteNombre={contratanteNombre}
                    proveedores={proveedores}
                    suspendidos={suspendidos}
                    clientes={clientes}
                    onCancel={() => setAsignando(null)}
                    onListo={async (r) => {
                      onChange();
                      if (r?.aviso) {
                        // Sin verde: la obra quedó ligada pero el contratante no
                        // la ve, así que "Contratista asignado" prometería algo
                        // que no pasó. El formulario tampoco se cierra —queda a
                        // la vista con el aviso— porque esta pantalla filtra por
                        // padrón activo y la partida va a seguir diciendo "sin
                        // contratista": cerrando, el operador vuelve a asignar y
                        // deja una segunda obra fantasma. Pasó al probarlo.
                        avisar?.(r.aviso);
                        return;
                      }
                      setAsignando(null);
                      flash('Contratista asignado');
                    }}
                  />
                </div>
              )}

              {editando === pa.id && (
                <div className="px-4 pb-3">
                  <FormPartidaPanel
                    inicial={pa}
                    tipos={tipos}
                    onCancel={() => setEditando(null)}
                    onSubmit={async (datos) => {
                      await api.put(`/admin/clientes/${contratanteId}/partidas/${pa.id}`, datos);
                      setEditando(null);
                      onChange();
                      flash('Partida actualizada');
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Los contratos que están en el proyecto pero en ninguna partida. Es lo
            capturado antes de que las partidas existieran: se dice, no se
            esconde, porque es captura pendiente — pero con su estado, como
            cualquier otro contrato. */}
        {sinPartida.length > 0 && (
          <div>
            {sinPartida.map((o, i) => (
              <FilaContrato
                key={o.id}
                obra={o}
                partida={i === 0 ? (
                  <div title="El contratante lo ve suelto. Créale partidas a este proyecto y asígnaselas desde la obra del proveedor.">
                    <p className="text-xs font-medium text-amber-700">Sin partida</p>
                    <p className="text-[11px] text-slate-400">no se sabe qué fianzas exige</p>
                  </div>
                ) : null}
                {...filaProps}
              />
            ))}
          </div>
        )}

        {!partidas.length && !sinPartida.length && !creando && (
          <p className="px-4 py-3 text-[11px] text-slate-400">
            Sin partidas ni contratos. Puede armarlas él desde su portal, o créaselas aquí
            con «Partida» para poder asignarle los contratos.
          </p>
        )}
      </div>
    </div>
  );
}

function ProyectosDelContratante({
  contratanteId, contratanteNombre, proyectos, obras = [], proveedores, suspendidos = [],
  clientes = [], obrasInvisibles = [], tipos, tiposDoc = [], descargar,
  puedeLigarContratante, onChange, flash, avisar,
}) {
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState('');

  // Busca en el padrón activo, luego en los suspendidos y luego en la cartera.
  // Los tres, porque el atajo permite asignar a un suspendido y a un fiado de
  // fuera del padrón a propósito: con la búsqueda solo en el padrón activo esos
  // contratos se pintaban como el genérico "Proveedor" y se perdía a quién
  // reclamarle. Y si de plano no aparece, se dice que está fuera del padrón en
  // vez de fingir un nombre.
  const nombreDe = (id) =>
    proveedores.find((p) => p.id === id)?.razon_social
    || suspendidos.find((p) => p.id === id)?.razon_social
    || clientes.find((c) => c.id === id)?.razon_social
    || 'Proveedor (fuera del padrón)';

  // Los contratos de dentro de las partidas son los del panorama tal cual, y la
  // ruta del panel solo le pega el nombre legible del tipo a los documentos de
  // la lista plana de obras. Se resuelve contra esa lista para que la carpeta
  // diga "Fianza presentada" y no la clave interna.
  const porId = new Map(obras.map((o) => [o.id, o]));
  const resolver = (o) => porId.get(o.id) || o;

  // Las que están ligadas al contratante pero en ningún proyecto suyo. Antes
  // solo se veían en el padrón; con el padrón sin obras, sin este grupo
  // desaparecerían de la pantalla.
  const fueraDeProyecto = obras.filter((o) => o.desarrollo_id == null);

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

  const encabezado = ['Partida', 'Contratista y contrato', 'Estado', 'Afianzado vigente', ''];

  return (
    <div id="ct-contratos" className="scroll-mt-28 bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">
          Proyectos y contratos ({proyectos.length})
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

      {(proyectos.length > 0 || fueraDeProyecto.length > 0) && (
        // Por debajo de md la tabla no cabe; se desliza de lado en vez de
        // apretar las columnas hasta que el nombre del contratista no se lea.
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className={`${COLS_CONTRATOS} px-4 py-2 bg-slate-50 border-b border-slate-200 items-center`}>
              {encabezado.map((t, i) => (
                <div
                  key={i}
                  className={`text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.06em] ${i === 3 ? 'text-right' : ''}`}
                >
                  {t}
                </div>
              ))}
            </div>

            {/* Un filete más marcado entre proyectos que entre renglones: es
                donde cambia de qué se está hablando. */}
            <div className="divide-y divide-slate-200">
              {proyectos.map((p) => (
                <ProyectoDelContratante
                  key={p.id}
                  p={p}
                  contratanteId={contratanteId}
                  contratanteNombre={contratanteNombre}
                  tipos={tipos}
                  tiposDoc={tiposDoc}
                  nombreDe={nombreDe}
                  resolver={resolver}
                  descargar={descargar}
                  proveedores={proveedores}
                  suspendidos={suspendidos}
                  clientes={clientes}
                  obrasInvisibles={obrasInvisibles}
                  puedeLigarContratante={puedeLigarContratante}
                  onEditar={() => { setEditando(p); setCreando(false); }}
                  onBorrar={() => borrar(p)}
                  onChange={onChange}
                  flash={flash}
                  avisar={avisar}
                />
              ))}

              {fueraDeProyecto.length > 0 && (
                <div>
                  <div className="px-4 py-2.5">
                    <p className="text-sm font-semibold text-amber-800">Fuera de proyecto</p>
                    <p className="text-[11px] text-slate-500">
                      Ligados a este contratante pero en ninguno de sus proyectos: él los ve
                      sueltos. Se acomodan desde la obra, en el detalle del proveedor.
                    </p>
                  </div>
                  <div className="divide-y divide-slate-100 border-t border-slate-100">
                    {fueraDeProyecto.map((o) => (
                      <FilaContrato
                        key={o.id}
                        obra={o}
                        partida={<p className="text-[11px] text-slate-400">—</p>}
                        nombreDe={nombreDe}
                        contratanteId={contratanteId}
                        tiposDoc={tiposDoc}
                        descargar={descargar}
                        onChange={onChange}
                        flash={flash}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!proyectos.length && !fueraDeProyecto.length && !creando && (
        <div className="px-4 py-8 text-center text-sm text-slate-400">
          Este contratante no tiene proyectos todavía. Puede registrarlos él desde su
          portal, o créaselos aquí para poder ligarle las obras de sus proveedores.
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
   Habla de EMPRESAS, no de obras: quién es cada proveedor, cómo anda en
   conjunto, cuánto lleva afianzado y —solo para Fortex— cuánto crédito le
   queda. Sus contratos ya están arriba, cada uno en su partida y con su estado;
   repetirlos aquí era tener que juntar dos mitades para entender uno.

   El estado y el afianzado son EXACTAMENTE lo que ve el contratante en su
   portal: la misma consulta (panoramaDelContratante) alimenta las dos
   pantallas. Es a propósito, y es lo que hace que esta sección sea segura
   también para un vendedor: el que lleva la cuenta del desarrollador necesita
   saber a qué proveedor le falta la fianza —ahí está su venta—, pero sus
   proveedores pueden ser clientes de otro vendedor, y por aquí no se le escapan
   primas ni líneas de crédito de nadie.

   La columna de crédito vivía en una tabla aparte, debajo, repitiendo el nombre
   de cada proveedor una vez por afianzadora. Va en su renglón porque es dato de
   la misma empresa. ESTO NO LO VE EL CONTRATANTE: es de la empresa del
   proveedor y es con lo que se le negocia precio. */

// Dos juegos de columnas porque al vendedor no le llega el crédito (ver la nota
// de abajo): con la columna vacía parecería que nadie tiene línea.
const COLS_PADRON_CON_CREDITO =
  'grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_minmax(0,14rem)_8.5rem] gap-x-3';
const COLS_PADRON =
  'grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem_8.5rem] gap-x-3';

// El crédito de un proveedor, una afianzadora por línea. El comprometido suma
// TODAS sus pólizas vivas, para cualquiera: es de la empresa, no de este
// contratante.
function CreditoDelProveedor({ lineas }) {
  if (!lineas.length) return <p className="text-[11px] text-slate-400">Sin líneas capturadas</p>;
  return (
    <div className="space-y-0.5">
      {lineas.map((l) => (
        <p
          key={l.afianzadora_id}
          className="text-[11px] tabular-nums flex items-baseline justify-between gap-2"
          title={`Línea ${mxn(l.linea_credito)} − comprometido ${mxn(l.comprometido_total)}`}
        >
          <span className="text-slate-500 truncate">{l.afianzadora_nombre}</span>
          {/* Línea en 0 con pólizas encima no es que se haya pasado: es que a
              Fortex le falta capturarla. Pintar el negativo en rojo mandaba a
              buscar crédito en vez de a capturar un dato. Y '<= 0' y no '< 0':
              en cero no le cabe otra fianza, y en verde invita a colocarla. */}
          {!l.linea_credito
            ? <span className="text-amber-700 whitespace-nowrap">sin línea capturada</span>
            : (
              <span className={`font-semibold whitespace-nowrap ${l.disponible <= 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                {mxn(l.disponible)}
              </span>
            )}
        </p>
      ))}
    </div>
  );
}

function PadronProveedores({
  contratanteId, proveedores, suspendidos = [], lineas = [], clientes,
  puedeOperar, onChange, flash,
}) {
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  // Al vendedor el servidor le manda las líneas vacías a propósito: alcanzar a
  // un contratante no puede ser la puerta trasera a las líneas de sus
  // proveedores, que pueden ser clientes de otro vendedor. Por eso la columna no
  // se pinta y se dice por qué, en vez de dejarla en blanco: en blanco se lee
  // "no tienen línea".
  const conCredito = puedeOperar;
  const cols = conCredito ? COLS_PADRON_CON_CREDITO : COLS_PADRON;
  const lineasDe = (id) => lineas.filter((l) => l.proveedor_id === id);

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

  const encabezado = ['Proveedor', 'Estado', 'Afianzado vigente', ...(conCredito ? ['Crédito disponible'] : []), ''];

  return (
    <div id="ct-padron" className="scroll-mt-28 bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">
          Padrón de proveedores ({proveedores.length})
        </h3>
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

      {proveedores.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[680px]">
            <div className={`${cols} px-4 py-2 bg-slate-50 border-b border-slate-200 items-center`}>
              {encabezado.map((t, i) => (
                <div
                  key={i}
                  className={`text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.06em] ${i === 2 ? 'text-right' : ''}`}
                >
                  {t}
                </div>
              ))}
            </div>

            <div className="divide-y divide-slate-100">
              {proveedores.map((p) => (
                <div key={p.id} className={`${cols} px-4 py-2 items-start hover:bg-slate-50/60 transition-colors`}>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate" title={p.razon_social}>
                      {p.razon_social}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate" title={p.notas || undefined}>
                      {p.alias && <span className="text-slate-500">{p.alias} · </span>}
                      {p.rfc ? <span className="font-mono">{p.rfc}</span> : 'Sin RFC'}
                      {p.notas && ` · ${p.notas}`}
                    </p>
                  </div>
                  {/* El de su PEOR contrato vivo: tener uno cubierto no arregla
                      el que está descubierto. Cuál es, se ve arriba. */}
                  <div><CumplimientoBadge estado={p.cumplimiento} /></div>
                  <div className="text-right tabular-nums">
                    <p className="text-xs text-slate-700">{p.monto_afianzado > 0 ? mxn(p.monto_afianzado) : '—'}</p>
                    <p className="text-[10px] text-slate-400">{p.obras_vivas} contrato(s) activo(s)</p>
                  </div>
                  {conCredito && <CreditoDelProveedor lineas={lineasDe(p.id)} />}
                  <div className="flex items-center justify-end gap-1.5">
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
              ))}
            </div>
          </div>
        </div>
      )}

      {proveedores.length > 0 && (
        <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
          {conCredito
            ? 'El crédito es de la empresa, no de este contratante: el comprometido suma todas sus obras, para cualquiera. El contratante NO ve esa columna.'
            : 'Las líneas de crédito las ve un operador: son de la empresa del proveedor, que puede ser cliente de otro vendedor.'}
        </p>
      )}

      {!proveedores.length && !agregando && (
        <div className="px-4 py-8 text-center text-sm text-slate-400">
          Este contratante no tiene proveedores activos todavía. Agrégalos para que
          pueda ver quién le presentó fianza y quién no.
        </div>
      )}

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
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <FileText className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Expediente del fiado</h3>
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
      <label className="inline-flex items-center gap-2 text-xs text-slate-500">
        Vendedor
        <select
          value={vendedorId || ''}
          onChange={(e) => asignar(e.target.value)}
          className="px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 text-slate-700 min-w-40"
        >
          <option value="">Sin asignar</option>
          {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
        </select>
      </label>
      {error && <p className="text-[11px] text-red-600 mt-1">{error}</p>}
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
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <Users className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Accesos del cliente ({activos})</h3>
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

function PersonalFortex({ internos = [], onChange, flash, embebido }) {
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
    <div className={embebido ? '' : 'bg-white border border-slate-200 rounded-xl overflow-hidden'}>
      {!embebido && (
        <button
          onClick={() => setOpen((o) => !o)}
          className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <UserCog className="w-4 h-4 text-indigo-600" /> Personal de Fortex ({internos.length})
          <Plus className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${open ? 'rotate-45' : ''}`} />
        </button>
      )}
      {(open || embebido) && (
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

function Req() { return <span className="text-rose-500">*</span>; }

// Una cifra del encabezado del cliente: la etiqueta chica arriba y el número
// abajo, sin fondo de color. Las seis píldoras de antes eran verde, azul,
// violeta y gris por pura decoración —el color no decía nada— y competían con
// los pendientes, que es lo único que sí tiene que llamar la atención. Aquí el
// color solo aparece si la cifra es un problema.
function Dato({ label, valor, alerta, ayuda }) {
  return (
    <div className="min-w-0" title={ayuda}>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-sm font-semibold tabular-nums ${alerta ? 'text-rose-600' : 'text-slate-800'}`}>
        {valor}
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Lo que falta, siempre a la vista
   --------------------------------------------------------------------------
   Esta lista es la condición para poder tabular. Va FUERA del switch de
   pestañas y por eso el operador ve lo que falta aunque esté en otra vista, y
   llega de un clic. Sin ella, organizar sería esconder.

   Los pendientes salen de pendientesDelFiado / pendientesDelContratante
   (lib.jsx), las mismas funciones que alimentan los contadores de las pestañas
   y la regla de "esta obra arranca abierta": tres pantallas que no pueden
   discrepar porque leen del mismo lugar.

   Se pintan por GRUPO, un renglón por grupo con su etiqueta, y no como chips
   sueltos: con seis chips de colores no se sabía por dónde empezar. Ahora se
   lee de arriba abajo, de lo urgente a lo que solo hay que seguir. Debajo van
   los recordatorios de ESTE cliente, que antes vivían en una franja aparte
   arriba de toda la pantalla.

   Sin pendientes NO se pinta un banner verde. Se escribe en slate y con el
   alcance acotado: el panel no sabe de las fianzas que el cliente colocó con
   otro agente, y "todo al día" prometería de más. */

function Pendientes({ pendientes, recordatorios = [], onIr, onRecordatorioAtendido }) {
  // Cerrado se enseña SOLO el grupo más urgente, completo; lo demás se cuenta
  // en una línea. Abierto, todo. Antes se veía todo siempre y con seis
  // pendientes y dos recordatorios la ficha empezaba con un muro de avisos.
  //
  // No se esconde nada: lo que no se ve se CUENTA, con su número, en la línea
  // de "y además". Y no se recuerda que alguien lo abrió: cada ficha arranca
  // igual de tranquila.
  const [abierto, setAbierto] = useState(false);
  const grupos = GRUPOS_PENDIENTE
    .map((g) => ({ ...g, items: pendientes.filter((p) => p.tono === g.tono) }))
    .filter((g) => g.items.length);

  if (!grupos.length && !recordatorios.length) {
    return (
      <p className="mt-4 pt-3 border-t border-slate-100 text-xs text-slate-400">
        Sin pendientes en lo que Fortex captura.
      </p>
    );
  }

  const atrasados = recordatorios.filter((r) => r.dias_restantes < 0).length;
  const visibles = abierto ? grupos : grupos.slice(0, 1);
  const resto = [
    ...grupos.slice(1).map((g) => `${g.items.length} ${g.corto}`),
    recordatorios.length
      ? `${recordatorios.length} recordatorio(s)${atrasados ? ` (${atrasados} atrasado${atrasados > 1 ? 's' : ''})` : ''}`
      : null,
  ].filter(Boolean);

  const renglon = (g) => (
    <div key={g.tono} className="flex items-baseline gap-3 py-1">
      <span className={`w-28 shrink-0 flex items-center gap-1.5 text-[11px] font-semibold ${g.texto}`}>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 -translate-y-px ${g.punto}`} />
        {g.label}
      </span>
      <p className="flex-1 min-w-0 text-sm text-slate-700">
        {g.items.map((p, i) => (
          <span key={p.clave}>
            {i > 0 && <span className="text-slate-300"> · </span>}
            <button onClick={() => onIr(p.destino)} className="hover:underline text-left">{p.texto}</button>
          </span>
        ))}
      </p>
    </div>
  );

  return (
    <div className="mt-4 pt-3 border-t border-slate-100">
      {visibles.map(renglon)}

      {!abierto && resto.length > 0 && (
        <button
          onClick={() => setAbierto(true)}
          className="mt-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
        >
          {grupos.length ? 'Además: ' : ''}{resto.join(' · ')}
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}

      {abierto && recordatorios.length > 0 && (
        <div className="-mx-5 mt-2 border-t border-slate-100">
          <p className="px-5 pt-2.5 text-[11px] font-semibold text-slate-500">
            Recordatorios ({recordatorios.length})
            <span className="font-normal text-slate-400"> · uso interno, el cliente no los ve</span>
          </p>
          <div className="divide-y divide-slate-50 [&>div]:px-5">
            {recordatorios.map((r) => (
              <RenglonRecordatorio key={r.id} r={r} onAtendido={onRecordatorioAtendido} />
            ))}
          </div>
        </div>
      )}

      {abierto && (
        <button
          onClick={() => setAbierto(false)}
          className="mt-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 transition-colors"
        >
          Ver menos <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// Las pestañas de FortexLink: subrayado de 2px en el azul de marca para la
// activa, y el contador en píldora (azul con texto blanco cuando está activa).
//
// El contador solo se pinta si viene un número. Nunca '?? 0': un cero se lee
// "no hay nada" cuando puede ser "no se pudo consultar". Y si la pestaña
// esconde algo que falta, el contador va en ámbar: tabular no puede esconder.
function TiraPestanas({ pestanas, activa, onCambiar }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 overflow-x-auto [scrollbar-width:none]">
      {pestanas.map(({ key, label, icono: Icono, cuenta, alerta }) => {
        const es = activa === key;
        return (
          <button
            key={key}
            onClick={() => onCambiar(key)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 -mb-px border-b-2 text-[13px] transition-colors ${
              es ? 'border-indigo-600 text-slate-800 font-semibold' : 'border-transparent text-slate-500 font-medium hover:text-slate-800'
            }`}
          >
            <Icono className={`h-3.5 w-3.5 ${es ? 'text-indigo-600' : 'text-slate-400'}`} />
            {label}
            {cuenta != null && (
              <span className={`text-[10.5px] rounded-full px-1.5 leading-[17px] font-semibold tabular-nums ${
                alerta ? 'bg-amber-100 text-amber-800' : es ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {cuenta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

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
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-800">Líneas de crédito por afianzadora</h3>
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

// El estado de una obra en una sola píldora, para leerla sin abrirla. Es el de
// su PEOR póliza: tener una vigente no arregla la vencida.
const ESTADO_OBRA = {
  sin_fianza: { label: 'Sin fianza',        cls: 'bg-red-100 text-red-800' },
  vencida:    { label: 'Vencida',           cls: 'bg-red-100 text-red-800' },
  sin_fecha:  { label: 'Sin fecha',         cls: 'bg-amber-100 text-amber-800' },
  por_vencer: { label: 'Por vencer',        cls: 'bg-amber-100 text-amber-800' },
  previo:     { label: 'Previo en trámite', cls: 'bg-blue-100 text-blue-800' },
  vigente:    { label: 'Vigente',           cls: 'bg-green-100 text-green-800' },
};

function estadoDeObra(p) {
  const registros = p.fianzas || [];
  const emitidas = registros.filter((f) => f.clase !== 'previo');
  if (!emitidas.length) return registros.length ? 'previo' : 'sin_fianza';
  if (emitidas.some((f) => f.estado === 'vencida')) return 'vencida';
  if (emitidas.some((f) => !f.fecha_vigencia)) return 'sin_fecha';
  if (emitidas.some((f) => f.estado === 'por_vencer')) return 'por_vencer';
  return 'vigente';
}

// Las columnas del renglón de obra, una vez.
const COLS_OBRA = 'grid grid-cols-[1rem_minmax(0,1fr)_8.5rem_9rem_auto] gap-x-4 items-center';

function Proyectos({
  clienteId, proyectos, afianzadoras, tipos, tiposDoc, lineas = [],
  contratantes = [], puedeLigarContratante, onChange, flash, avisar,
}) {
  const [creando, setCreando] = useState(false);

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
        <h3 className="font-semibold text-slate-800 text-sm">Obras ({proyectos.length})</h3>
        <button onClick={() => setCreando((c) => !c)} className={btnSecondary}>
          <Plus className={`h-3.5 w-3.5 transition-transform ${creando ? 'rotate-45' : ''}`} /> Nueva obra
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
            flash('Obra creada');
            // El servidor avisa si la obra quedó ligada a un contratante que
            // tiene suspendido a este proveedor: se ligó, pero todavía no la ve.
            // El '?.' no es por costumbre: este aviso solo aparece cuando el
            // proveedor está suspendido, así que una prop mal cableada NO
            // revienta en el uso normal — revienta el día que de verdad hay
            // algo que avisar. Ya pasó una vez.
            if (r.aviso) avisar?.(r.aviso);
          }}
        />
      )}

      {proyectos.length > 0 && (
        <div className={`${COLS_OBRA} px-5 py-2 bg-slate-50 border-b border-slate-100`}>
          <div />
          {['Obra', 'Estado', 'Afianzado', ''].map((t, i) => (
            <div key={i} className={`text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.06em] ${i === 2 ? 'text-right' : ''}`}>{t}</div>
          ))}
        </div>
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
            lineas={lineas}
            contratantes={contratantes}
            puedeLigarContratante={puedeLigarContratante}
            onChange={onChange}
            flash={flash}
            avisar={avisar}
          />
        ))}
        {!proyectos.length && !creando && (
          <div className="py-16 text-center text-slate-400 text-sm">
            Este cliente no tiene obras. Crea una para poder registrar sus fianzas.
          </div>
        )}
      </div>
    </div>
  );
}

function Proyecto({
  proyecto: p, proyectos, clienteId, afianzadoras, tipos, tiposDoc, lineas = [],
  contratantes = [], puedeLigarContratante, onChange, flash, avisar,
}) {
  // Todas arrancan PLEGADAS, salvo que sea la única. Antes se abrían las que
  // tenían algún pendiente, y en un cliente con tres obras eso era tres tablas
  // de diez columnas abiertas al mismo tiempo. Ya no hace falta abrirlas para
  // saber cómo están: la píldora de estado lo dice en el renglón, y los
  // pendientes de arriba de la ficha las cuentan.
  const [abierto, setAbierto] = useState(proyectos.length === 1);
  const [editando, setEditando] = useState(false);
  const [nuevaFianza, setNuevaFianza] = useState(false);
  const [verDocs, setVerDocs] = useState(false);
  const [error, setError] = useState('');
  const docs = p.documentos || [];

  const registros = p.fianzas || [];
  const emitidas = registros.filter((f) => f.clase !== 'previo');
  const previos = registros.length - emitidas.length;
  const estado = ESTADO_OBRA[estadoDeObra(p)];

  // Abrir el formulario de fianza abre la obra. Sin esto, con la obra plegada el
  // formulario se montaría dentro del bloque escondido y desaparecería con todo
  // lo tecleado.
  const abrirNuevaFianza = () => {
    setNuevaFianza((n) => {
      const siguiente = !n;
      if (siguiente) setAbierto(true);
      return siguiente;
    });
  };

  async function borrar() {
    setError('');
    if (!confirm(`¿Borrar la obra "${p.nombre}"?`)) return;
    try {
      await api.del(`/admin/proyectos/${p.id}`);
      onChange();
      flash('Obra eliminada');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <div
        className={`${COLS_OBRA} px-5 py-3 cursor-pointer hover:bg-slate-50 transition-colors group`}
        onClick={() => setAbierto((a) => !a)}
      >
        <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${abierto ? 'rotate-90' : ''}`} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-indigo-700 transition-colors">
            {p.nombre}
            <span className="ml-2 text-xs font-normal text-slate-400">{etiquetaEstatus(p.estatus)}</span>
          </p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">
            {p.numero_contrato && <span className="font-mono">{p.numero_contrato}</span>}
            {p.beneficiario && <span>{p.numero_contrato ? ' · ' : ''}{p.beneficiario}</span>}
            {p.fecha_termino && <span> · termina {fmtDate(p.fecha_termino)}</span>}
            {/* Que se vea sin abrir nada: las pólizas de esta obra las está
                viendo otra empresa. */}
            {p.contratante_nombre && <span> · las ve {p.contratante_nombre}</span>}
          </p>
        </div>
        <div>
          <span className={`estado-pill ${estado.cls}`}>
            {estado.label}
          </span>
          <p className="text-[11px] text-slate-400 mt-0.5 tabular-nums">
            {emitidas.length} póliza(s){previos > 0 && ` · ${previos} previo(s)`}
          </p>
        </div>
        <div className="text-right tabular-nums">
          <p className="text-sm text-slate-800">{mxn(p.monto_afianzado)}</p>
          {p.monto_contrato > 0 && (
            <p className="text-[11px] text-slate-400">
              {p.pct_contrato_afianzado != null && `${p.pct_contrato_afianzado}% de `}{mxn(p.monto_contrato)}
            </p>
          )}
        </div>
        {/* Las acciones no abren ni cierran la obra. */}
        <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
          <button onClick={abrirNuevaFianza} className={btnSecondary} title="Agregar fianza o previo">
            <Plus className={`h-3.5 w-3.5 transition-transform ${nuevaFianza ? 'rotate-45' : ''}`} /> Fianza
          </button>
          <button
            onClick={() => setVerDocs((v) => !v)}
            className={`p-1.5 rounded-lg transition-colors flex items-center gap-0.5 ${
              docs.length ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-300 hover:text-slate-600 hover:bg-slate-100'
            }`}
            title="Contrato y documentos de la obra"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {docs.length > 0 && <span className="text-[10px] tabular-nums">{docs.length}</span>}
          </button>
          <button
            onClick={() => setEditando((e) => !e)}
            className="p-1.5 rounded-lg text-slate-300 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="Editar obra"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={borrar}
            className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 hover:bg-red-50 transition-colors"
            title="Eliminar obra"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-5 mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      {verDocs && (
        <div className="border-t border-slate-100 bg-slate-50/60 px-5 py-3">
          <p className="text-xs font-medium text-slate-600 mb-2">
            Documentos de la obra <span className="text-slate-400">· contrato, convenios, acta de entrega</span>
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
            flash('Obra actualizada');
            if (r.aviso) avisar?.(r.aviso);
          }}
        />
      )}

      {abierto && (
        <div className="bg-slate-50/50 border-t border-slate-100">
          {registros.length ? (
            <TablaFianzas
              clienteId={clienteId}
              fianzas={registros}
              proyectos={proyectos}
              afianzadoras={afianzadoras}
              tipos={tipos}
              tiposDoc={tiposDoc}
              lineas={lineas}
              onChange={onChange}
              flash={flash}
            />
          ) : !nuevaFianza && (
            <p className="px-5 py-4 text-xs text-slate-400">
              Sin pólizas en esta obra. Agrégala con «Fianza».
            </p>
          )}
          {nuevaFianza && (
            <FormFianza
              proyectos={proyectos}
              proyectoId={p.id}
              afianzadoras={afianzadoras}
              tipos={tipos}
              lineas={lineas}
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

function TablaFianzas({ clienteId, fianzas, proyectos, afianzadoras, tipos, tiposDoc, lineas = [], onChange, flash }) {
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
        <thead className="text-slate-400 uppercase tracking-wide text-[10px] font-semibold whitespace-nowrap">
          <tr>
            <th className="text-left px-3 py-2 pl-5">Póliza</th>
            <th className="text-left px-3 py-2">Afianzadora</th>
            <th className="text-left px-3 py-2">Tipo</th>
            <th className="text-right px-3 py-2">Monto</th>
            {/* Una sola columna con las dos primas: la total arriba (lo que se
                paga) y la neta debajo. Separarlas en dos columnas volvía a
                sacar scroll horizontal en la tabla. */}
            <th className="text-right px-3 py-2">Prima total</th>
            {/* El recordatorio va debajo de la vigencia y no en su columna: era
                una columna casi siempre vacía que empujaba la tabla a lo ancho. */}
            <th className="text-left px-3 py-2">Vigencia</th>
            <th className="text-left px-3 py-2">Estado</th>
            <th className="text-center px-3 py-2">Docs</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {fianzas.map((f) => (
            editandoId === f.id ? (
              <tr key={f.id}>
                <td colSpan={9} className="p-0">
                  <FormFianza
                    inicial={f}
                    proyectos={proyectos}
                    proyectoId={f.proyecto_id}
                    afianzadoras={afianzadoras}
                    tipos={tipos}
                    lineas={lineas}
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
                <td className="px-3 py-1.5 pl-5 text-slate-700 whitespace-nowrap">
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
                <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">
                  {fmtDate(f.fecha_vigencia)}
                  {f.fecha_recordatorio && (
                    <span
                      className={`block text-[10px] tabular-nums ${
                        f.recordatorio_atendido_el ? 'text-slate-400 line-through'
                        : f.dias_para_recordatorio <= 7 ? 'text-amber-700 font-medium'
                        : 'text-slate-400'
                      }`}
                      title={f.nota_recordatorio || ''}
                    >
                      recordar {fmtDate(f.fecha_recordatorio)}
                    </span>
                  )}
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
                <td colSpan={9} className="px-4 py-3">
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

function FormFianza({ inicial, proyectos, proyectoId, afianzadoras, tipos, lineas = [], onSubmit, onCancel }) {
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
            {/* Cada opción dice cuánto le queda al fiado con esa afianzadora.
                Es lo que se pregunta al capturar —¿con quién le cabe?— y antes
                obligaba a tener la tabla de crédito a la vista en la misma
                pantalla que las obras. */}
            <select value={f.afianzadora_id} onChange={set('afianzadora_id')} className={inputCls}>
              <option value="">Selecciona…</option>
              {afianzadoras.map((a) => {
                const l = lineas.find((x) => x.afianzadora_id === a.id);
                return (
                  <option key={a.id} value={a.id}>
                    {a.nombre}{l ? ` — disponible ${mxn(l.disponible)}` : ' — sin línea'}
                  </option>
                );
              })}
            </select>
            {(() => {
              const l = lineas.find((x) => x.afianzadora_id === Number(f.afianzadora_id));
              // Solo avisa: la afianzadora puede autorizar por encima de la
              // línea, y un previo no consume nada.
              if (!l || esPrevio || !f.monto_afianzado) return null;
              const propia = inicial && inicial.clase !== 'previo' && inicial.afianzadora_id === l.afianzadora_id
                ? inicial.monto_afianzado : 0;
              return f.monto_afianzado > l.disponible + propia ? (
                <p className="text-[11px] text-amber-700 mt-1">
                  Rebasa lo disponible con esta afianzadora ({mxn(l.disponible + propia)}).
                </p>
              ) : null;
            })()}
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

/* --------------------------------------------------------------------------
   Alta de cliente
   --------------------------------------------------------------------------
   Lo abre y lo cierra quien lo monta. Antes traía su propio 'open' con su propio
   encabezado, así que al moverlo dentro de la tarjeta de clientes hacían falta
   DOS clics para ver un campo: uno abría el bloque y el otro el formulario. */

function NuevoCliente({ vendedores = [], onDone, onCancel }) {
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
      onDone(r.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const esContratante = f.tipo === 'contratante';

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <UserPlus className="w-4 h-4 text-indigo-600" />
        <h3 className="text-sm font-semibold text-slate-800">Nuevo cliente</h3>
        <button onClick={onCancel} className={`${btnSecondary} ml-auto`}>
          <X className="h-3.5 w-3.5" /> Cancelar
        </button>
      </div>

      {/* Dos mitades porque son dos cosas distintas: la EMPRESA que se da de
          alta, y la PERSONA que va a entrar por ella. Apiladas en la columna
          estrecha se leían como una sola lista de ocho campos. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3 p-5">
        <div className="space-y-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            La empresa
          </p>
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

          {/* El campo que más caro cuesta equivocar: decide la pantalla ENTERA
              que va a ver esa cuenta. Por eso se explica al elegirlo, no
              después. */}
          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Tipo de cuenta<Req /></label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { v: 'fiado', t: 'Fiado', s: 'Compra fianzas' },
                { v: 'contratante', t: 'Contratante', s: 'Se las exige a sus proveedores' },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setF((s) => ({ ...s, tipo: o.v }))}
                  className={`text-left px-3 py-2 rounded-lg border transition-colors ${
                    f.tipo === o.v
                      ? 'border-indigo-400 bg-indigo-50/60'
                      : 'border-slate-200 hover:border-indigo-300'
                  }`}
                >
                  <span className="block text-sm font-medium text-slate-700">{o.t}</span>
                  <span className="block text-[11px] text-slate-500">{o.s}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400 mt-1.5">
              {esContratante
                ? 'No tendrá pólizas, líneas de crédito ni expediente. Al entrar verá el '
                  + 'padrón de sus proveedores y qué fianza presentó cada uno.'
                : 'Lo de siempre: obras, pólizas, líneas de crédito y expediente.'}
            </p>
          </div>

          <div>
            <label className="text-[11px] text-slate-500 mb-1 block">Vendedor titular</label>
            <select value={f.vendedor_id} onChange={set('vendedor_id')} className={inputCls}>
              <option value="">Sin asignar</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              {f.vendedor_id
                ? 'Solo él y los operadores verán esta cuenta.'
                : 'Sin vendedor, ningún vendedor la va a ver en su cartera. Los operadores sí.'}
            </p>
          </div>
        </div>

        <div className="space-y-3 md:border-l md:border-slate-100 md:pl-6">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            Su primer acceso
          </p>
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
            <input
              type="text"
              value={f.password}
              onChange={set('password')}
              placeholder="mínimo 8 caracteres"
              className={inputCls}
            />
            {/* Se muestra en claro a propósito: alguien de Fortex se la tiene
                que dictar al cliente, y un campo de puntitos obliga a teclearla
                dos veces a ciegas. */}
            <p className="text-[11px] text-slate-400 mt-1">
              Se ve en claro porque hay que dictársela. El cliente la cambia al entrar.
            </p>
          </div>

          <p className="text-[11px] text-slate-500 border-t border-slate-100 pt-3">
            {esContratante
              ? 'Después, desde su detalle, le armas el padrón de proveedores. Ahí mismo '
                + 'puedes dar de alta a un proveedor que todavía no sea cliente.'
              : 'Después puedes agregarle más personas desde el detalle del cliente. Las líneas '
                + 'de crédito se asignan por afianzadora, también desde ahí.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mx-5 mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 px-5 py-3 border-t border-slate-100 bg-slate-50/60">
        <button onClick={guardar} disabled={busy} className={btnPrimary}>
          <Save className="w-4 h-4" /> {busy ? 'Guardando…' : 'Crear cliente'}
        </button>
        <button onClick={onCancel} className={btnSecondary}>Cancelar</button>
        <span className="text-[11px] text-slate-400">
          Se crea la empresa y su primera cuenta de acceso.
        </span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Configuración — lo de la casa, en un solo lugar
   --------------------------------------------------------------------------
   Eran cuatro tarjetas sueltas apiladas debajo de la lista de clientes: 252px
   de cosas que se tocan una vez al año, cada una pidiendo su propio renglón. Se
   funden en una que ocupa el alto de una.

   Va en pestañas y no en cuatro acordeones anidados porque son cuatro catálogos
   hermanos, no una jerarquía: acordeón dentro de acordeón obliga a dos clics
   para ver una lista de diez renglones.

   Y se queda en la COLUMNA, no en una pantalla aparte. Es a propósito: los tipos
   de documento solo importan cuando estás viendo el expediente de un fiado, y
   las afianzadoras se agregan a media captura de una fianza. Una pantalla aparte
   desmontaría el detalle —con el formulario a medio llenar dentro— justo en el
   momento en que se necesita el catálogo. Aquí conviven a ≥1280px. */

function Configuracion({
  tipos, docsRequeridos, internos, esAdmin, siempreAbierta,
  onTipos, onDocumentos, onAfianzadora, onInternos, flash,
}) {
  // Como página propia va abierta y sin el botón de plegar: plegar algo que es
  // lo único en la pantalla no tiene sentido.
  const [abiertaAMano, setAbierta] = useState(false);
  const abierta = siempreAbierta || abiertaAMano;
  const [vista, setVista] = useState('afianzadoras');

  const secciones = [
    { key: 'afianzadoras', label: 'Afianzadoras' },
    { key: 'tipos', label: 'Tipos de fianza', cuenta: tipos.length },
    { key: 'documentos', label: 'Documentos', cuenta: docsRequeridos.length },
    // Las cuentas de Fortex son lo único del admin aquí.
    ...(esAdmin ? [{ key: 'personal', label: 'Personal', cuenta: internos.length }] : []),
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {!siempreAbierta && (
        <button
          onClick={() => setAbierta((a) => !a)}
          className="w-full px-4 py-2.5 bg-slate-50 hover:bg-slate-100 flex items-center gap-2 text-sm font-semibold text-slate-700"
        >
          <Settings className="w-4 h-4 text-indigo-600" /> Configuración
          <span className="text-[11px] font-normal text-slate-400">
            catálogos de la casa
          </span>
          <Plus className={`w-4 h-4 ml-auto text-slate-400 transition-transform ${abierta ? 'rotate-45' : ''}`} />
        </button>
      )}

      {abierta && (
        <>
          <div className="flex gap-1 border-b border-slate-200 px-3 overflow-x-auto">
            {secciones.map((s) => (
              <button
                key={s.key}
                onClick={() => setVista(s.key)}
                className={`px-2.5 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                  vista === s.key
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {s.label}
                {s.cuenta != null && <span className="tabular-nums text-slate-400"> ({s.cuenta})</span>}
              </button>
            ))}
          </div>

          {vista === 'afianzadoras' && (
            <div className="p-4">
              <NuevaAfianzadora onDone={onAfianzadora} embebido />
            </div>
          )}
          {vista === 'tipos' && (
            <CatalogoTipos tipos={tipos} onChange={onTipos} flash={flash} embebido />
          )}
          {vista === 'documentos' && (
            <CatalogoDocumentos tipos={docsRequeridos} onChange={onDocumentos} flash={flash} embebido />
          )}
          {vista === 'personal' && esAdmin && (
            <PersonalFortex internos={internos} onChange={onInternos} flash={flash} embebido />
          )}
        </>
      )}
    </div>
  );
}

function NuevaAfianzadora({ onDone, embebido }) {
  const [nombre, setNombre] = useState('');
  async function add() {
    if (!nombre) return;
    await api.post('/admin/afianzadoras', { nombre });
    setNombre('');
    onDone();
  }
  const campo = (
    <>
      <div className="flex gap-2">
        <input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" className={inputCls} />
        <button onClick={add} className={btnPrimary}><Plus className="w-4 h-4" /> Añadir</button>
      </div>
      <p className="text-[11px] text-slate-400 mt-2">
        Se agrega al catálogo y queda disponible en las líneas de crédito y en la captura
        de pólizas.
      </p>
    </>
  );

  if (embebido) return campo;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-2">Agregar afianzadora</h3>
      {campo}
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
