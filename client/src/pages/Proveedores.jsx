// El portal del CONTRATANTE: el desarrollador que no compra fianzas, las exige.
//
// Es el hermano de Dashboard.jsx, pero la pregunta que contesta es otra. El
// fiado entra a ver cuánto tiene y cuánto paga; el desarrollador entra a ver UNA
// cosa: cuál de sus proveedores no le ha presentado la fianza. Por eso lo
// primero de la pantalla es el renglón en falta, no un total de dinero.
//
// Este archivo es la cáscara —encabezado, cifras, pestañas y avisos— y cada
// pestaña es un componente, igual que Dashboard.jsx con MisFianzas y Documentos:
//
//   PROYECTOS  -> sus desarrollos, con los proveedores adentro. Es lo que pidió:
//                 la torre completa en un lugar. Y es lo ÚNICO que él captura.
//   PROVEEDORES -> el padrón, la misma información vista por empresa. Sirve para
//                 la pregunta de la mañana: ¿a quién le falta la fianza?
//
// Usa el mismo sistema de diseño que el panel de Fortex (ClienteShell y las
// piezas de components/fx.jsx), igual que el portal del fiado.
import { useCallback, useEffect, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, AlertTriangle, Building2, Users, CheckCircle2, Layers, CalendarClock, X,
} from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { mxn } from '../lib.jsx';
import ClienteShell from '../components/ClienteShell.jsx';
import { Cifra, EncabezadoPagina, TiraPestanas } from '../components/fx.jsx';
import ProyectosContratante from '../components/ProyectosContratante.jsx';
import PadronContratante from '../components/PadronContratante.jsx';

