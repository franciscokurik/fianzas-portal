// La obra de un proveedor vista por el CONTRATANTE.
//
// Vive aquí y no en una pantalla porque se pinta en las dos: dentro del proyecto
// (agrupada por proveedor) y dentro del proveedor (agrupada por obra). Es el
// mismo renglón con las mismas reglas, y tenerlo dos veces era garantía de que
// se separaran.
import { useState } from 'react';
import {
  AlertTriangle, Briefcase, FileDown, Upload, Paperclip, Trash2,
} from 'lucide-react';
import { api, getToken, subirACloudinary } from '../api.js';
import {
  mxn, mxnCents, fmtDate, EstadoBadge, ClaseBadge, CumplimientoBadge,
  etiquetaEstatus, ACCEPT_ARCHIVOS, AYUDA_ARCHIVOS, pesoArchivo, revisarArchivo,
} from '../lib.jsx';

export const btnChico =
  'inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-indigo-300';

// La descarga pasa por la API, que vuelve a comprobar que ese archivo sea de una
// obra que este contratante alcanza. Un <a href> no llevaría el token.
//
// Si falla, HAY QUE DECIRLO: mientras la pestaña está abierta, Fortex puede haber
// dado de baja el documento o suspendido al proveedor, y entonces la API contesta
// 404. Tragándose el error, el usuario aprieta tres veces y concluye que el
// portal está roto.
export async function descargar(doc, avisar) {
  try {
    const res = await fetch(`/api/proveedores/documentos/${doc.id}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      avisar('No se pudo descargar el archivo. Puede que ya no esté disponible; recarga la página.');
      return;
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = doc.nombre_archivo;
    a.click();
    URL.revokeObjectURL(url);
  } catch {
    avisar('No se pudo descargar el archivo. Revisa tu conexión e inténtalo de nuevo.');
  }
}

// Tinte de fila por cumplimiento: el mismo lenguaje de color del resto del
// portal (rose = hay que actuar, amber = pronto, emerald = al día).
export const filaCls = (estado) =>
  estado === 'sin_fianza' || estado === 'vencida' ? 'bg-rose-50/40'
  : estado === 'por_vencer' || estado === 'sin_vigencia' ? 'bg-amber-50/40'
  : '';

/* -------------------------------------------------------------------------- */

function Fianzas({ obra, avisar }) {
  if (!obra.fianzas.length) {
    return (
      <p className="px-4 py-3 text-xs text-slate-400">
        No hay ninguna fianza registrada en Fortex para esta obra.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-slate-50/60 text-slate-500 uppercase tracking-wider text-[10px]">
          <tr>
            <th className="text-left px-3 py-2">N° de póliza</th>
            <th className="text-left px-3 py-2">Tipo de fianza</th>
            <th className="text-left px-3 py-2">Afianzadora</th>
            <th className="text-right px-3 py-2">Monto afianzado</th>
            <th className="text-left px-3 py-2">Vigencia</th>
            <th className="text-left px-3 py-2">Estado</th>
            <th className="text-left px-3 py-2">Carátula</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {obra.fianzas.map((f) => (
            <tr key={f.id} className="hover:bg-slate-50/40">
              <td className="px-3 py-1.5">
                <span className="flex items-center gap-1.5">
                  <span className="font-mono text-slate-700">{f.numero_poliza}</span>
                  <ClaseBadge clase={f.clase} />
                </span>
              </td>
              <td className="px-3 py-1.5 text-slate-700 font-medium">{f.tipo_fianza}</td>
              <td className="px-3 py-1.5 text-slate-600">{f.afianzadora_nombre}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-slate-800">
                {mxnCents(f.monto_afianzado)}
              </td>
              <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">{fmtDate(f.fecha_vigencia)}</td>
              <td className="px-3 py-1.5"><EstadoBadge estado={f.estado} /></td>
              <td className="px-3 py-1.5">
                {f.documentos.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {f.documentos.map((d) => (
                      <button
                        key={d.id}
                        onClick={() => descargar(d, avisar)}
                        className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
                        title={d.nombre_archivo}
                      >
                        <FileDown className="h-3 w-3" /> {d.tipo_doc_nombre}
                      </button>
                    ))}
                  </div>
                ) : <span className="text-slate-300">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* --------------------------------------------------------------------------
   La carpeta de la obra: lo que el contratante recibió o guarda
   --------------------------------------------------------------------------
   Es SU carpeta, no la del proveedor: el archivo se sube bajo su propia cuenta
   y el proveedor no lo ve. Y un PDF aquí NO es una póliza capturada — no mueve
   ninguna cifra de la pantalla. Es el papel que respalda que sí la presentó, y
   le sirve a Fortex para capturarla si acaba colocándola. */

function CarpetaDeObra({ obra, clienteId, tipos, onCambio, avisar }) {
  const [tipoDoc, setTipoDoc] = useState(tipos[0]?.clave || 'fianza_presentada');
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState('');
  const docs = obra.mis_documentos || [];

  async function subir(archivo) {
    if (!archivo) return;
    setError('');
    // Se revisa aquí, antes de pedir la firma: así el usuario se entera de que
    // su escaneo no cabe ANTES de esperar a que se suban ocho megas.
    const problema = revisarArchivo(archivo);
    if (problema) return setError(problema);

    setSubiendo(true);
    try {
      // Va directo a Cloudinary, bajo la carpeta de ESTE contratante; a la API
      // solo se le dice dónde quedó.
      const subido = await subirACloudinary(clienteId, archivo);
      await api.post(`/proveedores/obras/${obra.id}/documentos`, { ...subido, tipo_doc: tipoDoc });
      await onCambio();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubiendo(false);
    }
  }

  async function quitar(id) {
    setError('');
    try {
      await api.del(`/proveedores/documentos/${id}`);
      await onCambio();
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/40">
      <p className="text-xs font-medium text-slate-600">
        Documentos que recibiste de esta obra
        <span className="font-normal text-slate-400"> · son tuyos: el proveedor no los ve</span>
      </p>

      {docs.length > 0 && (
        <div className="mt-2 divide-y divide-slate-100 border border-slate-200 rounded-lg bg-white">
          {docs.map((d) => (
            <div key={d.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <Paperclip className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              <span className="font-medium text-slate-700 shrink-0">{d.tipo_doc_nombre}</span>
              <span className="text-slate-500 truncate">{d.nombre_archivo}</span>
              <span className="text-slate-400 tabular-nums shrink-0">{pesoArchivo(d.size_bytes)}</span>
              {/* Quién lo consiguió. Importa: "lo cargó Fortex" quiere decir que
                  el proveedor se lo entregó a ellos, no a ti. */}
              {d.subido_por === 'fortex' && (
                <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 shrink-0">
                  lo cargó Fortex
                </span>
              )}
              <button onClick={() => descargar(d, avisar)} className={`${btnChico} ml-auto shrink-0`}>
                <FileDown className="h-3.5 w-3.5" /> Ver
              </button>
              <button
                onClick={() => quitar(d.id)}
                className={`${btnChico} hover:border-rose-300 hover:text-rose-600 shrink-0`}
                title="Quitar este documento"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          value={tipoDoc}
          onChange={(e) => setTipoDoc(e.target.value)}
          className="text-xs px-2 py-1.5 rounded-md border border-slate-200 bg-white text-slate-700"
          disabled={!tipos.length}
        >
          {tipos.map((t) => <option key={t.clave} value={t.clave}>{t.nombre}</option>)}
        </select>
        <label className={`${btnChico} cursor-pointer ${
          subiendo || !tipos.length ? 'opacity-50 pointer-events-none' : ''
        }`}>
          <Upload className="h-3.5 w-3.5" />
          {subiendo ? 'Subiendo…' : 'Subir archivo'}
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
        <div className="mt-2 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------------
   Una obra: encabezado, pólizas y carpeta
   -------------------------------------------------------------------------- */

export default function Obra({ obra, clienteId, tipos = [], onCambio, avisar, conProveedor }) {
  return (
    /* Una obra cerrada o cancelada NO se tiñe de rojo ni lleva chip de
       cumplimiento: no hay cobertura que exigirle, y el servidor ya la dejó
       fuera de los KPIs. En su lugar se dice el estatus, que es el dato que
       explica por qué no se está juzgando. */
    <div className={obra.viva ? filaCls(obra.estado_cobertura) : ''}>
      <div className="px-4 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Briefcase className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <span className={`text-sm font-medium ${obra.viva ? 'text-slate-700' : 'text-slate-500'}`}>
          {conProveedor ? `${conProveedor} · ` : ''}{obra.nombre}
        </span>
        {/* Lo que le falta a ESTA obra, no a la partida. Va aquí porque la
            fianza la presenta esta empresa por este contrato: en el renglón de
            la partida el reclamo no tendría a quién dirigirse cuando hay dos
            contratistas. */}
        {obra.faltantes?.length > 0 && (
          <span
            className="text-[11px] px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200 font-medium"
            title="Ninguna póliza vigente de este tipo para esta obra"
          >
            falta {obra.faltantes.map((f) => f.tipo_fianza).join(' y ')}
          </span>
        )}
        {obra.numero_contrato && (
          <span className="text-[11px] font-mono text-slate-500">{obra.numero_contrato}</span>
        )}
        <div className="ml-auto flex items-center gap-3 text-[11px] text-slate-500">
          {obra.monto_contrato > 0 && (
            <span>Contrato <span className="tabular-nums text-slate-700">{mxn(obra.monto_contrato)}</span></span>
          )}
          {obra.viva && obra.monto_contrato > 0 && obra.monto_afianzado > 0 && (
            <span className="text-slate-400">
              {Math.round((obra.monto_afianzado / obra.monto_contrato) * 100)}% afianzado
            </span>
          )}
          {obra.viva ? (
            <CumplimientoBadge
              estado={obra.estado_cobertura}
              verificada={obra.cobertura_verificada}
            />
          ) : (
            <span
              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded font-medium bg-slate-100 text-slate-500 whitespace-nowrap"
              title="Esta obra ya no se juzga: no hay cobertura que exigir."
            >
              {etiquetaEstatus(obra.estatus)}
            </span>
          )}
        </div>
      </div>
      <Fianzas obra={obra} avisar={avisar} />
      <CarpetaDeObra
        obra={obra}
        clienteId={clienteId}
        tipos={tipos}
        onCambio={onCambio}
        avisar={avisar}
      />
    </div>
  );
}
