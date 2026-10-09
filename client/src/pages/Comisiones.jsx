// Comisiones: lo que genera cada póliza. Solo para Fortex.
//
// El admin ve todas y las captura (una por una o con Excel); el vendedor ve
// las suyas y nada más. Quien decide es el servidor (/api/comisiones): aquí
// solo se deja de pintar lo que a cada quien le contestaría 403.
//
// La pantalla enseña poco a la vez, a propósito: cuatro cifras y un listado.
// El resumen por vendedor va en su pestaña, y la captura y la carga masiva en
// ventanas que se abren cuando se piden.
import { useEffect, useMemo, useState } from 'react';
import {
  Plus, Download, Upload, Search, X, Pencil, Trash2, AlertTriangle, FileSpreadsheet,
  HandCoins, CalendarClock, Clock, FileWarning, CheckCircle2, Eye,
} from 'lucide-react';
import { api } from '../api.js';
import { mxn, mxnCents, fmtDate, InputPesos } from '../lib.jsx';

// Arriba del archivo, como todos los mapas de etiquetas y colores.
const FILTROS_ESTADO = [
  { key: 'todas', label: 'Todas' },
  { key: 'por_conciliar', label: 'Por conciliar' },
  { key: 'conciliada', label: 'Conciliadas' },
];

const PERIODOS = [
  { key: 'mes', label: 'Este mes' },
  { key: 'mes_anterior', label: 'Mes anterior' },
  { key: 'anio', label: 'Este año' },
  { key: 'todo', label: 'Todo' },
];

// El cuadro de color del KPI: el ÚNICO lugar de la tarjeta con color. La
// tarjeta entera nunca se tiñe: cuatro tarjetas de colores se leen como un
// semáforo (hr-system, docs/FORTEX-DESIGN.md §8).
const TONO_KPI = {
  brand: 'bg-indigo-50 text-indigo-600',
  ok: 'bg-green-50 text-green-700',
  warn: 'bg-amber-50 text-amber-700',
  neutral: 'bg-slate-100 text-slate-500',
};

// Columnas del listado, una vez para encabezado y renglones.
const COLS = 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,8rem)_minmax(0,8rem)_6.5rem_7.5rem_8rem_2rem] gap-x-4 items-center';
const COLS_SIN_ACCIONES = 'grid grid-cols-[minmax(0,1.3fr)_minmax(0,8rem)_6.5rem_7.5rem_8rem] gap-x-4 items-center';

// Los controles del sistema de FortexLink: 32px de alto, 6px de radio, y el
// foco como borde más oscuro con un halo casi invisible.
const inputCls = 'w-full h-8 px-2.5 text-[13px] border border-slate-200 rounded-md bg-white text-slate-800 focus:outline-none focus:border-[#b9b9c2] focus:shadow-[0_0_0_4px_var(--ring)] transition-colors';
const filtroCls = 'h-8 px-2.5 text-[12.5px] border border-slate-200 rounded-md bg-white text-slate-700 focus:outline-none focus:border-[#b9b9c2] focus:shadow-[0_0_0_4px_var(--ring)] transition-colors';

// La fecha de HOY en la zona del navegador. Con toISOString() en México, de las
// seis de la tarde en adelante ya sería mañana y "este mes" brincaría antes.
function hoyLocal() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function rangoDe(periodo) {
  const hoy = hoyLocal();
  const [a, m] = hoy.split('-').map(Number);
  const p = (n) => String(n).padStart(2, '0');
  const finDeMes = (anio, mes) => new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  if (periodo === 'mes') return { desde: `${a}-${p(m)}-01`, hasta: `${a}-${p(m)}-${finDeMes(a, m)}` };
  if (periodo === 'mes_anterior') {
    const [aa, mm] = m === 1 ? [a - 1, 12] : [a, m - 1];
    return { desde: `${aa}-${p(mm)}-01`, hasta: `${aa}-${p(mm)}-${finDeMes(aa, mm)}` };
  }
  if (periodo === 'anio') return { desde: `${a}-01-01`, hasta: `${a}-12-31` };
  return {};
}

const nombreDelMes = (periodo) => new Intl.DateTimeFormat('es-MX', { month: 'long', timeZone: 'UTC' })
  .format(new Date(`${periodo}-15T00:00:00Z`));

