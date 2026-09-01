// Las PARTIDAS de un proyecto: los pedazos de obra que el desarrollador
// contrata por separado, con lo que exige cada uno.
//
// Se agrupa por partida y no por proveedor a propósito: la partida existe aunque
// nadie la esté haciendo, y agrupando por empresa una partida sin contratista no
// tendría dónde salir — que es justo el pendiente que hay que ver.
import { useState } from 'react';
import {
  Plus, Save, X, AlertTriangle, Pencil, Trash2, Layers, ShieldAlert, UserPlus,
} from 'lucide-react';
import { api } from '../api.js';
import { mxn, CumplimientoBadge, InputPesos } from '../lib.jsx';
import Obra, { btnChico } from './ObraContratante.jsx';

const inputCls =
  'w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100';
const btnPrimary =
  'flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50';

/* --------------------------------------------------------------------------
   El formulario de una partida, con la checklist de lo que exige
   -------------------------------------------------------------------------- */

export function FormPartida({ inicial, tiposFianza = [], onSubmit, onCancel }) {
  const [f, setF] = useState({
    nombre: inicial?.nombre || '',
    alcance: inicial?.alcance || '',
    monto_estimado: inicial?.monto_estimado ?? 0, // centavos
    orden: inicial?.orden ?? 50,
    notas: inicial?.notas || '',
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
      // Los requisitos van SIEMPRE, aunque vacíos: es un conjunto, y no mandarlos
      // significaría "no los toques" en vez de "no exige nada".
      await onSubmit({ ...f, requisitos: [...requisitos] });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="portal-card bg-white border border-indigo-200 rounded-lg p-4 mb-3">
      <p className="text-sm font-medium text-slate-700 mb-3">
        {inicial ? 'Editar partida' : 'Nueva partida'}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="text-[11px] text-slate-500 mb-1 block">
            Nombre de la partida<span className="text-rose-500">*</span>
          </label>
          <input value={f.nombre} onChange={set('nombre')}
                 placeholder="Muros y albañilería" className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Orden en la obra</label>
          <input type="number" value={f.orden} onChange={set('orden')} className={inputCls} />
          <p className="text-[11px] text-slate-400 mt-1">
            Menor primero: cimentación 10, acabados 90.
          </p>
        </div>
        <div className="md:col-span-2">
          <label className="text-[11px] text-slate-500 mb-1 block">Alcance</label>
          <input value={f.alcance} onChange={set('alcance')}
                 placeholder="Muros divisorios, aplanados y firmes" className={inputCls} />
        </div>
        <div>
          <label className="text-[11px] text-slate-500 mb-1 block">Monto estimado</label>
          <InputPesos
            valor={f.monto_estimado}
            onChange={(centavos) => setF((s) => ({ ...s, monto_estimado: centavos }))}
            className={inputCls}
          />
        </div>
        <div className="md:col-span-3">
          <label className="text-[11px] text-slate-500 mb-1 block">Notas</label>
          <input value={f.notas} onChange={set('notas')} className={inputCls} />
        </div>
      </div>

      {/* Lo que de verdad cambia la pantalla: sin esto, el portal no puede saber
          si a una partida le falta una fianza, y todo lo que tenga algo sale en
          verde. */}
      <div className="mt-3 border-t border-slate-100 pt-3">
        <p className="text-[11px] font-medium text-slate-600 flex items-center gap-1.5">
          <ShieldAlert className="h-3.5 w-3.5 text-slate-400" />
          Qué fianzas exiges en esta partida
        </p>
        <p className="text-[11px] text-slate-400 mb-2">
          Marca los tipos que le vas a pedir al contratista. Solo así el portal puede
          decirte <span className="font-medium">qué falta</span> en vez de solo si hay algo.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {tiposFianza.map((t) => {
            const marcado = requisitos.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => alternar(t.id)}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  marcado
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300'
                }`}
              >
                {t.nombre}
              </button>
            );
          })}
          {!tiposFianza.length && (
            <span className="text-[11px] text-slate-400">
              No se pudo cargar el catálogo de tipos de fianza. Puedes guardar la partida y
              marcarlos después.
            </span>
          )}
        </div>
        {requisitos.size === 0 && (
          <p className="text-[11px] text-amber-700 mt-2">
            Sin ningún tipo marcado, esta partida solo podrá decir “tiene fianza”, nunca
            “cubierta”.
          </p>
        )}
      </div>

      {error && (
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
      <div className="flex gap-2 mt-3">
        <button onClick={guardar} disabled={busy} className={btnPrimary}>
          <Save className="w-4 h-4" /> {busy ? 'Guardando…' : 'Guardar partida'}
        </button>
        <button onClick={onCancel} className={btnChico}><X className="h-3.5 w-3.5" /> Cancelar</button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Una partida
   -------------------------------------------------------------------------- */

function Partida({
  partida: pa, clienteId, tiposDoc, onEditar, onBorrar, onCambio, avisar,
}) {
  const enFalta = ['sin_fianza', 'vencida', 'sin_vigencia', 'incompleta']
    .includes(pa.estado_cobertura);
  // Por los CONTRATOS y no por el estado: una partida cuyo único contrato se
  // canceló también sale 'sin_contratista' —no hay cobertura que exigirle— pero
  // el contrato existe y se tiene que seguir viendo. Mirando el estado, ese
  // renglón desaparecía de la pantalla y el desarrollador no entendería por qué
  // su partida dice "sin contratista" si él firmó con alguien.
  const sinNadie = !pa.contratos.length;

  return (
    <div className={`portal-card bg-white border rounded-lg overflow-hidden ${
      enFalta ? 'border-rose-200' : sinNadie ? 'border-slate-300 border-dashed' : 'border-slate-200'
    }`}>
      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <Layers className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-slate-800">{pa.nombre}</h3>
            {pa.alcance && <p className="text-[11px] text-slate-500">{pa.alcance}</p>}
            <p className="text-[11px] text-slate-500 tabular-nums mt-0.5">
              {pa.monto_estimado > 0 && `estimado ${mxn(pa.monto_estimado)}`}
              {pa.monto_afianzado > 0 && ` · ${mxn(pa.monto_afianzado)} afianzado`}
              {pa.total_contratos > 0 && ` · ${pa.total_contratos} contrato(s)`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <CumplimientoBadge
              estado={pa.estado_cobertura}
              verificada={pa.requisitos.length > 0}
            />
            <button onClick={onEditar} className={btnChico} title="Editar partida">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={onBorrar}
              className={`${btnChico} hover:border-rose-300 hover:text-rose-600`}
              title="Borrar partida"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Lo que exige, y lo que falta. El "falta" es lo único accionable. */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-500">Exige:</span>
          {pa.requisitos.map((r) => {
            const falta = pa.faltantes.some((x) => x.tipo_fianza_id === r.tipo_fianza_id);
            return (
              <span
                key={r.tipo_fianza_id}
                className={`text-[11px] px-1.5 py-0.5 rounded border ${
                  falta
                    ? 'bg-rose-50 text-rose-700 border-rose-200 font-medium'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-100'
                }`}
                title={falta ? 'Falta: ninguna póliza vigente de este tipo' : 'Cubierto y vigente'}
              >
                {r.tipo_fianza}{falta ? ' · falta' : ''}
              </span>
            );
          })}
          {!pa.requisitos.length && (
            <span className="text-[11px] text-amber-700">
              nada capturado — el portal no puede decirte qué falta
            </span>
          )}
        </div>
      </div>

      {sinNadie ? (
        <p className="px-4 py-4 text-xs text-slate-500 flex items-start gap-2">
          <UserPlus className="h-4 w-4 text-slate-400 shrink-0 mt-px" />
          Todavía no hay contratista asignado a esta partida. Cuando lo contrates, dile a
          Fortex y te ligan su obra aquí con sus fianzas.
        </p>
      ) : (
        <div className="divide-y divide-slate-100">
          {pa.contratos.map((o) => (
            <Obra
              key={o.id}
              obra={o}
              clienteId={clienteId}
              tipos={tiposDoc}
              onCambio={onCambio}
              avisar={avisar}
              conProveedor={o.proveedor_nombre}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   La lista de partidas de un proyecto
   -------------------------------------------------------------------------- */

export default function PartidasContratante({
  proyecto, clienteId, tiposDoc, tiposFianza, onCambio, avisar, flash,
}) {
  const [creando, setCreando] = useState(false);
  const [editando, setEditando] = useState(null);
  const [error, setError] = useState('');

  const partidas = proyecto?.partidas || [];
  const sinPartida = proyecto?.obras_sin_partida || [];

  async function borrar(pa) {
    setError('');
    if (!confirm(`¿Borrar la partida "${pa.nombre}"? No borra ninguna obra ni póliza.`)) return;
    try {
      await api.del(`/proveedores/partidas/${pa.id}`);
      await onCambio();
      flash('Partida borrada');
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Layers className="w-4 h-4 text-indigo-600" />
          Partidas ({partidas.length})
        </h3>
        {!creando && !editando && (
          <button onClick={() => setCreando(true)} className={btnPrimary}>
            <Plus className="w-4 h-4" /> Agregar partida
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 flex items-start gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-rose-400 hover:text-rose-700 shrink-0">✕</button>
        </div>
      )}

      {creando && (
        <FormPartida
          tiposFianza={tiposFianza}
          onCancel={() => setCreando(false)}
          onSubmit={async (datos) => {
            await api.post(`/proveedores/proyectos/${proyecto.id}/partidas`, datos);
            setCreando(false);
            await onCambio();
            flash('Partida agregada');
          }}
        />
      )}
      {editando && (
        <FormPartida
          inicial={editando}
          tiposFianza={tiposFianza}
          onCancel={() => setEditando(null)}
          onSubmit={async (datos) => {
            await api.put(`/proveedores/partidas/${editando.id}`, datos);
            setEditando(null);
            await onCambio();
            flash('Partida actualizada');
          }}
        />
      )}

      <div className="space-y-3">
        {partidas.map((pa) => (
          <Partida
            key={pa.id}
            partida={pa}
            clienteId={clienteId}
            tiposDoc={tiposDoc}
            onEditar={() => { setEditando(pa); setCreando(false); }}
            onBorrar={() => borrar(pa)}
            onCambio={onCambio}
            avisar={avisar}
          />
        ))}

        {!partidas.length && !creando && (
          <div className="bg-white border border-dashed border-slate-300 rounded-lg p-10 text-center text-sm text-slate-400">
            <span className="flex flex-col items-center gap-2">
              <Layers className="w-5 h-5 text-slate-300" />
              Este proyecto todavía no tiene partidas. Agrega los pedazos que vas a
              contratar por separado —muros, electricidad, acabados— y qué fianza le
              exiges a cada uno.
            </span>
          </div>
        )}
      </div>

      {/* Contratos que están en el proyecto pero en ninguna partida. Es el estado
          de todo lo capturado antes de que las partidas existieran, así que se
          dice en vez de esconderlo. */}
      {sinPartida.length > 0 && (
        <div className="portal-card bg-white border border-amber-200 rounded-lg overflow-hidden mt-4">
          <div className="px-4 py-2.5 border-b border-amber-200 bg-amber-50 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="text-sm font-semibold text-amber-800">
              Contratos que todavía no están en ninguna partida ({sinPartida.length})
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {sinPartida.map((o) => (
              <Obra
                key={o.id}
                obra={o}
                clienteId={clienteId}
                tipos={tiposDoc}
                onCambio={onCambio}
                avisar={avisar}
                conProveedor={o.proveedor_nombre}
              />
            ))}
          </div>
          <p className="px-4 py-2 text-[11px] text-amber-700 border-t border-amber-100">
            Dile a Fortex a qué partida va cada uno y aparecerán agrupados arriba.
          </p>
        </div>
      )}
    </>
  );
}
