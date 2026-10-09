// El marco de las pantallas de acceso (login y recuperar contraseña): la
// tarjeta del formulario al centro sobre el lienzo vivo de FortexLink —los
// cuadros de la marca flotando despacio—, para que entrar a Fianzas se sienta
// de la misma casa que las demás herramientas de Fortex.
import LienzoVivo from './LienzoVivo.jsx';

export default function MarcoAcceso({ children }) {
  return (
    <main className="login-shell">
      <LienzoVivo />
      {/* Un velo suave en el centro: si a un cuadro le toca quedarse grande
          detrás de la tarjeta, el formulario no pierde. Le baja el contraste
          al fondo justo donde hay que leer, sin apagar la orilla. */}
      <div className="acceso-velo" aria-hidden="true" />

      <div className="login-access-status">
        <span className="login-status-dot" aria-hidden="true" />
        Sistema disponible
      </div>

      <div className="login-centro">
        <header className="login-brand">
          <p className="login-wordmark">Fortex</p>
          <p className="login-product-name">Portal de Fianzas</p>
        </header>

        <div className="login-card">{children}</div>
      </div>

      <p className="login-access-footer">Fortex · Portal interno de gestión</p>
    </main>
  );
}
