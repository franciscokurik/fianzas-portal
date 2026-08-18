import { useEffect, useMemo, useState } from 'react';
import { Briefcase, Paperclip, FileDown } from 'lucide-react';
import { api, getToken } from '../api.js';
import { mxn, mxnCents, fmtDate, EstadoBadge, ClaseBadge } from '../lib.jsx';

// La descarga pasa por la API (que comprueba que el archivo sea de este
// cliente), así que hay que mandar el token: un <a href> no lo llevaría.
async function descargarDocumento(doc) {
  const res = await fetch(`/api/fianzas/documentos/${doc.id}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) return;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.nombre_archivo;
  a.click();
  URL.revokeObjectURL(url);
}

function Documentos({ documentos = [], vacio = '—' }) {
  if (!documentos.length) return <span className="text-slate-300">{vacio}</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {documentos.map((d) => (
        <button
          key={d.id}
          onClick={() => descargarDocumento(d)}
          className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
          title={d.nombre_archivo}
        >
          <FileDown className="h-3 w-3" /> {d.tipo_doc_nombre}
        </button>
      ))}
    </div>
  );
}

// Tinte sutil de fila por estado (sin stripes; solo semántico)
const filaCls = (estado) =>
  estado === 'vencida' ? 'bg-rose-50/40'
  : estado === 'por_vencer' ? 'bg-amber-50/40'
  // El previo no es un problema, solo algo que todavía no existe como póliza.
  : estado === 'previo' ? 'bg-violet-50/30'
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
          // El contrato de la obra viene igual en todas sus fianzas.
          documentos: f.documentos_proyecto || [],
          fianzas: [],
        });
      }
      porProyecto.get(clave).fianzas.push(f);
    }
    return [...porProyecto.values()].map((g) => {
      // Los previos se listan pero no suman: son lo que se pidió, no lo que la
      // afianzadora emitió. Nada de lo que está aquí se ha pagado todavía.
      const emitidas = g.fianzas.filter((f) => f.clase !== 'previo');
      return {
        ...g,
        // El afianzado del proyecto solo cuenta lo que sigue vigente.
        monto_afianzado: emitidas
          .filter((f) => f.estado !== 'vencida')
          .reduce((s, f) => s + (f.monto_afianzado || 0), 0),
        // Las primas suman todas: lo pagado no se devuelve porque la fianza venza.
        suma_prima_neta: emitidas.reduce((s, f) => s + (f.prima_neta || 0), 0),
        suma_prima_total: emitidas.reduce((s, f) => s + (f.prima_total || 0), 0),
      };
    });
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
      <div className="portal-filters flex flex-wrap gap-2 mb-4">
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
          <div key={g.clave} className="portal-card portal-policy-card bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="portal-card-header px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center gap-x-3 gap-y-1">
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

            {g.documentos.length > 0 && (
              <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2 flex-wrap">
                <Paperclip className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span className="text-[11px] text-slate-500 shrink-0">Documentos de la obra:</span>
                <Documentos documentos={g.documentos} />
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="text-left px-3 py-2">N° de póliza</th>
                    <th className="text-left px-3 py-2">Afianzadora</th>
                    <th className="text-left px-3 py-2">Tipo de fianza</th>
                    <th className="text-right px-3 py-2">Monto afianzado</th>
                    {/* Las dos primas en una columna: la total (lo que pagas)
                        arriba y la neta debajo, para no ensanchar la tabla. */}
                    <th className="text-right px-3 py-2">Prima total</th>
                    <th className="text-left px-3 py-2">Vigencia</th>
                    <th className="text-left px-3 py-2">Estado</th>
                    <th className="text-left px-3 py-2">Documentos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {g.fianzas.map((f) => (
                    <tr key={f.id} className={`hover:bg-slate-50/40 ${filaCls(f.estado)}`}>
                      <td className="px-3 py-1.5 text-slate-700">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono">{f.numero_poliza}</span>
                          <ClaseBadge clase={f.clase} />
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600">{f.afianzadora_nombre}</td>
                      <td className="px-3 py-1.5 text-slate-700 font-medium">{f.tipo_fianza}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">
                        {mxnCents(f.monto_afianzado)}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                        {mxnCents(f.prima_total)}
                        <span className="block text-[10px] text-slate-400">neta {mxnCents(f.prima_neta)}</span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{fmtDate(f.fecha_vigencia)}</td>
                      <td className="px-3 py-1.5"><EstadoBadge estado={f.estado} /></td>
                      <td className="px-3 py-1.5"><Documentos documentos={f.documentos} /></td>
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
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {mxnCents(g.suma_prima_total)}
                      <span className="block text-[10px] text-slate-400 font-normal">
                        neta {mxnCents(g.suma_prima_neta)}
                      </span>
                    </td>
                    <td colSpan={3} />
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
