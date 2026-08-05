import { useEffect, useMemo, useState } from 'react';
import { Briefcase } from 'lucide-react';
import { api } from '../api.js';
import { mxn, mxnCents, fmtDate, EstadoBadge } from '../lib.jsx';

// Tinte sutil de fila por estado (sin stripes; solo semántico)
const filaCls = (estado) =>
  estado === 'vencida' ? 'bg-rose-50/40'
  : estado === 'por_vencer' ? 'bg-amber-50/40'
  : '';

const chipCls = (activo) =>
  `text-xs px-3 py-1.5 rounded-md border transition-colors ${
    activo
      ? 'bg-indigo-600 border-indigo-600 text-white'
      : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300'
  }`;

export default function MisFianzas() {
  const [afianzadoras, setAfianzadoras] = useState([]);
  const [sel, setSel] = useState('todas'); // 'todas' | id de afianzadora
  const [fianzas, setFianzas] = useState([]);

  useEffect(() => {
    api.get('/fianzas/afianzadoras').then((d) => setAfianzadoras(d.afianzadoras));
  }, []);

  useEffect(() => {
    const q = sel === 'todas' ? '' : `?afianzadora_id=${sel}`;
    api.get(`/fianzas${q}`).then((d) => setFianzas(d.fianzas));
  }, [sel]);

  // Las fianzas vienen ordenadas por proyecto; aquí solo se agrupan.
  const grupos = useMemo(() => {
    const porProyecto = new Map();
    for (const f of fianzas) {
      const clave = f.proyecto_id ?? 'sin-proyecto';
      if (!porProyecto.has(clave)) {
        porProyecto.set(clave, {
          clave,
          nombre: f.proyecto_nombre || 'Sin proyecto asignado',
          numero_contrato: f.numero_contrato,
          monto_contrato: f.monto_contrato,
          fianzas: [],
        });
      }
      porProyecto.get(clave).fianzas.push(f);
    }
    return [...porProyecto.values()].map((g) => ({
      ...g,
      // El afianzado del proyecto solo cuenta lo que sigue vigente.
      monto_afianzado: g.fianzas
        .filter((f) => f.estado !== 'vencida')
        .reduce((s, f) => s + (f.monto_afianzado || 0), 0),
      prima_total: g.fianzas.reduce((s, f) => s + (f.prima_neta || 0), 0),
    }));
  }, [fianzas]);

  if (!afianzadoras.length) {
    return (
      <div className="px-4 py-6 text-xs text-slate-400 text-center">
        Aún no tienes fianzas registradas.
      </div>
    );
  }

  return (
    <div>
      {/* Filtro por afianzadora */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button onClick={() => setSel('todas')} className={chipCls(sel === 'todas')}>
          Todas
        </button>
        {afianzadoras.map((a) => (
          <button key={a.id} onClick={() => setSel(a.id)} className={chipCls(sel === a.id)}>
            {a.nombre} <span className={sel === a.id ? 'text-indigo-200' : 'text-slate-400'}>({a.total})</span>
          </button>
        ))}
      </div>

      {/* Un bloque por proyecto */}
      <div className="space-y-4">
        {grupos.map((g) => (
          <div key={g.clave} className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Briefcase className="w-4 h-4 text-slate-500 shrink-0" />
              <h3 className="text-sm font-semibold text-slate-700">{g.nombre}</h3>
              {g.numero_contrato && (
                <span className="text-[11px] font-mono text-slate-500">{g.numero_contrato}</span>
              )}
              <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                {g.monto_contrato > 0 && (
                  <span>Contrato <span className="tabular-nums text-slate-700">{mxn(g.monto_contrato)}</span></span>
                )}
                <span>
                  Afianzado{' '}
                  <span className="tabular-nums font-semibold text-slate-800">{mxn(g.monto_afianzado)}</span>
                  {g.monto_contrato > 0 && (
                    <span className="text-slate-400">
                      {' '}· {Math.round((g.monto_afianzado / g.monto_contrato) * 100)}% del contrato
                    </span>
                  )}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-2">N° de póliza</th>
                    <th className="text-left px-3 py-2">Afianzadora</th>
                    <th className="text-left px-3 py-2">Tipo de fianza</th>
                    <th className="text-right px-3 py-2">Monto afianzado</th>
                    <th className="text-right px-3 py-2">Prima neta</th>
                    <th className="text-left px-3 py-2">Vigencia</th>
                    <th className="text-left px-3 py-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {g.fianzas.map((f) => (
                    <tr key={f.id} className={`hover:bg-slate-50/40 ${filaCls(f.estado)}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-700">{f.numero_poliza}</td>
                      <td className="px-3 py-1.5 text-slate-600">{f.afianzadora_nombre}</td>
                      <td className="px-3 py-1.5 text-slate-700 font-medium">{f.tipo_fianza}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">
                        {mxnCents(f.monto_afianzado)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{mxnCents(f.prima_neta)}</td>
                      <td className="px-3 py-1.5 text-slate-600">{fmtDate(f.fecha_vigencia)}</td>
                      <td className="px-3 py-1.5"><EstadoBadge estado={f.estado} /></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50/60 text-slate-600">
                  <tr>
                    <td colSpan={3} className="px-3 py-1.5 text-right text-[11px] uppercase tracking-wider">
                      Total vigente
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">
                      {mxnCents(g.monto_afianzado)}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{mxnCents(g.prima_total)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        ))}

        {!grupos.length && (
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-8 text-center text-sm text-slate-400">
            Sin fianzas para este filtro.
          </div>
        )}
      </div>
    </div>
  );
}
