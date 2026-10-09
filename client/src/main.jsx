import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Recuperar from './pages/Recuperar.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Proveedores from './pages/Proveedores.jsx';
import Admin from './pages/Admin.jsx';
// Inter, servida desde el propio portal y no desde Google Fonts: el panel
// tiene que verse igual sin salir a internet y sin destello de fuente. Es la
// tipografía de las herramientas internas de Fortex (ver index.css, .fx-admin).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';

// Al panel entran los tres niveles internos y comparten pantalla; lo que cambia
// es qué se les muestra. Esto es solo para que no estorbe: quien decide de
// verdad es el servidor en cada petición.
const ROLES_INTERNOS = ['admin', 'operador', 'vendedor'];
const esInterno = (user) => ROLES_INTERNOS.includes(user?.role);

function Protected({ children, internoOnly }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-white/60">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (internoOnly && !esInterno(user)) return <Navigate to="/" replace />;
  return children;
}

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-white/60">Cargando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (esInterno(user)) return <Navigate to="/admin" replace />;
  // Las dos clases de cliente entran por la misma puerta y a pantallas
  // distintas: el FIADO a sus fianzas, el CONTRATANTE al padrón de las que le
  // presentaron sus proveedores. Quien decide de verdad es el servidor, que
  // vuelve a preguntar el tipo en cada ruta (auth/middleware.js); esto es nada
  // más para no mandar a nadie a una pantalla que le va a contestar 403.
  return user.cliente_tipo === 'contratante' ? <Proveedores /> : <Dashboard />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          {/* Las dos mitades del trámite: pedir el enlace y usarlo. Van sin
              sesión a propósito — quien llega aquí no puede entrar. */}
          <Route path="/recuperar" element={<Recuperar />} />
          <Route path="/restablecer" element={<Recuperar />} />
          <Route path="/" element={<Home />} />
          {/* El panel tiene sus secciones adentro (/admin/clientes/7, /admin/comisiones…):
              Admin.jsx las resuelve con sus propias rutas. */}
          <Route path="/admin/*" element={<Protected internoOnly><Admin /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
