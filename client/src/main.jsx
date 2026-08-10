import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Admin from './pages/Admin.jsx';
import './index.css';

// Al panel entra el personal de Fortex; el vendedor ve la misma pantalla pero
// acotada a su cartera. Esto es solo para no mostrar lo que no le toca: quien
// decide de verdad es el servidor en cada petición.
const esInterno = (user) => user?.role === 'admin' || user?.role === 'vendedor';

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
  return esInterno(user) ? <Navigate to="/admin" replace /> : <Dashboard />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Home />} />
          <Route path="/admin" element={<Protected internoOnly><Admin /></Protected>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </React.StrictMode>
);