/* --------------------------------------------------------------------------
   Excel: la base para descargar y la lectura del archivo que se sube
   --------------------------------------------------------------------------
   La librería pesa casi un mega, así que se carga solo cuando se usa: quien
   nunca hace una carga masiva no la descarga. */

const ENCABEZADOS = [
  { key: 'id', titulo: 'ID (no modificar · vacío = nueva)', ancho: 14 },
  { key: 'numero_poliza', titulo: 'Número de fianza', ancho: 20 },
  { key: 'afianzadora', titulo: 'Afianzadora', ancho: 18 },
  { key: 'cliente', titulo: 'Cliente', ancho: 36 },
  { key: 'fecha_pago', titulo: 'Fecha de pago', ancho: 15 },
  { key: 'fecha_conciliacion', titulo: 'Fecha de conciliación', ancho: 20 },
  { key: 'comision_neta', titulo: 'Comisión neta', ancho: 16 },
];

// Encabezado del archivo -> llave. Se reconoce por el texto y no por la
// posición: si alguien mueve o agrega una columna, el archivo se sigue leyendo.
const normal = (t) => String(t ?? '').toLowerCase().normalize('NFD')
  .replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
function llaveDeEncabezado(texto) {
  const t = normal(texto);
  if (t.startsWith('id')) return 'id';
  if (t.includes('fianza') && (t.includes('numero') || t.includes('no.'))) return 'numero_poliza';
  if (t.includes('afianzadora')) return 'afianzadora';
  if (t.includes('cliente')) return 'cliente';
  if (t.includes('pago')) return 'fecha_pago';
  if (t.includes('concilia')) return 'fecha_conciliacion';
  if (t.includes('comision')) return 'comision_neta';
  return null;
}

// Una fecha ISO a Date de Excel. Se arma en UTC para que Excel la enseñe el
// mismo día, sin el corrimiento de zona horaria.
const aFechaExcel = (iso) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

