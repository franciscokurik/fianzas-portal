// El menú del panel, por rol. Un solo archivo lo describe completo; los
// componentes no deciden nada.
//
// Esconder una sección aquí es solo para que no estorbe: quien decide de verdad
// es el servidor en cada ruta. "Comisiones" no está en el menú del operador
// porque /api/comisiones le contesta 403, no al revés.
import { Bell, Users, HandCoins, Settings } from 'lucide-react';

const PARA_ATENDER = { to: '/admin', label: 'Para atender', Icon: Bell, end: true };

export const navByRole = {
  admin: [
    { items: [PARA_ATENDER] },
    { label: 'Cartera', items: [{ to: '/admin/clientes', label: 'Clientes', Icon: Users }] },
    { label: 'Comercial', items: [{ to: '/admin/comisiones', label: 'Comisiones', Icon: HandCoins }] },
    { label: 'Sistema', items: [{ to: '/admin/configuracion', label: 'Configuración', Icon: Settings }] },
  ],
  operador: [
    { items: [PARA_ATENDER] },
    { label: 'Cartera', items: [{ to: '/admin/clientes', label: 'Clientes', Icon: Users }] },
    { label: 'Sistema', items: [{ to: '/admin/configuracion', label: 'Configuración', Icon: Settings }] },
  ],
  vendedor: [
    { items: [PARA_ATENDER] },
    { label: 'Cartera', items: [{ to: '/admin/clientes', label: 'Mis clientes', Icon: Users }] },
    { label: 'Comercial', items: [{ to: '/admin/comisiones', label: 'Mis comisiones', Icon: HandCoins }] },
  ],
};

// Un rol que no esté aquí no ve nada: nace sin menú, no con el de otro.
export function getNavSections(role) {
  return navByRole[role] ?? [];
}
