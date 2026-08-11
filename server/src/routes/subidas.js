// La firma con la que el navegador sube directo a Cloudinary.
//
// Es el único lugar donde se autoriza "puedes subir archivos de este fiado". Lo
// que se haga después con el archivo —colgarlo de una fianza, del expediente,
// de una papelería— lo autoriza por su cuenta la ruta que lo registra, con sus
// propias guardas.
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { exigirCliente } from '../lib/permisos.js';
import {
  firmarSubida, esFormatoPermitido, FORMATOS_PERMITIDOS, MAXIMO_MB,
} from '../lib/upload.js';

const router = Router();

// POST /api/subidas/firma  { client_id, nombre, mime }
router.post('/firma', requireAuth, async (req, res) => {
  const clientId = Number(req.body?.client_id);
  if (!clientId) return res.status(400).json({ error: 'Falta client_id' });

  // Dos puertas distintas: la gente del fiado solo puede subir para SU empresa,
  // y el personal de Fortex para los clientes que alcance (al vendedor lo acota
  // su cartera, y a los demás solo se les valida que el cliente exista).
  if (req.user.client_id) {
    if (req.user.client_id !== clientId) {
      return res.status(403).json({ error: 'No puedes subir archivos de otro cliente' });
    }
  } else {
    await exigirCliente(req.user, clientId);
  }

  // El tipo se revisa aquí y no al registrar: de nada sirve descubrir que el
  // formato no se admite cuando ya se subieron 8 MB.
  const mime = req.body?.mime;
  if (mime && !esFormatoPermitido(mime)) {
    return res.status(400).json({
      error: `Tipo de archivo no permitido. Usa ${FORMATOS_PERMITIDOS.join(', ')}.`,
    });
  }

  const firma = await firmarSubida({ clientId, nombreArchivo: req.body?.nombre });
  res.json({ ...firma, maximo_mb: MAXIMO_MB });
});

export default router;
