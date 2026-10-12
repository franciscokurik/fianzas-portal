// El portal del FIADO: lo que tiene afianzado, lo que paga y lo que le falta.
//
// Usa el mismo sistema de diseño que el panel de Fortex (ClienteShell y las
// piezas de components/fx.jsx). Hasta el 12 de octubre de 2026 tenía su propia
// cáscara, y por eso se quedó con el diseño viejo cuando el panel se rediseñó.
import { useEffect, useState } from 'react';
import {
  FileText, AlertTriangle, Wallet, CreditCard, ShieldCheck, Receipt, CalendarClock,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { mxn } from '../lib.jsx';
import ClienteShell from '../components/ClienteShell.jsx';
import { Cifra, EncabezadoPagina, TiraPestanas } from '../components/fx.jsx';
import MisFianzas from '../components/MisFianzas.jsx';
import Documentos from '../components/Documentos.jsx';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState('fianzas');

  useEffect(() => {
    api.get('/dashboard').then(setData).catch(console.error);
  }, []);

  const m = data?.metricas;
  const a = data?.alertas;
  const pendientes = [];
  if (m?.fianzas_por_vencer > 0) pendientes.push(`${m.fianzas_por_vencer} fianza(s) por vencer`);
  if (a?.documentos_pendientes > 0) pendientes.push(`${a.documentos_pendientes} documento(s) faltante(s)`);
  if (a?.papeleria_pendiente > 0) pendientes.push(`${a.papeleria_pendiente} solicitud(es) de papelería`);

  const empresa = data?.razon_social || user?.razon_social;

  return (
    <ClienteShell nombre={user?.nombre} empresa={empresa} onSalir={logout}>
      <div className="space-y-5">
        <EncabezadoPagina
          titulo={empresa || 'Mi panel'}
          sub={`Resumen de tus fianzas y documentación${
            m?.proyectos_activos > 0 ? ` · ${m.proyectos_activos} proyecto(s) en proceso` : ''
          }`}
        />

        {pendientes.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">Tienes pendientes:</span> {pendientes.join(' · ')}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Cifra tono="ok" icono={<Wallet className="h-5 w-5" />}
                 label="Línea disponible total" valor={mxn(m?.linea_disponible)}
                 sub={m ? `de ${mxn(m.linea_credito_total)} autorizado` : null} />
          {/* Monto afianzado = lo que CUBREN las fianzas. Prima = lo que se PAGA por ellas.
              Los previos no entran en ninguna de las dos cifras (todavía no se
              emiten), así que se dicen aparte para que no parezca que faltan. */}
          <Cifra tono="brand" icono={<ShieldCheck className="h-5 w-5" />}
                 label="Monto afianzado" valor={mxn(m?.monto_afianzado_total)}
                 sub={m
                   ? `cubierto por ${m.fianzas_activas} fianza(s) vigente(s)`
                     + (m.previos_en_tramite > 0 ? ` · ${m.previos_en_tramite} previo(s) en trámite` : '')
                   : null} />
          {/* La cifra es la prima TOTAL porque es la que el fiado reconoce de su
              recibo; la neta va abajo para cuadrar con la afianzadora. */}
          <Cifra tono="neutral" icono={<Receipt className="h-5 w-5" />}
                 label="Prima total pagada" valor={mxn(m?.suma_prima_total)}
                 sub={m ? `prima neta ${mxn(m.suma_prima_neta)}` : 'lo que pagas por tus fianzas'} />
          {/* Ámbar solo si hay algo que renovar: en cero no es un aviso. */}
          <Cifra tono={m?.fianzas_por_vencer > 0 ? 'warn' : 'neutral'} icono={<CalendarClock className="h-5 w-5" />}
                 label="Por vencer (< 60 días)" valor={m?.fianzas_por_vencer ?? '—'}
                 sub={m ? (m.fianzas_por_vencer > 0 ? 'conviene renovarlas ya' : 'ninguna renovación urgente') : null} />
        </div>

        {m?.lineas?.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100">
              <CreditCard className="w-4 h-4 text-slate-400" />
              <h3 className="font-semibold text-slate-800 text-sm">Líneas de crédito por afianzadora</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 text-slate-400 uppercase tracking-wide text-[10px] font-semibold whitespace-nowrap">
                  <tr>
                    <th className="text-left px-5 py-2">Afianzadora</th>
                    <th className="text-right px-3 py-2">Línea autorizada</th>
                    <th className="text-right px-3 py-2">Comprometido</th>
                    <th className="text-right px-5 py-2">Disponible</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {m.lineas.map((l) => (
                    <tr key={l.afianzadora_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-2 text-slate-700 font-medium">{l.afianzadora_nombre}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{mxn(l.linea_credito)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{mxn(l.comprometido)}</td>
                      <td className={`px-5 py-2 text-right tabular-nums font-semibold ${l.disponible < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {mxn(l.disponible)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div>
          <TiraPestanas
            pestanas={[
              { key: 'fianzas', label: 'Mis fianzas', icono: ShieldCheck },
              { key: 'documentos', label: 'Documentos del fiado', icono: FileText },
            ]}
            activa={tab}
            onCambiar={setTab}
          />
          <div className="pt-4">
            {tab === 'fianzas' ? <MisFianzas /> : <Documentos />}
          </div>
        </div>
      </div>
    </ClienteShell>
  );
}
