import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { mxnCents, fmtDate, EstadoBadge } from '../lib.jsx';

// Tinte sutil de fila por estado (sin stripes; solo semántico)
const filaCls = (estado) =>
  estado === 'vencida' ? 'bg-rose-50/40'
  : estado === 'por_vencer' ? 'bg-amber-50/40'
  : '';

export default function MisFianzas() {
  const [afianzadoras, setAfianzadoras] = useState([]);
  const [sel, setSel] = useState(null);
  const [fianzas, setFianzas] = useState([]);

  useEffect(() => {
    api.get('/fianzas/afianzadoras').then((d) => {
      setAfianzadoras(d.afianzadoras);
      if (d.afianzadoras.length) setSel(d.afianzadoras[0].id);
    });
  }, []);

  useEffect(() => {
    if (sel == null) return;
    api.get(`/fianzas?afianzadora_id=${sel}`).then((d) => setFianzas(d.fianzas));
  }, [sel]);

  if (!afianzadoras.length) {
    return (
      <div className="px-4 py-6 text-xs text-slate-400 text-center">
        Aún no tienes fianzas registradas.
      </div>
    );
  }

  return (
    <div>
      {/* Botones por afianzadora */}
      <div className="flex flex-wrap gap-2 mb-3">
        {afianzadoras.map((a) => (
          <button
            key={a.id}
            onClick={() => setSel(a.id)}
            className={`text-xs px-3 py-1.5 rounded-md border transition-colors ${
              sel === a.id
                ? 'bg-indigo-600 border-indigo-600 text-white'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300'
            }`}
          >
            {a.nombre} <span className={sel === a.id ? 'text-indigo-200' : 'text-slate-400'}>({a.total})</span>
          </button>
        ))}
      </div>

      {/* Tabla */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
              <tr>
                <th className="text-left px-3 py-2">N° de póliza</th>
                <th className="text-left px-3 py-2">Tipo de fianza</th>
                <th className="text-right px-3 py-2">Prima neta</th>
                <th className="text-left px-3 py-2">Vigencia</th>
                <th className="text-left px-3 py-2">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fianzas.map((f) => (
                <tr key={f.id} className={`hover:bg-slate-50/40 ${filaCls(f.estado)}`}>
                  <td className="px-3 py-1.5 font-mono text-slate-700">{f.numero_poliza}</td>
                  <td className="px-3 py-1.5 text-slate-700 font-medium">{f.tipo_fianza}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{mxnCents(f.prima_neta)}</td>
                  <td className="px-3 py-1.5 text-slate-600">{fmtDate(f.fecha_vigencia)}</td>
                  <td className="px-3 py-1.5"><EstadoBadge estado={f.estado} /></td>
                </tr>
              ))}
              {!fianzas.length && (
                <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin fianzas para esta afianzadora.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