export default function Proveedores() {
  const { user, logout } = useAuth();
  const [data, setData] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [tab, setTab] = useState('proyectos');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [msg, setMsg] = useState('');
  const [soloEnFalta, setSoloEnFalta] = useState(false);

  const cargar = useCallback(
    () => api.get('/proveedores').then(setData).catch((e) => setError(e.message)),
    []
  );

  useEffect(() => {
    cargar();
    // Los tipos de documento se piden una vez y bajan a las dos pestañas: son
    // un catálogo del servidor, no algo que cambie mientras se navega.
    api.get('/proveedores/tipos-documento').then((d) => setTipos(d.tipos)).catch(() => {});
  }, [cargar]);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
  const m = data?.metricas;

  return (
    <ClienteShell nombre={user?.nombre} empresa={data?.razon_social || user?.razon_social} onSalir={logout}>
      <div className="space-y-5">
        <EncabezadoPagina
          titulo="Mis proyectos y proveedores"
          sub={`La fianza que cada proveedor presentó por tus obras${
            m ? ` · ${m.proyectos} proyecto(s), ${m.proveedores} proveedor(es)` : ''
          }`}
        />

        {msg && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-700 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> {msg}
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-medium">No se pudo cargar la información.</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-700 shrink-0" title="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {aviso && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1">{aviso}</span>
            <button onClick={() => setAviso('')} className="text-amber-500 hover:text-amber-800 shrink-0" title="Cerrar">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Lo primero de la pantalla es lo que falta, no un total.
            'pendientes_sin_fianza' y no 'obras_descubiertas': con partidas, una
            obra puede tener su fianza y aun así faltarle la que la partida
            exige. Ver el comentario en services/proveedores.js. */}
        {m?.pendientes_sin_fianza > 0 && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <span className="font-medium">
                {m.pendientes_sin_fianza} pendiente(s) sin fianza completa
              </span>
              {m.proveedores_en_falta > 0 && <> en {m.proveedores_en_falta} proveedor(es)</>}.{' '}
              <button
                onClick={() => { setTab('padron'); setSoloEnFalta(true); }}
                className="underline hover:no-underline"
              >
                Ver quiénes
              </button>
            </div>
          </div>
        )}

        {/* El verde solo cuando no falta NADA en ningún nivel. Con el número de
            obras, una partida incompleta lo dejaba decir "todas tienen fianza". */}
        {m?.pendientes_sin_fianza === 0 && m?.obras_vivas > 0 && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            {m.partidas > 0
              ? 'Cada partida tiene vigente lo que le exiges.'
              : 'Todas tus obras vigentes tienen fianza registrada.'}
          </div>
        )}

        {/* Aparte, y en gris y no en rojo: contratar es pendiente TUYO, no de
            un proveedor que incumplió. */}
        {m?.partidas_sin_contratista > 0 && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700 flex items-start gap-2">
            <Layers className="w-4 h-4 mt-0.5 shrink-0 text-slate-400" />
            <span>
              <span className="font-medium">
                {m.partidas_sin_contratista} partida(s) todavía sin contratista
              </span>
              . Cuando contrates, dile a Fortex y te liga su obra con sus fianzas.
            </span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* "Vigentes" y no "en curso": el conjunto incluye las terminadas y
              entregadas a propósito, porque ahí vive la fianza de vicios
              ocultos. Las cerradas y canceladas se listan pero no cuentan. */}
          {/* La unidad cambia con lo que el desarrollador capturó: si armó
              partidas, el pendiente es la partida —es donde exige la fianza—; si
              no, la obra. La etiqueta dice cuál para que el número no se lea
              contra la otra cifra de la pantalla. El cuadro va en rojo solo si
              falta algo: en cero no es una alarma. */}
          {m?.partidas > 0 ? (
            <Cifra tono={m?.pendientes_sin_fianza > 0 ? 'bad' : 'ok'} icono={<ShieldAlert className="h-5 w-5" />}
                   label="Partidas sin fianza completa"
                   valor={m?.pendientes_sin_fianza ?? '—'}
                   sub={m ? `de ${m.partidas} partida(s)`
                          + (m.pendientes_sueltos ? ` · ${m.pendientes_sueltos} obra(s) sin partida` : '')
                          : null} />
          ) : (
            <Cifra tono={m?.obras_descubiertas > 0 ? 'bad' : 'ok'} icono={<ShieldAlert className="h-5 w-5" />}
                   label="Obras sin fianza vigente" valor={m?.obras_descubiertas ?? '—'}
                   sub={m ? `de ${m.obras_vivas} obra(s) vigente(s)` : null} />
          )}
          <Cifra tono="ok" icono={<ShieldCheck className="h-5 w-5" />}
                 label="Obras con fianza" valor={m?.obras_cubiertas ?? '—'}
                 sub="fianza emitida y vigente" />
          <Cifra tono={m?.obras_por_vencer > 0 ? 'warn' : 'neutral'} icono={<CalendarClock className="h-5 w-5" />}
                 label="Por vencer (< 60 días)" valor={m?.obras_por_vencer ?? '—'}
                 sub={m ? (m.obras_por_vencer > 0
                   ? 'pídele la renovación al proveedor'
                   : 'ninguna renovación urgente') : null} />
          {/* Es la cobertura A TU FAVOR: lo que las fianzas vigentes de tus
              proveedores cubren hoy. No es dinero tuyo ni un pasivo tuyo. */}
          <Cifra tono="brand" icono={<Building2 className="h-5 w-5" />}
                 label="Cobertura a tu favor" valor={mxn(m?.monto_afianzado)}
                 sub={m?.previos_en_tramite > 0
                   ? `${m.previos_en_tramite} previo(s) en trámite`
                   : 'suma de las fianzas vigentes'} />
        </div>

        <div>
          <div className="flex items-end gap-3">
            <div className="flex-1 min-w-0">
              <TiraPestanas
                pestanas={[
                  { key: 'proyectos', label: 'Mis proyectos', icono: Building2, cuenta: m?.proyectos },
                  {
                    key: 'padron', label: 'Proveedores', icono: Users, cuenta: m?.proveedores,
                    // En ámbar si alguno debe fianza: la pestaña no puede esconderlo.
                    alerta: m?.proveedores_en_falta > 0,
                  },
                ]}
                activa={tab}
                onCambiar={setTab}
              />
            </div>
            {tab === 'padron' && soloEnFalta && (
              <button
                onClick={() => setSoloEnFalta(false)}
                className="pb-2.5 text-xs text-slate-500 hover:text-slate-800 underline hover:no-underline shrink-0"
              >
                Ver todos los proveedores
              </button>
            )}
          </div>

          <div className="pt-4">
            {tab === 'proyectos' ? (
              <ProyectosContratante
                clienteId={user?.client_id}
                tipos={tipos}
                onCambio={cargar}
                avisar={setAviso}
                flash={flash}
              />
            ) : (
              <PadronContratante
                proveedores={data?.proveedores || []}
                clienteId={user?.client_id}
                tipos={tipos}
                soloEnFalta={soloEnFalta}
                onCambio={cargar}
                avisar={setAviso}
              />
            )}
          </div>
        </div>

        {/* Se dice en la pantalla y no solo en el README: el portal sabe de las
            fianzas que colocó Fortex, y de ninguna otra. Sin esta línea, un
            "Sin registro" se lee como "tu proveedor no cumplió". */}
        {data && (
          <p className="text-[11px] text-slate-400 leading-relaxed">
            Este portal muestra las fianzas registradas en Fortex. Si un proveedor contrató
            su fianza con otro agente, aquí aparecerá como
            <span className="font-medium"> sin registro</span> aunque la tenga: puedes subir
            el PDF que te entregó en <span className="font-medium">Documentos que recibiste</span>,
            dentro de la obra, y pedirle a Fortex que la capture.
          </p>
        )}
      </div>
    </ClienteShell>
  );
}
