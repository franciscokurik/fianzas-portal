// El PADRÓN: la lista de proveedores del contratante, ordenada por quien debe
// algo. Es la otra forma de ver lo mismo que los proyectos — por empresa en vez
// de por obra— y sirve para la pregunta que se hace de mañana: ¿a quién le
// falta la fianza?
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Users, ChevronRight, ArrowLeft } from 'lucide-react';
import { api } from '../api.js';
import { mxn, CumplimientoBadge, estaDescubierta } from '../lib.jsx';
import Obra, { btnChico } from './ObraContratante.jsx';

function Renglon({ proveedor, onAbrir }) {
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
            {proveedor?.notas && <p className="text-[11px] text-slate-400 mt-1">{proveedor.notas}</p>}
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

export default function PadronContratante({
  proveedores: lista = [], clienteId, tipos, soloEnFalta, onCambio, avisar,
}) {
  const [sel, setSel] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const [error, setError] = useState('');

  const cargarDetalle = useCallback(
    (id) => api.get(`/proveedores/${id}`).then(setDetalle).catch((e) => {
      setError(e.message);
      setSel(null);
      setDetalle(null);
    }),
    []
  );

  // Si el proveedor abierto desaparece del padrón —lo suspendieron mientras la
  // pestaña estaba abierta— se regresa a la lista en vez de dejar en pantalla un
  // detalle que ya no existe.
  useEffect(() => {
    if (sel && lista.length && !lista.some((p) => p.id === sel)) {
      setSel(null);
      setDetalle(null);
    }
  }, [lista, sel]);

  const recargar = useCallback(async () => {
    if (sel) await cargarDetalle(sel);
    await onCambio();
  }, [cargarDetalle, sel, onCambio]);

  // Los que deben algo, primero. Es el orden que hace útil la pantalla: quien
  // entra a las nueve de la mañana quiere ver el renglón rojo, no la lista
  // alfabética completa.
  const proveedores = useMemo(() => {
    const filtrada = lista.filter((p) => !soloEnFalta || p.obras_descubiertas > 0);
    const peso = (p) => (p.obras_descubiertas > 0 ? 0
      : estaDescubierta(p.cumplimiento) || p.cumplimiento === 'por_vencer' ? 1 : 2);
    return [...filtrada].sort(
      (a, b) => peso(a) - peso(b) || a.razon_social.localeCompare(b.razon_social, 'es')
    );
  }, [lista, soloEnFalta]);

  if (sel) {
    return detalle ? (
      <DetalleProveedor
        detalle={detalle}
        clienteId={clienteId}
        tipos={tipos}
        onVolver={() => { setSel(null); setDetalle(null); }}
        onCambio={recargar}
        avisar={avisar}
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

      <div className="space-y-2">
        {proveedores.map((p) => (
          <Renglon key={p.id} proveedor={p} onAbrir={() => { setSel(p.id); setDetalle(null); cargarDetalle(p.id); }} />
        ))}

        {!proveedores.length && (
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
  );
}