async function descargarBase() {
  const { filas } = await api.get('/comisiones/base');
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Comisiones', { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = ENCABEZADOS.map((e) => ({ header: e.titulo, key: e.key, width: e.ancho }));

  for (const f of filas) {
    hoja.addRow({
      id: f.comision_id ?? null,
      numero_poliza: f.numero_poliza,
      afianzadora: f.afianzadora,
      cliente: f.cliente,
      fecha_pago: aFechaExcel(f.fecha_pago),
      fecha_conciliacion: aFechaExcel(f.fecha_conciliacion),
      comision_neta: f.comision_neta == null ? null : f.comision_neta / 100,
    });
  }

  // El número de póliza como TEXTO: si Excel lo toma por número, "0301121" se
  // vuelve 301121 en cuanto alguien toca la celda.
  hoja.getColumn('numero_poliza').numFmt = '@';
  hoja.getColumn('fecha_pago').numFmt = 'dd/mm/yyyy';
  hoja.getColumn('fecha_conciliacion').numFmt = 'dd/mm/yyyy';
  hoja.getColumn('comision_neta').numFmt = '"$"#,##0.00';
  hoja.getColumn('id').font = { color: { argb: 'FF9E9A93' } };
  const encabezado = hoja.getRow(1);
  encabezado.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  encabezado.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A9C' } };
  encabezado.height = 20;

  const buffer = await libro.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `comisiones-base-${hoyLocal()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
  return filas.length;
}

// El valor de una celda, como lo necesita el servidor: fechas a 'YYYY-MM-DD',
// números tal cual y lo demás como texto. El servidor vuelve a validar todo.
function valorDeCelda(v) {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10); // Excel no trae zona: es UTC
  if (typeof v === 'object') {
    if ('result' in v) return valorDeCelda(v.result);                 // fórmula
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);                          // hipervínculo
  }
  return typeof v === 'string' ? v.trim() : v;
}

async function leerArchivo(archivo) {
  const { default: ExcelJS } = await import('exceljs');
  const libro = new ExcelJS.Workbook();
  await libro.xlsx.load(await archivo.arrayBuffer());
  const hoja = libro.worksheets[0];
  if (!hoja) throw new Error('El archivo no tiene hojas.');

  const columnas = {};
  hoja.getRow(1).eachCell((celda, col) => {
    const llave = llaveDeEncabezado(valorDeCelda(celda.value));
    if (llave && !columnas[llave]) columnas[llave] = col;
  });
  const faltan = ['numero_poliza', 'afianzadora', 'fecha_pago', 'comision_neta']
    .filter((k) => !columnas[k]);
  if (faltan.length) {
    throw new Error('No encontré estas columnas en el primer renglón: '
      + faltan.map((k) => ENCABEZADOS.find((e) => e.key === k).titulo).join(', ')
      + '. Usa la base que se descarga de aquí.');
  }

  const filas = [];
  hoja.eachRow((renglon, numero) => {
    if (numero === 1) return;
    const fila = { fila: numero };
    for (const [llave, col] of Object.entries(columnas)) fila[llave] = valorDeCelda(renglon.getCell(col).value);
    // Un renglón totalmente vacío al final del archivo no es un renglón.
    if (Object.entries(fila).some(([k, v]) => k !== 'fila' && v !== '')) filas.push(fila);
  });
  return filas;
}

/* --------------------------------------------------------------------------
   Piezas
   -------------------------------------------------------------------------- */

function StatCard({ icon, label, value, sub, tono, activa, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-start gap-3 text-left bg-white rounded-xl border p-4 transition-colors ${
        activa ? 'border-indigo-300' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <span className={`flex items-center justify-center w-10 h-10 rounded-md shrink-0 ${TONO_KPI[tono]}`}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[18px] font-semibold tracking-[-0.03em] text-slate-800 tabular-nums leading-tight">{value}</span>
        <span className="block text-[12px] text-slate-500 mt-0.5">{label}</span>
        <span className="block text-[11.5px] text-slate-400 truncate">{sub}</span>
      </span>
    </button>
  );
}

function Modal({ icono, tono = 'indigo', titulo, sub, onClose, children, pie, ancho = 'max-w-lg' }) {
  const tonos = { indigo: 'bg-indigo-100 text-indigo-600', red: 'bg-red-100 text-red-600', amber: 'bg-amber-100 text-amber-600' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'var(--overlay)' }}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${ancho} flex flex-col max-h-[90vh]`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${tonos[tono]}`}>{icono}</div>
            <div>
              <h2 className="font-semibold text-slate-800">{titulo}</h2>
              {sub && <p className="text-xs text-slate-500">{sub}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">{children}</div>
        {pie && <div className="flex justify-end gap-2 px-6 py-4 border-t border-slate-100 shrink-0">{pie}</div>}
      </div>
    </div>
  );
}

function Aviso({ tono = 'red', children }) {
  const tonos = {
    red: 'bg-red-50 border-red-200 text-red-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
  };
  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${tonos[tono]}`}>
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
      <div className="text-xs">{children}</div>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Alta y corrección individual
   -------------------------------------------------------------------------- */

