import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  Loader2,
  LockKeyhole,
} from 'lucide-react';
import { useAuth } from '../auth.jsx';
import MarcoAcceso from '../components/MarcoAcceso.jsx';

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
    <MarcoAcceso>
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
            placeholder="tu@empresa.mx o tu RFC"
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

        <p className="login-forgot">
          <Link to="/recuperar">¿Olvidaste tu contraseña?</Link>
        </p>
      </form>

      {/* Aquí vivían las cuentas de demostración con sus contraseñas. No
          van en la pantalla de acceso ni en local: las que siembra el seed
          están documentadas en el README, que es donde se buscan. */}

      <p className="login-security-note">
        <LockKeyhole aria-hidden="true" />
        Acceso protegido. Tus credenciales se transmiten de forma segura.
      </p>
    </MarcoAcceso>
  );
}
