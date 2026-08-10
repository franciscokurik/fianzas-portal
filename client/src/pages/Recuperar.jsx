import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2 } from 'lucide-react';
import { api } from '../api.js';

// Una sola pantalla para las dos mitades del trámite: sin token en la URL pide
// el correo, y con token pide la contraseña nueva. Reusa el marco del login
// para que se sienta el mismo lugar y no un formulario perdido.
export default function Recuperar() {
  const [params] = useSearchParams();
  const token = params.get('token');
  return (
    <main className="login-shell">
      <section className="login-art-panel">
        <img
          className="login-art"
          src="/login-illustration.webp"
          alt="Torre Fortex en Monterrey, dibujada a lápiz frente al Cerro de la Silla"
          width="1536"
          height="1024"
        />
        <header className="login-brand">
          <span className="login-logo-mark" aria-hidden="true">F</span>
          <div>
            <p className="login-wordmark">FORTEX</p>
            <p className="login-product-name">Portal de Fianzas</p>
          </div>
        </header>
      </section>

      <section className="login-access-panel">
        <div className="login-form-wrap">
          {token ? <NuevaContrasena token={token} /> : <PedirEnlace />}
        </div>
      </section>
    </main>
  );
}

function PedirEnlace() {
  const [email, setEmail] = useState('');
  const [enviado, setEnviado] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      // La API contesta lo mismo exista o no la cuenta, así que aquí tampoco
      // hay nada que distinguir: se muestra el acuse y ya.
      const r = await api.post('/auth/recuperar', { email: email.trim() });
      setEnviado(r.mensaje);
    } catch (err) {
      setEnviado(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (enviado) {
    return (
      <>
        <div className="login-form-heading">
          <p className="login-form-kicker">Revisa tu correo</p>
          <h2>Enlace enviado</h2>
          <p>{enviado}</p>
        </div>
        <div className="login-error" style={{ borderColor: '#a7f3d0', background: '#ecfdf5', color: '#065f46' }}>
          <CheckCircle2 aria-hidden="true" />
          <span>El enlace vence en una hora. Si no llega, revisa la carpeta de no deseados.</span>
        </div>
        <p className="login-forgot"><Link to="/login">Volver a iniciar sesión</Link></p>
      </>
    );
  }

  return (
    <>
      <div className="login-form-heading">
        <p className="login-form-kicker">Recuperar acceso</p>
        <h2>¿Olvidaste tu contraseña?</h2>
        <p>Escribe tu correo y te mandamos un enlace para elegir una nueva.</p>
      </div>

      <form onSubmit={onSubmit} className="login-form">
        <div className="login-field">
          <label htmlFor="email">Correo electrónico</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
            autoComplete="username"
            placeholder="tu@empresa.mx"
          />
        </div>

        <button type="submit" disabled={busy || !email.trim()} className="login-submit">
          <span>{busy ? 'Enviando…' : 'Enviarme el enlace'}</span>
          {busy ? <Loader2 className="login-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        </button>

        <p className="login-forgot"><Link to="/login">Volver a iniciar sesión</Link></p>
      </form>
    </>
  );
}

function NuevaContrasena({ token }) {
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('La contraseña debe tener al menos 8 caracteres.');
    if (password !== repetida) return setError('Las dos contraseñas no coinciden.');

    setBusy(true);
    try {
      await api.post('/auth/restablecer', { token, password });
      setListo(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (listo) {
    return (
      <>
        <div className="login-form-heading">
          <p className="login-form-kicker">Listo</p>
          <h2>Contraseña actualizada</h2>
          <p>Ya puedes entrar al portal con tu contraseña nueva.</p>
        </div>
        <p className="login-forgot"><Link to="/login">Iniciar sesión</Link></p>
      </>
    );
  }

  return (
    <>
      <div className="login-form-heading">
        <p className="login-form-kicker">Recuperar acceso</p>
        <h2>Elige tu nueva contraseña</h2>
        <p>Mínimo 8 caracteres. Al guardarla, este enlace deja de servir.</p>
      </div>

      <form onSubmit={onSubmit} className="login-form">
        <div className="login-field">
          <label htmlFor="password">Nueva contraseña</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="new-password"
            placeholder="••••••••"
          />
        </div>

        <div className="login-field">
          <label htmlFor="repetida">Repítela</label>
          <input
            id="repetida"
            type="password"
            value={repetida}
            onChange={(e) => setRepetida(e.target.value)}
            autoComplete="new-password"
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
          <span>{busy ? 'Guardando…' : 'Guardar contraseña'}</span>
          {busy ? <Loader2 className="login-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
        </button>

        <p className="login-forgot"><Link to="/recuperar">Pedir un enlace nuevo</Link></p>
      </form>
    </>
  );
}
