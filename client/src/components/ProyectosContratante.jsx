// Los PROYECTOS del contratante: sus desarrollos, y lo que cuelga de cada uno.
//
// Es la pestaña que le da lo que pidió: la torre completa en un lugar, con los
// proveedores adentro. Lo único que él captura en todo el portal es esto —el
// proyecto—; asignarle proveedores es de Fortex, porque eso abre las pólizas de
// otra empresa y no se deshace.
import { useCallback, useEffect, useState } from 'react';
import {
  Building2, Plus, Save, X, ArrowLeft, AlertTriangle, Pencil, Trash2, CreditCard, Layers,
} from 'lucide-react';
import { api } from '../api.js';
import {
  mxn, fmtDate, CumplimientoBadge, ESTATUS_PROYECTO, etiquetaEstatus, InputPesos,
} from '../lib.jsx';
import Obra, { btnChico } from './ObraContratante.jsx';
import PartidasContratante from './PartidasContratante.jsx';

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100';
const btnPrimary =
  'flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50';

/* --------------------------------------------------------------------------
   Formulario del proyecto
   -------------------------------------------------------------------------- */

function FormProyecto({ inicial, onSubmit, onCancel }) {
  const [f, setF] = useState({
    nombre: inicial?.nombre || '',
    clave: inicial?.clave || '',
    ubicacion: inicial?.ubicacion || '',
    monto_inversion: inicial?.monto_inversion ?? 0, // centavos
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
    <div className="portal-card bg-white border border-indigo-200 rounded-lg p-4 mb-4">
      <p className="text-sm font-medium text-slate-700 mb-3">
        {inicial ? 'Editar proyecto' : 'Nuevo proyecto'}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="text-[11px] text-slate-500 mb-1 block">
            Nombre del proyecto<span className="text-rose-500">*</span>
          </label>
          <input value={f.nombre} onChange={set('nombre')} placeholder="Torre Delta Poniente" className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Clave interna</label>
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
        <button onClick={onCancel} className={btnChico}><X className="h-3.5 w-3.5" /> Cancelar</button>
      </div>

      <p className="text-[11px] text-slate-400 mt-3">
        Después de guardarlo, entra al proyecto y arma sus <span className="font-medium">partidas</span>:
        muros, electricidad, acabados. Los contratistas los asigna Fortex —ligar la obra de una
        empresa te abre sus pólizas y eso no se deshace—, así que dinos a quién contrataste
        para cada partida y lo hacen.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Lo que este proyecto le está apartando de línea a cada proveedor
   --------------------------------------------------------------------------
   Solo el comprometido, y a propósito: la línea autorizada y el disponible son
   de la empresa del proveedor, no de este proyecto. Esta cifra no es un dato
   nuevo — es la suma de los montos afianzados de las pólizas que ya se ven una
   por una; lo que aporta es no tener que sacar la calculadora. */

function Consumo({ consumo }) {
  if (!consumo?.length) return null;

  return (
    <div className="portal-card bg-white border border-slate-200 rounded-lg overflow-hidden mb-4">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <CreditCard className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">
          Crédito afianzable que aparta este proyecto
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
            <tr>
              <th className="text-left px-3 py-2">Proveedor</th>
              <th className="text-left px-3 py-2">Afianzadora</th>
              <th className="text-right px-3 py-2">Pólizas</th>
              <th className="text-right px-3 py-2">Comprometido por este proyecto</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {consumo.map((c) => (
              <tr key={`${c.proveedor_id}:${c.afianzadora_id}`} className="hover:bg-slate-50/40">
                <td className="px-3 py-1.5 text-slate-700 font-medium">{c.proveedor_nombre}</td>
                <td className="px-3 py-1.5 text-slate-600">{c.afianzadora_nombre}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{c.polizas}</td>
                <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">
                  {mxn(c.comprometido)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-100">
        Es lo que las fianzas vigentes de esta obra le están apartando de su línea con cada
        afianzadora. Cuánto tiene autorizado en total es cosa suya y de Fortex.
      </p>
    </div>
  );
}

/* --------------------------------------------------------------------------
   El detalle de un proyecto
   -------------------------------------------------------------------------- */

function DetalleProyecto({
  detalle, clienteId, tipos, tiposFianza, onVolver, onCambio, avisar, flash,
}) {
  const { proyecto } = detalle;

  return (
    <>
      <button onClick={onVolver} className={`${btnChico} mb-4`}>
        <ArrowLeft className="h-3.5 w-3.5" /> Volver a mis proyectos
      </button>

      <div className="portal-card bg-white border border-slate-200 rounded-lg p-4 mb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
              {proyecto?.nombre}
              {proyecto?.clave && (
                <span className="text-[11px] font-mono text-slate-500">{proyecto.clave}</span>
              )}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {proyecto?.ubicacion || 'Sin ubicación'}
              {' · '}{etiquetaEstatus(proyecto?.estatus)}
              {proyecto?.fecha_termino && ` · termina ${fmtDate(proyecto.fecha_termino)}`}
            </p>
            {proyecto?.notas && <p className="text-[11px] text-slate-400 mt-1">{proyecto.notas}</p>}
          </div>
          {/* "Cubierta" solo si de verdad se sabe qué se exigía: basta que UNA
              partida no tenga requisitos para que el proyecto no pueda
              prometerlo, porque esa partida saldría verde sin haber
              comprobado nada. */}
          <CumplimientoBadge
            estado={proyecto?.cumplimiento}
            verificada={
              (proyecto?.partidas?.length || 0) > 0
              && proyecto.partidas.every((pa) => pa.requisitos.length > 0)
            }
          />
        </div>

        <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Inversión</p>
            <p className="tabular-nums font-semibold text-slate-800">{mxn(proyecto?.monto_inversion)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Contratado</p>
            <p className="tabular-nums font-semibold text-slate-800">{mxn(proyecto?.monto_contratado)}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Afianzado a tu favor</p>
            <p className="tabular-nums font-semibold text-sky-700">{mxn(proyecto?.monto_afianzado)}</p>
          </div>
          {/* Las dos cuentas van SEPARADAS a propósito: "sin contratista" es un
              pendiente tuyo —te falta contratar— y "sin fianza" es de quien ya
              está trabajando. Sumadas, el número no diría qué hacer. */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-400">Partidas</p>
            <p className="tabular-nums font-semibold text-slate-800">
              {proyecto?.total_partidas ?? 0}
              {proyecto?.partidas_sin_contratista > 0 && (
                <span className="text-slate-500 font-normal text-[11px]">
                  {' · '}{proyecto.partidas_sin_contratista} sin contratar
                </span>
              )}
            </p>
            <p className={`text-[11px] tabular-nums ${
              proyecto?.partidas_descubiertas ? 'text-rose-600 font-medium' : 'text-emerald-700'
            }`}>
              {proyecto?.partidas_descubiertas
                ? `${proyecto.partidas_descubiertas} sin fianza completa`
                : 'todas con fianza'}
            </p>
          </div>
        </div>
      </div>

      <Consumo consumo={proyecto?.consumo} />

      <PartidasContratante
        proyecto={proyecto}
        clienteId={clienteId}
        tiposDoc={tipos}
        tiposFianza={tiposFianza}
        onCambio={onCambio}
        avisar={avisar}
        flash={flash}
      />
    </>
  );
}

/* --------------------------------------------------------------------------
   La lista de proyectos
   -------------------------------------------------------------------------- */

export default function ProyectosContratante({ clienteId, tipos, onCambio, avisar, flash }) {
  const [data, setData] = useState(null);
  const [sel, setSel] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [tiposFianza, setTiposFianza] = useState([]);
  const [error, setError] = useState('');

  const cargar = useCallback(
    () => api.get('/proveedores/proyectos').then(setData).catch((e) => setError(e.message)),
    []
  );
  const cargarDetalle = useCallback(
    (id) => api.get(`/proveedores/proyectos/${id}`).then(setDetalle).catch((e) => {
      // Si no carga se regresa a la lista con el aviso: quedándose en
      // "Cargando…" no queda ni botón de volver.
      setError(e.message);
      setSel(null);
      setDetalle(null);
    }),
    []
  );

  useEffect(() => { cargar(); }, [cargar]);

  // El catálogo se pide una vez y su falla se traga: es para la checklist de
  // requisitos, y sin él la pantalla sigue sirviendo para todo lo demás. Meterlo
  // al error de arriba taparía la lista de proyectos por un desplegable.
  useEffect(() => {
    api.get('/proveedores/tipos-fianza')
      .then((r) => setTiposFianza(r.tipos || []))
      .catch(() => setTiposFianza([]));
  }, []);

  // Al subir o quitar un archivo se recargan las tres cosas: la lista de
  // proyectos, el detalle abierto y las cifras de arriba, que viven en la shell.
  const recargar = useCallback(async () => {
    await cargar();
    if (sel) await cargarDetalle(sel);
    await onCambio();
  }, [cargar, cargarDetalle, sel, onCambio]);

  function abrir(id) {
    setSel(id);
    setDetalle(null);
    cargarDetalle(id);
  }

  async function borrar(p) {
    setError('');
    if (!confirm(`¿Borrar el proyecto "${p.nombre}"? Esto no borra ninguna obra ni póliza.`)) return;
    try {
      await api.del(`/proveedores/proyectos/${p.id}`);
      await cargar();
      await onCambio();
      flash('Proyecto borrado');
    } catch (e) {
      setError(e.message);
    }
  }

  if (sel) {
    return detalle ? (
      <DetalleProyecto
        detalle={detalle}
        clienteId={clienteId}
        tipos={tipos}
        tiposFianza={tiposFianza}
        onVolver={() => { setSel(null); setDetalle(null); }}
        onCambio={recargar}
        avisar={avisar}
        flash={flash}
      />
    ) : (
      <div className="text-sm text-slate-400 py-10 text-center">Cargando…</div>
    );
  }

  return (
    <>
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-700 shrink-0">✕</button>
        </div>
      )}

      <div className="flex justify-end mb-4">
        {!creando && !editando && (
          <button onClick={() => setCreando(true)} className={btnPrimary}>
            <Plus className="w-4 h-4" /> Registrar proyecto
          </button>
        )}
      </div>

      {creando && (
        <FormProyecto
          onCancel={() => setCreando(false)}
          onSubmit={async (datos) => {
            await api.post('/proveedores/proyectos', datos);
            setCreando(false);
            await cargar();
            await onCambio();
            flash('Proyecto registrado');
          }}
        />
      )}

      {editando && (
        <FormProyecto
          inicial={editando}
          onCancel={() => setEditando(null)}
          onSubmit={async (datos) => {
            await api.put(`/proveedores/proyectos/${editando.id}`, datos);
            setEditando(null);
            await cargar();
            await onCambio();
            flash('Proyecto actualizado');
          }}
        />
      )}

      <div className="space-y-2">
        {(data?.proyectos || []).map((p) => (
          <div
            key={p.id}
            className={`portal-card bg-white border rounded-lg ${
              (p.partidas_descubiertas ?? p.obras_descubiertas) > 0
                ? 'border-rose-200' : 'border-slate-200'
            }`}
          >
            <div className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button onClick={() => abrir(p.id)} className="flex-1 text-left min-w-0">
                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-2 flex-wrap">
                  <Building2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  {p.nombre}
                  {p.clave && <span className="text-[11px] font-mono text-slate-500">{p.clave}</span>}
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {etiquetaEstatus(p.estatus)}
                  {p.ubicacion && ` · ${p.ubicacion}`}
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">
                  {/* Con partidas se cuentan partidas; sin ellas, obras. Mezclar
                      las dos cuentas en un renglón haría que los números no
                      sumaran con nada. */}
                  {p.total_partidas > 0
                    ? `${p.total_partidas} partida(s) · ${p.total_proveedores} contratista(s)`
                    : `${p.total_proveedores} proveedor(es) · ${p.total_obras} obra(s)`}
                  {p.partidas_sin_contratista > 0 && (
                    <span className="text-slate-500"> · {p.partidas_sin_contratista} sin contratar</span>
                  )}
                  {(p.partidas_descubiertas ?? p.obras_descubiertas) > 0 && (
                    <span className="text-rose-600">
                      {' · '}{p.partidas_descubiertas ?? p.obras_descubiertas} sin fianza completa
                    </span>
                  )}
                  {p.monto_afianzado > 0 && (
                    <span className="text-slate-400"> · {mxn(p.monto_afianzado)} afianzado a tu favor</span>
                  )}
                </p>
              </button>
              <div className="flex items-center gap-2">
                <CumplimientoBadge
                  estado={p.cumplimiento}
                  verificada={p.total_partidas > 0 && p.partidas_sin_requisitos === 0}
                />
                <button
                  onClick={() => { setEditando(p); setCreando(false); }}
                  className={btnChico}
                  title="Editar proyecto"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => borrar(p)}
                  className={`${btnChico} hover:border-rose-300 hover:text-rose-600`}
                  title="Borrar proyecto"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}

        {data && !data.proyectos.length && !creando && (
          <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center text-sm text-slate-400">
            <span className="flex flex-col items-center gap-2">
              <Layers className="w-5 h-5 text-slate-300" />
              Todavía no tienes proyectos. Registra el primero, arma sus partidas
              —muros, electricidad, acabados— y pídele a Fortex que te asigne el
              contratista de cada una.
            </span>
          </div>
        )}
      </div>

      {/* Las obras que Fortex ya ligó pero que no están dentro de ningún
          proyecto. Se dicen para que no se pierdan de vista: son captura
          pendiente, no un proyecto vacío. */}
      {data?.obras_sin_proyecto?.length > 0 && (
        <div className="portal-card bg-white border border-amber-200 rounded-lg overflow-hidden mt-4">
          <div className="px-4 py-2.5 border-b border-amber-200 bg-amber-50 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-800">
              Obras que todavía no están en ningún proyecto ({data.obras_sin_proyecto.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {data.obras_sin_proyecto.map((o) => (
              <Obra
                key={o.id}
                obra={o}
                clienteId={clienteId}
                tipos={tipos}
                onCambio={recargar}
                avisar={avisar}
              />
            ))}
          </div>
          <p className="px-4 py-2 text-[11px] text-amber-700 border-t border-amber-100">
            Dile a Fortex en qué proyecto va cada una y aparecerán agrupadas arriba.
          </p>
        </div>
      )}
    </>
  );
}
