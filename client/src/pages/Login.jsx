import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { ShieldCheck, AlertTriangle, Loader2 } from 'lucide-react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [identificador, setId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(identificador.trim(), password);
      navigate(u.role === 'admin' ? '/admin' : '/');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-indigo-600 mb-3">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800">Fortex · Portal de Fianzas</h1>
          <p className="text-sm text-slate-500 mt-0.5">Departamento de Fianzas</p>
        </div>

        <form onSubmit={onSubmit} className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
          <h2 className="text-base font-semibold text-slate-700 mb-4">Iniciar sesión</h2>

          <label className="text-xs text-slate-500 mb-1 block">RFC o correo electrónico</label>
          <input
            value={identificador}
            onChange={(e) => setId(e.target.value)}
            autoFocus
            placeholder="cliente@demo.mx o RFC"
            className="w-full mb-4 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
          />

          <label className="text-xs text-slate-500 mb-1 block">Contraseña</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full mb-5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-100"
          />

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 flex items-start gap-2 mb-4">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            {busy ? 'Entrando…' : 'Entrar'}
          </button>

          <div className="mt-5 pt-4 border-t border-slate-100 text-xs text-slate-400 space-y-0.5">
            <p className="font-medium text-slate-500">Cuentas de prueba</p>
            <p>Cliente: cliente@demo.mx / demo123</p>
            <p>Admin: admin@fortex.mx / admin123</p>
          </div>
        </form>
      </div>
    </div>
  );
}
