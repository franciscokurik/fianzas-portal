import { useEffect, useRef, useState } from 'react';
import { Upload, Loader2, AlertTriangle, FileText, Files } from 'lucide-react';
import { api } from '../api.js';
import { fmtDate, EstadoBadge } from '../lib.jsx';

function SubirBtn({ onFile, busy }) {
  const ref = useRef();
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        onChange={(e) => e.target.files[0] && onFile(e.target.files[0])}
      />
      <button
        onClick={() => ref.current.click()}
        disabled={busy}
        className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300 disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {busy ? 'Subiendo…' : 'Subir archivo'}
      </button>
    </>
  );
}

function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-500" />
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function Documentos() {
  const [docs, setDocs] = useState([]);
  const [papeleria, setPapeleria] = useState([]);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const cargar = () => {
    api.get('/documentos').then((d) => setDocs(d.documentos));
    api.get('/documentos/papeleria').then((d) => setPapeleria(d.papeleria));
  };
  useEffect(cargar, []);

  async function subir(url, key, file) {
    setError(''); setBusyId(key);
    try {
      const fd = new FormData();
      fd.append('archivo', file);
      await api.upload(url, fd);
      cargar();
    } catch (e) { setError(e.message); }
    finally { setBusyId(null); }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">No se pudo subir el archivo</div>
            <div className="text-rose-600/80 text-xs">{error}</div>
          </div>
        </div>
      )}

      {/* Documentos estándar */}
      <SectionCard icon={FileText} title="Documentos estándar">
        <div className="divide-y divide-slate-100">
          {docs.map((d) => (
            <div key={d.document_type_id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50/40">
              <div className="flex-1 min-w-[220px]">
                <p className="text-sm font-medium text-slate-700">{d.nombre}</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {d.periodicidad_meses ? `Vence cada ${d.periodicidad_meses} meses` : 'Sin vencimiento'}
                  {d.uploaded_at && ` · Último: ${fmtDate(d.uploaded_at)}`}
                  {d.vencimiento && ` · Vence: ${fmtDate(d.vencimiento)}`}
                </p>
              </div>
              <EstadoBadge estado={d.estado} />
              <SubirBtn busy={busyId === `doc-${d.document_type_id}`} onFile={(f) => subir(`/documentos/${d.document_type_id}`, `doc-${d.document_type_id}`, f)} />
            </div>
          ))}
        </div>
        <div className="px-4 py-2.5 border-t border-slate-100 text-[11px] text-slate-400">
          Formatos: PDF, JPG, PNG · máximo 10 MB
        </div>
      </SectionCard>

      {/* Papelería específica por afianzadora */}
      <SectionCard icon={Files} title="Papelería específica por afianzadora">
        {papeleria.length === 0 ? (
          <div className="px-4 py-6 text-xs text-slate-400 text-center">
            No tienes solicitudes específicas por el momento.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {papeleria.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-slate-50/40">
                <div className="flex-1 min-w-[220px]">
                  <p className="text-sm font-medium text-slate-700">{p.descripcion}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {p.afianzadora_nombre}
                    {p.numero_poliza && ` · Póliza ${p.numero_poliza}`}
                  </p>
                </div>
                <EstadoBadge estado={p.estado} />
                {p.estado === 'pendiente' && (
                  <SubirBtn busy={busyId === `pap-${p.id}`} onFile={(f) => subir(`/documentos/papeleria/${p.id}`, `pap-${p.id}`, f)} />
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
