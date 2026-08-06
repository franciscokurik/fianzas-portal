import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  LockKeyhole,
} from 'lucide-react';
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
    <main className="login-shell">
      {/* El fondo del panel (#fbfaf8) es el mismo tono que el papel del dibujo,
          así que la hoja se extiende sin costura hasta los bordes. */}
      <section className="login-art-panel">
        <img
          className="login-art"
          src="/login-illustration.webp"
          alt="Torre Fortex en Monterrey, dibujada a lápiz frente al Cerro de la Silla"
          width="1536"
          height="1024"
        />

        <header className="login-brand">
          <span className="login-logo-mark" aria-hidden="true">
            F
          </span>
          <div>
            <p className="login-wordmark">FORTEX</p>
            <p className="login-product-name">Portal de Fianzas</p>
          </div>
        </header>
      </section>

      <section className="login-access-panel">
        <div className="login-access-status">
          <span className="login-status-dot" aria-hidden="true" />
          Sistema disponible
        </div>

        <div className="login-form-wrap">
          <div className="login-form-heading">
            <p className="login-form-kicker">Bienvenido de vuelta</p>
            <h2>Inicia sesión</h2>
            <p>Ingresa tus credenciales para continuar a tu portal.</p>
          </div>

          <form onSubmit={onSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="identificador">RFC o correo electrónico</label>
              <input
                id="identificador"
                name="identificador"
                value={identificador}
                onChange={(e) => setId(e.target.value)}
                autoFocus
                autoComplete="username"
                placeholder="cliente@demo.mx o RFC"
              />
            </div>

            <div className="login-field">
              <label htmlFor="password">Contraseña</label>
              <input
                id="password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="login-error" role="alert" aria-live="polite">
                <AlertTriangle aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <button type="submit" disabled={busy} className="login-submit">
              <span>{busy ? 'Verificando acceso…' : 'Entrar al portal'}</span>
              {busy
                ? <Loader2 className="login-spinner" aria-hidden="true" />
                : <ArrowRight aria-hidden="true" />}
            </button>
          </form>

          <div className="login-demo">
            <div className="login-demo-title">
              <span>Cuentas de prueba</span>
              <span className="login-demo-badge">DEMO</span>
            </div>
            <div className="login-demo-grid">
              <div>
                <span>Cliente</span>
                <strong>cliente@demo.mx</strong>
                <code>demo123</code>
              </div>
              <div>
                <span>Administrador</span>
                <strong>admin@fortex.mx</strong>
                <code>admin123</code>
              </div>
            </div>
          </div>

          <p className="login-security-note">
            <LockKeyhole aria-hidden="true" />
            Acceso protegido. Tus credenciales se transmiten de forma segura.
          </p>
        </div>

        <p className="login-access-footer">Fortex · Portal interno de gestión</p>
      </section>
    </main>
  );
}