function ComisionModal({ inicial, onClose, onGuardado }) {
  const editando = Boolean(inicial);
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState([]);
  const [poliza, setPoliza] = useState(null);
  const [f, setF] = useState({
    fecha_pago: inicial?.fecha_pago || hoyLocal(),
    fecha_conciliacion: inicial?.fecha_conciliacion || '',
    comision_neta: inicial?.comision_neta ?? 0,
    notas: inicial?.notas || '',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // El buscador espera a que se deje de teclear: una petición por letra no
  // sirve de nada y en Neon cada una es un viaje.
  useEffect(() => {
    if (editando || busca.trim().length < 2) { setResultados([]); return undefined; }
    let vigente = true;
    const t = setTimeout(() => {
      api.get(`/comisiones/polizas?q=${encodeURIComponent(busca.trim())}`)
        .then((d) => { if (vigente) setResultados(d.polizas); })
        .catch((e) => { if (vigente) setError(e.message); });
    }, 250);
    return () => { vigente = false; clearTimeout(t); };
  }, [busca, editando]);

  async function guardar() {
    setError('');
    if (!editando && !poliza) return setError('Elige la póliza.');
    setBusy(true);
    try {
      if (editando) await api.put(`/comisiones/${inicial.id}`, f);
      else await api.post('/comisiones', { ...f, fianza_id: poliza.id });
      onGuardado(editando ? 'Comisión actualizada' : 'Comisión registrada');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function borrar() {
    if (!confirm(`¿Borrar la comisión de ${mxnCents(inicial.comision_neta)} de la póliza ${inicial.numero_poliza}?`)) return;
    setBusy(true);
    try {
      await api.del(`/comisiones/${inicial.id}`);
      onGuardado('Comisión borrada');
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  return (
    <Modal
      icono={<HandCoins className="h-5 w-5" />}
      titulo={editando ? 'Corregir comisión' : 'Nueva comisión'}
      sub={editando
        ? `${inicial.numero_poliza} · ${inicial.cliente}`
        : 'Se le asigna al vendedor titular del cliente'}
      onClose={onClose}
      pie={(
        <>
          {editando && (
            <button
              onClick={borrar}
              disabled={busy}
              className="mr-auto flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> Borrar
            </button>
          )}
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            onClick={guardar}
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {busy ? 'Guardando…' : 'Guardar'}
          </button>
        </>
      )}
    >
      {!editando && (
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Póliza *</label>
          {poliza ? (
            <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-indigo-200 bg-indigo-50">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-800">
                  <span className="font-mono">{poliza.numero_poliza}</span> · {poliza.afianzadora_nombre}
                </p>
                <p className="text-xs text-slate-500 truncate">{poliza.cliente}</p>
                <p className="text-xs text-slate-500">
                  Vendedor: {poliza.vendedor_nombre || 'sin vendedor (solo la verá el admin)'}
                  {poliza.comisiones > 0 && ` · ya tiene ${poliza.comisiones} por ${mxn(poliza.comisionado)}`}
                </p>
              </div>
              <button onClick={() => setPoliza(null)} className="text-xs text-indigo-700 hover:underline shrink-0">
                Cambiar
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                <input
                  autoFocus
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Número de fianza o cliente…"
                  className={`${inputCls} pl-8`}
                />
              </div>
              {resultados.length > 0 && (
                <div className="mt-1.5 border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-56 overflow-y-auto">
                  {resultados.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setPoliza(p)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 transition-colors"
                    >
                      <p className="text-sm text-slate-800">
                        <span className="font-mono">{p.numero_poliza}</span>
                        <span className="text-slate-400"> · {p.afianzadora_nombre}</span>
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {p.cliente}{p.comisiones > 0 && ` · ${p.comisiones} comisión(es)`}
                      </p>
                    </button>
                  ))}
                </div>
              )}
              {busca.trim().length >= 2 && !resultados.length && (
                <p className="mt-1.5 text-xs text-slate-400">Sin pólizas emitidas con ese número o cliente.</p>
              )}
            </>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha de pago *</label>
          <input type="date" value={f.fecha_pago} onChange={set('fecha_pago')} className={inputCls} />
          <p className="text-[11px] text-slate-400 mt-1">Cuando el cliente pagó la fianza.</p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">Fecha de conciliación</label>
          <input type="date" value={f.fecha_conciliacion} onChange={set('fecha_conciliacion')} className={inputCls} />
          <p className="text-[11px] text-slate-400 mt-1">Vacía = por conciliar.</p>
        </div>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Comisión neta *</label>
        <InputPesos
          valor={f.comision_neta}
          onChange={(c) => setF((s) => ({ ...s, comision_neta: c }))}
          className={`${inputCls} tabular-nums`}
        />
        <p className="text-[11px] text-slate-400 mt-1">Negativa si es una devolución.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">Notas</label>
        <input value={f.notas} onChange={set('notas')} className={inputCls} />
      </div>

      {error && <Aviso>{error}</Aviso>}
    </Modal>
  );
}

/* --------------------------------------------------------------------------
   Carga masiva
   --------------------------------------------------------------------------
   Dos pasos y nada se guarda en el primero: se lee el archivo, el servidor
   dice qué pasaría con cada renglón, y solo al confirmar se guarda, todo o
   nada. */

function SubirBase({ onClose, onAplicado }) {
  const [archivo, setArchivo] = useState(null);
  const [filas, setFilas] = useState(null);
  const [analisis, setAnalisis] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function elegir(a) {
    if (!a) return;
    setArchivo(a); setFilas(null); setAnalisis(null); setError('');
    setBusy(true);
    try {
      const leidas = await leerArchivo(a);
      if (!leidas.length) throw new Error('El archivo no trae renglones debajo del encabezado.');
      setFilas(leidas);
      setAnalisis(await api.post('/comisiones/importar', { filas: leidas, aplicar: false }));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function aplicar() {
    setBusy(true);
    setError('');
    try {
      const r = await api.post('/comisiones/importar', { filas, aplicar: true });
      onAplicado(r);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const a = analisis;
  const porGuardar = a ? a.nuevas.length + a.corregidas.length : 0;
  const cifras = a ? [
    { label: 'Nuevas', valor: a.nuevas.length, cls: 'text-green-700' },
    { label: 'Corregidas', valor: a.corregidas.length, cls: 'text-blue-700' },
    { label: 'Sin cambios', valor: a.sin_cambios, cls: 'text-slate-600' },
    { label: 'Ya existían', valor: a.repetidas.length, cls: 'text-slate-600' },
    { label: 'Vacías', valor: a.vacias, cls: 'text-slate-400' },
    { label: 'Con error', valor: a.errores.length, cls: a.errores.length ? 'text-red-700' : 'text-slate-400' },
  ] : [];

  return (
    <Modal
      icono={<Upload className="h-5 w-5" />}
      titulo="Subir base de comisiones"
      sub="Primero se revisa; solo se guarda cuando confirmas"
      ancho="max-w-2xl"
      onClose={onClose}
      pie={(
        <>
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
            Cancelar
          </button>
          {a && !a.errores.length && porGuardar > 0 && (
            <button
              onClick={aplicar}
              disabled={busy}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {busy ? 'Guardando…' : `Guardar ${porGuardar} comisión(es)`}
            </button>
          )}
        </>
      )}
    >
      <label className={`flex items-center gap-3 p-4 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
        archivo ? 'border-slate-200 bg-slate-50' : 'border-slate-300 hover:border-indigo-300 hover:bg-indigo-50/40'
      }`}
      >
        <FileSpreadsheet className="h-5 w-5 text-slate-400 shrink-0" />
        <span className="text-sm text-slate-600 flex-1 min-w-0 truncate">
          {archivo ? archivo.name : 'Elige el Excel (.xlsx) con la base llena'}
        </span>
        <span className="text-xs font-medium text-indigo-700 shrink-0">{archivo ? 'Cambiar' : 'Elegir archivo'}</span>
        <input
          type="file"
          accept=".xlsx"
          className="sr-only"
          onChange={(e) => { elegir(e.target.files?.[0]); e.target.value = ''; }}
        />
      </label>

      {busy && !a && <p className="text-sm text-slate-500">Revisando el archivo…</p>}
      {error && <Aviso>{error}</Aviso>}

      {a && (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
            {cifras.map((c) => (
              <div key={c.label} className="rounded-lg border border-slate-200 px-3 py-2">
                <p className={`text-lg font-semibold tabular-nums ${c.cls}`}>{c.valor}</p>
                <p className="text-[11px] text-slate-500">{c.label}</p>
              </div>
            ))}
          </div>

          {a.errores.length > 0 ? (
            <>
              <Aviso>
                Corrige estos renglones en el Excel y vuelve a subirlo. Mientras haya uno con
                error no se guarda ninguno, para que el archivo no quede aplicado a medias.
              </Aviso>
              <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {a.errores.map((e) => (
                  <div key={`${e.fila}-${e.motivo}`} className="flex gap-3 px-3 py-2 text-xs">
                    <span className="text-slate-400 tabular-nums w-16 shrink-0">Renglón {e.fila}</span>
                    <span className="font-mono text-slate-600 w-28 shrink-0 truncate">{e.numero_poliza || '—'}</span>
                    <span className="text-red-700">{e.motivo}</span>
                  </div>
                ))}
              </div>
            </>
          ) : porGuardar === 0 ? (
            <p className="text-sm text-slate-500">
              No hay nada nuevo que guardar: todo lo del archivo ya está registrado.
            </p>
          ) : (
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
              {[...a.nuevas.map((n) => ({ ...n, que: 'Nueva' })), ...a.corregidas.map((c) => ({ ...c, que: 'Corrige' }))]
                .slice(0, 200)
                .map((r) => (
                  <div key={`${r.que}-${r.fila}`} className="grid grid-cols-[4.5rem_minmax(0,1fr)_6rem_7rem] gap-3 px-3 py-2 text-xs items-center">
                    <span className={r.que === 'Nueva' ? 'text-green-700 font-medium' : 'text-blue-700 font-medium'}>{r.que}</span>
                    <span className="min-w-0 truncate">
                      <span className="font-mono text-slate-700">{r.numero_poliza}</span>
                      <span className="text-slate-400"> · {r.cliente}</span>
                    </span>
                    <span className="text-slate-500 tabular-nums">{fmtDate(r.fecha_pago)}</span>
                    <span className="text-right tabular-nums text-slate-800">{mxnCents(r.comision_neta)}</span>
                  </div>
                ))}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

/* --------------------------------------------------------------------------
   La pantalla
   -------------------------------------------------------------------------- */

export default function Comisiones({ esAdmin, vendedores = [], afianzadoras = [], flash }) {
  const [resumen, setResumen] = useState(null);
  const [comisiones, setComisiones] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [periodo, setPeriodo] = useState('mes');
  const [estado, setEstado] = useState('todas');
  const [afianzadora, setAfianzadora] = useState('');
  const [vendedor, setVendedor] = useState('');
  const [busca, setBusca] = useState('');
  const [vista, setVista] = useState('detalle');
  const [modal, setModal] = useState(null); // null | 'nueva' | 'subir' | comisión a corregir
  const [descargando, setDescargando] = useState(false);

  const cargarResumen = () => api.get('/comisiones/resumen').then(setResumen).catch((e) => setError(e.message));

  // Lo que filtra el servidor: periodo, afianzadora y vendedor. El estado y la
  // búsqueda se filtran aquí, para poder contar las pestañas rápidas sin pedir
  // tres veces lo mismo.
  const cargarLista = () => {
    const q = new URLSearchParams({ ...rangoDe(periodo) });
    if (afianzadora) q.set('afianzadora_id', afianzadora);
    if (esAdmin && vendedor) q.set('vendedor_id', vendedor);
    setCargando(true);
    return api.get(`/comisiones?${q}`)
      .then((d) => setComisiones(d.comisiones))
      .catch((e) => setError(e.message))
      .finally(() => setCargando(false));
  };

  useEffect(() => { cargarResumen(); }, []);
  useEffect(() => { cargarLista(); }, [periodo, afianzadora, vendedor]);

  const recargar = (mensaje) => {
    setModal(null);
    cargarResumen();
    cargarLista();
    if (mensaje) flash?.(mensaje);
  };

  const termino = busca.trim().toLowerCase();
  const porEstado = (c, e = estado) => e === 'todas'
    || (e === 'conciliada' ? Boolean(c.fecha_conciliacion) : !c.fecha_conciliacion);
  const visibles = comisiones.filter((c) => porEstado(c)
    && (!termino || `${c.numero_poliza} ${c.cliente}`.toLowerCase().includes(termino)));
  const total = visibles.reduce((s, c) => s + c.comision_neta, 0);

  const porVendedor = useMemo(() => {
    const m = new Map();
    for (const c of visibles) {
      const k = c.vendedor_id ?? 'sin';
      if (!m.has(k)) m.set(k, { nombre: c.vendedor_nombre || 'Sin vendedor', cuantas: 0, total: 0, porConciliar: 0 });
      const v = m.get(k);
      v.cuantas += 1;
      v.total += c.comision_neta;
      if (!c.fecha_conciliacion) v.porConciliar += c.comision_neta;
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [visibles]);

  async function bajarBase() {
    setDescargando(true);
    try {
      const n = await descargarBase();
      flash?.(`Base descargada: ${n} renglón(es)`);
    } catch (e) {
      setError(e.message);
    } finally {
      setDescargando(false);
    }
  }

  const cols = esAdmin ? COLS : COLS_SIN_ACCIONES;
  const encabezado = esAdmin
    ? ['Póliza', 'Afianzadora', 'Vendedor', 'Pago', 'Conciliación', 'Comisión neta', '']
    : ['Póliza', 'Afianzadora', 'Pago', 'Conciliación', 'Comisión neta'];
  const derecha = esAdmin ? 5 : 4;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-800 leading-tight">
            {esAdmin ? 'Comisiones' : 'Mis comisiones'}
          </h2>
          <p className="text-slate-400 text-xs mt-0.5">
            {esAdmin
              ? 'Lo que genera cada póliza · solo la ven el administrador y su vendedor'
              : 'Las comisiones de las pólizas de tus clientes'}
          </p>
        </div>
        {esAdmin && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={bajarBase}
              disabled={descargando}
              className="flex items-center gap-1 border border-slate-200 bg-white text-slate-600 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
            >
              <Download className="h-3.5 w-3.5" /> {descargando ? 'Preparando…' : 'Descargar base'}
            </button>
            <button
              onClick={() => setModal('subir')}
              className="flex items-center gap-1 border border-slate-200 bg-white text-slate-600 px-2.5 py-1.5 rounded-lg text-xs font-medium hover:bg-slate-50 transition-colors"
            >
              <Upload className="h-3.5 w-3.5" /> Subir base
            </button>
            <button
              onClick={() => setModal('nueva')}
              className="flex items-center gap-1 bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-indigo-700 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Nueva comisión
            </button>
          </div>
        )}
        {!esAdmin && (
          <span className="flex items-center gap-1 text-xs text-slate-400 border border-slate-200 rounded-lg px-2.5 py-1.5 select-none">
            <Eye className="h-3.5 w-3.5" /> Solo lectura
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-700"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Las cuatro cifras. Cada una lleva al listado ya filtrado. */}
      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            icon={<CalendarClock className="h-5 w-5" />} tono="brand"
            label={`Comisión de ${nombreDelMes(resumen.mes.periodo)}`}
            value={mxn(resumen.mes.total)} sub={`${resumen.mes.cuantas} pago(s) este mes`}
            activa={periodo === 'mes' && estado === 'todas'}
            onClick={() => { setPeriodo('mes'); setEstado('todas'); setVista('detalle'); }}
          />
          <StatCard
            icon={<HandCoins className="h-5 w-5" />} tono="ok"
            label={`Comisión ${resumen.anio.periodo}`}
            value={mxn(resumen.anio.total)} sub={`${resumen.anio.cuantas} en el año`}
            activa={periodo === 'anio' && estado === 'todas'}
            onClick={() => { setPeriodo('anio'); setEstado('todas'); setVista('detalle'); }}
          />
          <StatCard
            icon={<Clock className="h-5 w-5" />} tono="warn"
            label="Por conciliar" value={mxn(resumen.por_conciliar.total)}
            sub={`${resumen.por_conciliar.cuantas} sin conciliar con la afianzadora`}
            activa={periodo === 'todo' && estado === 'por_conciliar'}
            onClick={() => { setPeriodo('todo'); setEstado('por_conciliar'); setVista('detalle'); }}
          />
          <StatCard
            icon={<FileWarning className="h-5 w-5" />} tono="neutral"
            label="Pólizas sin comisión" value={resumen.polizas_sin_comision}
            sub={esAdmin ? 'Emitidas y sin ninguna registrada' : 'De tus clientes, sin ninguna registrada'}
            onClick={esAdmin ? bajarBase : undefined}
          />
        </div>
      )}

      {/* El resumen por vendedor es del admin, y va en su pestaña: abajo del
          listado era una tabla más compitiendo por la vista. */}
      {esAdmin && (
        <div className="flex gap-1 border-b border-slate-200">
          {[['detalle', 'Detalle'], ['vendedores', 'Por vendedor']].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setVista(k)}
              className={`px-3 py-2.5 -mb-px border-b-2 text-[13px] transition-colors ${
                vista === k ? 'border-indigo-600 text-slate-800 font-semibold' : 'border-transparent text-slate-500 font-medium hover:text-slate-800'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTROS_ESTADO.map((t) => (
          <button
            key={t.key}
            onClick={() => setEstado(t.key)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              estado === t.key ? 'bg-indigo-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
            <span className={`text-[10px] rounded-full px-1 py-px font-semibold leading-none tabular-nums ${
              estado === t.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {comisiones.filter((c) => porEstado(c, t.key)).length}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-[2] min-w-[12rem]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por póliza o cliente…"
            className={`${filtroCls} w-full pl-8`}
          />
        </div>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} className={`${filtroCls} flex-1 min-w-[8rem]`}>
          {PERIODOS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select value={afianzadora} onChange={(e) => setAfianzadora(e.target.value)} className={`${filtroCls} flex-1 min-w-[9rem]`}>
          <option value="">Todas las afianzadoras</option>
          {afianzadoras.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        {esAdmin && (
          <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} className={`${filtroCls} flex-1 min-w-[9rem]`}>
            <option value="">Todos los vendedores</option>
            {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            <option value="sin">Sin vendedor</option>
          </select>
        )}
      </div>

      {vista === 'vendedores' && esAdmin ? (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_9rem_9rem] gap-x-4 px-5 py-2.5 bg-slate-50 border-b border-slate-200">
            {['Vendedor', 'Pagos', 'Por conciliar', 'Comisión neta'].map((t, i) => (
              <div key={t} className={`text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.06em] ${i ? 'text-right' : ''}`}>{t}</div>
            ))}
          </div>
          {!porVendedor.length ? (
            <div className="py-16 text-center text-slate-400 text-sm">No hay comisiones con los filtros seleccionados.</div>
          ) : (
            <div className="divide-y divide-slate-100" data-tabular>
              {porVendedor.map((v) => (
                <div key={v.nombre} className="grid grid-cols-[minmax(0,1fr)_6rem_9rem_9rem] gap-x-4 px-5 py-3 items-center">
                  <span className="text-sm font-medium text-slate-800 truncate">{v.nombre}</span>
                  <span className="text-sm text-slate-600 text-right">{v.cuantas}</span>
                  <span className={`text-sm text-right ${v.porConciliar ? 'text-amber-700' : 'text-slate-400'}`}>
                    {v.porConciliar ? mxn(v.porConciliar) : '—'}
                  </span>
                  <span className="text-sm font-semibold text-slate-800 text-right">{mxn(v.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className={`${cols} px-5 py-2.5 bg-slate-50 border-b border-slate-200`}>
                {encabezado.map((t, i) => (
                  <div key={i} className={`text-[10.5px] font-semibold text-slate-400 uppercase tracking-[0.06em] ${i === derecha ? 'text-right' : ''}`}>
                    {t}
                  </div>
                ))}
              </div>

              {cargando ? (
                <div className="py-16 text-center text-slate-400 text-sm">Cargando…</div>
              ) : !visibles.length ? (
                <div className="py-16 text-center text-slate-400 text-sm">
                  {comisiones.length ? 'No hay comisiones con los filtros seleccionados.' : 'No hay comisiones en este periodo.'}
                </div>
              ) : (
                <>
                  <div className="divide-y divide-slate-100" data-tabular>
                    {visibles.map((c) => (
                      <div key={c.id} className={`${cols} px-5 py-3 hover:bg-slate-50 transition-colors group`}>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate font-mono">{c.numero_poliza}</p>
                          <p className="text-xs text-slate-400 mt-0.5 truncate" title={c.notas || undefined}>{c.cliente}</p>
                        </div>
                        <div className="text-xs text-slate-600 truncate">{c.afianzadora_nombre}</div>
                        {esAdmin && (
                          <div className={`text-xs truncate ${c.vendedor_nombre ? 'text-slate-600' : 'text-slate-400'}`}>
                            {c.vendedor_nombre || 'Sin vendedor'}
                          </div>
                        )}
                        <div className="text-xs text-slate-600">{fmtDate(c.fecha_pago)}</div>
                        <div>
                          {c.fecha_conciliacion
                            ? <span className="text-xs text-slate-600">{fmtDate(c.fecha_conciliacion)}</span>
                            : (
                              <span className="estado-pill bg-amber-100 text-amber-800">
                                Por conciliar
                              </span>
                            )}
                        </div>
                        <div className={`text-sm font-semibold text-right ${c.comision_neta < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                          {mxnCents(c.comision_neta)}
                        </div>
                        {esAdmin && (
                          <button
                            onClick={() => setModal(c)}
                            className="p-1 rounded text-slate-300 group-hover:text-slate-500 hover:!text-indigo-600 transition-colors"
                            title="Corregir o borrar"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className={`${cols} px-5 py-3 bg-slate-50 border-t border-slate-200`} data-tabular>
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Total · {visibles.length} comisión(es)
                    </div>
                    {Array.from({ length: derecha - 1 }, (_, i) => <div key={i} />)}
                    <div className="text-sm font-bold text-slate-900 text-right">{mxnCents(total)}</div>
                    {esAdmin && <div />}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {modal === 'nueva' && <ComisionModal onClose={() => setModal(null)} onGuardado={recargar} />}
      {modal && typeof modal === 'object' && (
        <ComisionModal inicial={modal} onClose={() => setModal(null)} onGuardado={recargar} />
      )}
      {modal === 'subir' && (
        <SubirBase
          onClose={() => setModal(null)}
          onAplicado={(r) => recargar(
            `Base aplicada: ${r.nuevas.length} nueva(s), ${r.corregidas.length} corregida(s)`
          )}
        />
      )}
    </div>
  );
}
