import { Router } from 'express';
import db from '../db.js';
import { requireAuth, requireAdmin, requireInterno, requireOperador } from '../auth/middleware.js';
import { estadoFianza, daysUntil, todayISO } from '../lib/dates.js';
import { centavos } from '../lib/dinero.js';
import { slugify } from '../lib/slug.js';
import { borrarArchivo } from '../lib/upload.js';
import { adoptarArchivo } from '../services/subidas.js';
import {
  TIPOS_DOC, esTipoValido, agruparPorEntidad, deEntidad,
  TIPOS_DOC_CONTRATANTE, esTipoDeContratante, nombreTipoDocContratante,
} from '../lib/documentos.js';
import {
  guardarDocumentoCliente, borrarDocumentoCliente, exigirTipoDocumento,
} from '../services/documentos-cliente.js';
import {
  exigirCliente, exigirEntidad, filtroCartera, ALCANCE, JOIN_PADRON,
  exigirObraDelContratante, esVendedor,
} from '../lib/permisos.js';
import {
  crearUsuario, actualizarUsuario, desactivarUsuario, eliminarUsuario, DOMINIO_INTERNO,
} from '../services/usuarios.js';
import { eliminarCliente } from '../services/clientes.js';
import { panoramaDelContratante, lineasDeLosProveedores } from '../services/proveedores.js';
import {
  crearDesarrollo, actualizarDesarrollo, eliminarDesarrollo, desarrollosDe,
} from '../services/desarrollos.js';
import {
  crearPartida, actualizarPartida, eliminarPartida, partidasDe,
} from '../services/partidas.js';

const router = Router();

// Al panel entran los tres niveles internos. Lo que cada uno alcanza se decide
// ruta por ruta, nunca escondiendo botones:
//
//   soloAdmin    -> las cuentas de acceso y la baja de una empresa completa.
//                   Son las dos cosas que no se arreglan volviendo a capturar.
//   soloOperador -> lo que es de la casa y no de un cliente: dar de alta
//                   empresas, líneas de crédito y los catálogos que ven todos
//                   los fiados.
//   el resto     -> pasa por exigirCliente/exigirEntidad, que al vendedor lo
//                   acotan a su cartera y a los demás solo les validan que la
//                   cosa exista.
router.use(requireAuth, requireInterno);

const soloAdmin = requireAdmin;
const soloOperador = requireOperador;

// --- Clientes ---

// Tiene que coincidir con el CHECK de la columna 'tipo' (schema.js).
const TIPOS_CLIENTE = ['fiado', 'contratante'];

// Fiado (compra fianzas) o contratante (las exige a sus proveedores). Si no
// viene nada, es fiado: así se comportaba todo lo que ya estaba capturado.
function tipoValido(tipo) {
  if (tipo == null || tipo === '') return 'fiado';
  return TIPOS_CLIENTE.includes(tipo) ? tipo : null;
}

const tipoDe = async (clientId) =>
  (await db.prepare('SELECT tipo FROM clients WHERE id = ?').get(Number(clientId)))?.tipo ?? null;

// Un contratante no ejecuta obra ni compra fianzas: la contrata y la exige. Se
// niega en el servidor en vez de solo esconder el formulario, porque capturarle
// una obra dejaría datos que NADIE puede ver —su portal no tiene esa pantalla—
// y eso se descubre semanas después, cuando ya hay pólizas colgando.
async function exigirFiado(clientId, queCosa) {
  if ((await tipoDe(clientId)) === 'contratante') {
    const e = new Error(
      'Esa cuenta es de tipo contratante: no compra fianzas, así que no se le puede '
      + `capturar ${queCosa}. Si de verdad va a comprar fianzas, cámbiale el tipo a fiado primero.`
    );
    e.status = 400;
    throw e;
  }
}

// GET /api/admin/clientes -> todos los clientes con su estatus general
router.get('/clientes', async (req, res) => {
  const cartera = filtroCartera(req.user, 'c.vendedor_id');
  const clientes = await db
    .prepare(
      `SELECT c.id, c.razon_social, c.rfc, c.tipo, c.vendedor_id, v.nombre AS vendedor_nombre,
              (SELECT COUNT(*)::int FROM users u WHERE u.client_id = c.id AND u.activo = 1) AS total_usuarios,
              -- Cuántos proveedores tiene en su padrón (si es contratante) y en
              -- cuántos padrones está él (si es fiado). Las dos leen la misma
              -- tabla, cada una por su lado.
              (SELECT COUNT(*)::int FROM client_proveedores cp
                WHERE cp.contratante_id = c.id AND cp.activo = 1) AS total_proveedores,
              (SELECT COUNT(*)::int FROM client_proveedores cp
                WHERE cp.proveedor_id  = c.id AND cp.activo = 1) AS total_contratantes
       FROM clients c
       LEFT JOIN users v ON v.id = c.vendedor_id
       WHERE 1 = 1${cartera.sql}
       ORDER BY c.razon_social`
    )
    .all(...cartera.params);

  // Las obras de un contratante que hoy NO tienen fianza vigente. Es su única
  // cifra de alarma, y es la que enciende el punto ámbar de la lista.
  //
  // Lleva el alcance COMPLETO —las dos mitades, JOIN_PADRON y ALCANCE— y no una
  // copia a mano de la mitad: escrita sin el padrón, esta cifra contaba las
  // obras de proveedores ya suspendidos, así que la lista prendía el punto
  // ámbar por un pendiente que el detalle del cliente decía que no existía (y
  // que el contratante, correctamente, tampoco veía).
  //
  // Solo pólizas emitidas: un previo no cubre nada. Y solo obras vivas:
  // exigirle cobertura a una obra cerrada llenaría la lista de rojos de hace
  // años (la misma regla que services/proveedores.js).
  const obrasDescubiertas = (contratanteId) => db.prepare(
    `SELECT COUNT(*)::int c FROM proyectos p
     ${JOIN_PADRON}
     WHERE ${ALCANCE}
       AND p.estatus IN ('en_proceso', 'terminado', 'entregado')
       AND NOT EXISTS (
         SELECT 1 FROM fianzas f
         WHERE f.proyecto_id = p.id AND f.clase = 'fianza'
           -- Sin fecha capturada NO es cobertura. Es la misma regla que
           -- estadoCumplimiento en lib/dates.js, y tiene que ser la misma:
           -- si aquí contara y allá no, el punto ámbar de la lista diría una
           -- cosa y el detalle del cliente otra.
           AND f.fecha_vigencia IS NOT NULL
           AND f.fecha_vigencia >= ?
       )`
  ).get(contratanteId, todayISO());

  const enriquecidos = await Promise.all(clientes.map(async (c) => {
    // Un contratante no tiene fianzas, ni expediente, ni papelería. Calcularle
    // esas cifras le pintaría "5 documento(s) faltante(s)" por papeles que
    // nadie le va a pedir nunca, y el punto ámbar prendido para siempre.
    if (c.tipo === 'contratante') {
      return {
        ...c,
        total_proyectos: 0,
        total_fianzas: 0,
        total_previos: 0,
        fianzas_por_vencer: 0,
        fianzas_vencidas: 0,
        recordatorios_pendientes: 0,
        docs_pendientes: 0,
        papeleria_pendiente: 0,
        obras_descubiertas: (await obrasDescubiertas(c.id)).c,
      };
    }

    const registros = await db.prepare(
      `SELECT clase, fecha_vigencia, fecha_recordatorio, recordatorio_atendido_el
       FROM fianzas WHERE client_id = ?`
    ).all(c.id);
    // Los previos se cuentan aparte: todavía no son pólizas, así que no tiene
    // sentido decir que uno está "vencido" ni sumarlos con las emitidas.
    const fianzas = registros.filter((f) => f.clase !== 'previo');
    const previos = registros.filter((f) => f.clase === 'previo');
    const porVencer = fianzas.filter((f) => estadoFianza(f.fecha_vigencia) === 'por_vencer').length;
    const vencidas = fianzas.filter((f) => estadoFianza(f.fecha_vigencia) === 'vencida').length;
    // El recordatorio sí aplica a los dos: el previo es justo lo que hay que
    // perseguir para que se emita.
    const recordatorios = registros.filter((f) => {
      if (!f.fecha_recordatorio || f.recordatorio_atendido_el) return false;
      const d = daysUntil(f.fecha_recordatorio);
      return d !== null && d <= 7;
    }).length;

    const proyectos = (await db.prepare(
      'SELECT COUNT(*)::int c FROM proyectos WHERE client_id = ?'
    ).get(c.id)).c;

    const docsPendientes = (await db.prepare(
      `SELECT COUNT(*)::int c FROM document_types dt
       LEFT JOIN client_documents cd ON cd.document_type_id = dt.id AND cd.client_id = ?
       WHERE cd.id IS NULL`
    ).get(c.id)).c;

    const papeleriaPend = (await db.prepare(
      `SELECT COUNT(*)::int c FROM papeleria_requests WHERE client_id = ? AND estado = 'pendiente'`
    ).get(c.id)).c;

    return {
      ...c,
      total_proyectos: proyectos,
      total_fianzas: fianzas.length,
      total_previos: previos.length,
      fianzas_por_vencer: porVencer,
      fianzas_vencidas: vencidas,
      recordatorios_pendientes: recordatorios,
      docs_pendientes: docsPendientes,
      papeleria_pendiente: papeleriaPend,
      // Siempre presente para que las dos clases de cliente tengan la MISMA
      // forma: al front le toca pintar, no averiguar qué campos existen.
      obras_descubiertas: 0,
    };
  }));

  res.json({ clientes: enriquecidos });
});

// POST /api/admin/clientes -> alta de la empresa y, de una vez, su primer acceso
router.post('/clientes', soloOperador, async (req, res) => {
  const { razon_social, rfc, telefono, tipo, vendedor_id, email, password, nombre_contacto } = req.body || {};
  if (!razon_social || !email || !password) {
    return res.status(400).json({ error: 'Razón social, correo y contraseña son obligatorios' });
  }

  // El contratante se da de alta igual que el fiado —misma ficha, mismo primer
  // acceso—; lo único distinto es el tipo, y de ahí cuelga todo lo que ve.
  const tipoFinal = tipoValido(tipo);
  if (!tipoFinal) return res.status(400).json({ error: 'El tipo debe ser fiado o contratante' });

  let clienteId;
  try {
    const row = await db.prepare(
      `INSERT INTO clients (razon_social, rfc, telefono, tipo, vendedor_id)
       VALUES (?, ?, ?, ?, ?) RETURNING id`
    ).get(razon_social, rfc || null, telefono || null, tipoFinal,
          vendedor_id ? Number(vendedor_id) : null);
    clienteId = row.id;
  } catch (e) {
    return res.status(400).json({ error: 'No se pudo crear (¿RFC duplicado?)', detail: e.message });
  }

  // El alta son dos inserciones y el driver HTTP no da transacciones. Si la
  // segunda falla (correo repetido, casi siempre), se deshace la primera: una
  // empresa sin ninguna cuenta con la que entrar no le sirve a nadie y encima
  // le bloquea el RFC al siguiente intento.
  try {
    await crearUsuario({
      nombre: nombre_contacto || razon_social,
      email,
      password,
      role: 'client',
      clientId: clienteId,
    });
  } catch (e) {
    await db.prepare('DELETE FROM clients WHERE id = ?').run(clienteId);
    return res.status(e.status || 400).json({ error: e.message });
  }

  res.json({ ok: true, id: clienteId });
});

// PUT /api/admin/clientes/:id -> actualizar datos básicos
router.put('/clientes/:id', soloOperador, async (req, res) => {
  const { razon_social, telefono } = req.body || {};
  await db.prepare(
    `UPDATE clients SET razon_social = COALESCE(?, razon_social),
       telefono = COALESCE(?, telefono)
     WHERE id = ?`
  ).run(razon_social ?? null, telefono ?? null, Number(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/admin/clientes/:id  { confirmar: "<razón social>" }
//
// Se lleva el historial completo del fiado y no hay deshacer, así que se pide
// teclear la razón social. Un `confirm()` del navegador no basta: se acepta sin
// leerlo, y aquí el clic equivocado borra las pólizas de un cliente real.
router.delete('/clientes/:id', soloAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const cliente = await db.prepare('SELECT razon_social FROM clients WHERE id = ?').get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  if (String(req.body?.confirmar || '').trim() !== cliente.razon_social) {
    return res.status(400).json({
      error: `Para eliminarlo hay que escribir su razón social exactamente: "${cliente.razon_social}".`,
    });
  }

  const borrado = await eliminarCliente(id);
  res.json({ ok: true, cliente: cliente.razon_social, borrado });
});

// PUT /api/admin/clientes/:id/vendedor -> el vendedor titular de la cuenta
//
// Se admite cualquier cuenta interna y no solo las de rol vendedor: un admin o
// un operador también llevan cuentas propias. Para ellos el campo no limita
// nada, porque de todas formas ven todo.
router.put('/clientes/:id/vendedor', soloOperador, async (req, res) => {
  const vendedorId = req.body?.vendedor_id ? Number(req.body.vendedor_id) : null;

  if (vendedorId) {
    const u = await db
      .prepare(`SELECT id FROM users WHERE id = ? AND client_id IS NULL AND activo = 1`)
      .get(vendedorId);
    if (!u) return res.status(400).json({ error: 'Esa cuenta no existe o está dada de baja' });
  }

  await db.prepare('UPDATE clients SET vendedor_id = ? WHERE id = ?')
    .run(vendedorId, Number(req.params.id));
  res.json({ ok: true });
});

// --- Los PROYECTOS de un contratante, desde el panel ---
//
// El contratante los registra desde su portal, y Fortex por la MISMA puerta
// (services/desarrollos.js). Hacen falta las dos: al dar de alta la cuenta, el
// operador captura el desarrollo antes de que el desarrollador entre por primera
// vez, y sin esto no habría a qué ligarle las obras de sus proveedores.
//
// Va con exigirCliente y no soloOperador: es captura en nombre del cliente, como
// el expediente, y al vendedor lo acota su cartera.

// GET /api/admin/clientes/:id/proyectos -> los proyectos de ese contratante
router.get('/clientes/:id/proyectos', async (req, res) => {
  await exigirCliente(req.user, req.params.id);
  res.json({ proyectos: await desarrollosDe(req.params.id) });
});

router.post('/clientes/:id/proyectos', async (req, res) => {
  const contratanteId = Number(req.params.id);
  await exigirCliente(req.user, contratanteId);
  if ((await tipoDe(contratanteId)) !== 'contratante') {
    return res.status(400).json({
      error: 'Solo una cuenta de tipo contratante tiene proyectos propios. Un fiado captura obras.',
    });
  }

  const fila = await crearDesarrollo(contratanteId, req.body || {});
  res.json({ ok: true, id: fila.id });
});

// El :proyectoId se comprueba contra el contratante del path, no solo por id:
// si no, con el id de un proyecto ajeno se podría editar el de otro cliente.
async function exigirProyectoDelContratante(contratanteId, proyectoId) {
  const fila = await db
    .prepare('SELECT id FROM desarrollos WHERE id = ? AND contratante_id = ?')
    .get(Number(proyectoId), Number(contratanteId));
  return Boolean(fila);
}

router.put('/clientes/:id/proyectos/:proyectoId', async (req, res) => {
  await exigirCliente(req.user, req.params.id);
  if (!(await exigirProyectoDelContratante(req.params.id, req.params.proyectoId))) {
    return res.status(404).json({ error: 'Ese proyecto no es de este cliente' });
  }

  await actualizarDesarrollo(req.params.proyectoId, req.body || {});
  res.json({ ok: true });
});

router.delete('/clientes/:id/proyectos/:proyectoId', async (req, res) => {
  await exigirCliente(req.user, req.params.id);
  if (!(await exigirProyectoDelContratante(req.params.id, req.params.proyectoId))) {
    return res.status(404).json({ error: 'Ese proyecto no es de este cliente' });
  }

  await eliminarDesarrollo(req.params.proyectoId, req.params.id);
  res.json({ ok: true });
});

// --- Las PARTIDAS de un proyecto de contratante, desde el panel ---
//
// El desarrollador las captura desde su portal y Fortex por aquí, igual que los
// proyectos: al dar de alta la cuenta hay que armarle la obra antes de que él
// entre, y sin partidas no hay a qué asignarle los contratos.

// La partida tiene que ser de un desarrollo DE ESTE contratante. Se comprueba
// contra el cliente del path y no solo por id: si no, con el id de una partida
// ajena se editaría la de otro.
async function esPartidaDelContratante(contratanteId, partidaId) {
  const fila = await db.prepare(
    `SELECT pa.id FROM partidas pa
     JOIN desarrollos d ON d.id = pa.desarrollo_id
     WHERE pa.id = ? AND d.contratante_id = ?`
  ).get(Number(partidaId), Number(contratanteId));
  return Boolean(fila);
}

// GET /api/admin/clientes/:id/proyectos/:proyectoId/partidas
router.get('/clientes/:id/proyectos/:proyectoId/partidas', async (req, res) => {
  await exigirCliente(req.user, req.params.id);
  if (!(await exigirProyectoDelContratante(req.params.id, req.params.proyectoId))) {
    return res.status(404).json({ error: 'Ese proyecto no es de este cliente' });
  }
  res.json({ partidas: await partidasDe(req.params.proyectoId) });
});

router.post('/clientes/:id/proyectos/:proyectoId/partidas', async (req, res) => {
  await exigirCliente(req.user, req.params.id);
  if (!(await exigirProyectoDelContratante(req.params.id, req.params.proyectoId))) {
    return res.status(404).json({ error: 'Ese proyecto no es de este cliente' });
  }
  const fila = await crearPartida(req.params.proyectoId, req.body || {});
  res.json({ ok: true, id: fila.id });
});

router.put('/clientes/:id/partidas/:partidaId', async (req, res) => {
  await exigirCliente(req.user, req.params.id);
  if (!(await esPartidaDelContratante(req.params.id, req.params.partidaId))) {
    return res.status(404).json({ error: 'Esa partida no es de este cliente' });
  }
  await actualizarPartida(req.params.partidaId, req.body || {});
  res.json({ ok: true });
});

router.delete('/clientes/:id/partidas/:partidaId', async (req, res) => {
  await exigirCliente(req.user, req.params.id);
  if (!(await esPartidaDelContratante(req.params.id, req.params.partidaId))) {
    return res.status(404).json({ error: 'Esa partida no es de este cliente' });
  }
  await eliminarPartida(req.params.partidaId);
  res.json({ ok: true });
});

// PUT /api/admin/clientes/:id/tipo  { tipo }
//
// Pasar de fiado a contratante (o al revés) cambia la pantalla COMPLETA que ve
// esa empresa al entrar. Va por su propia ruta y con guardas, porque lo que no
// se puede permitir es dejar información capturada del lado que no la muestra:
// se quedaría viva en la base —cobrando línea, disparando avisos— sin que nadie
// la volviera a ver.
router.put('/clientes/:id/tipo', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  const tipo = tipoValido(req.body?.tipo);
  if (!tipo) return res.status(400).json({ error: 'El tipo debe ser fiado o contratante' });

  const actual = await db.prepare('SELECT tipo FROM clients WHERE id = ?').get(id);
  if (!actual) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (actual.tipo === tipo) return res.json({ ok: true, tipo, sin_cambio: true });

  const contar = async (sql) => (await db.prepare(sql).get(id)).c;

  if (tipo === 'contratante') {
    const proyectos = await contar('SELECT COUNT(*)::int c FROM proyectos WHERE client_id = ?');
    const fianzas = await contar('SELECT COUNT(*)::int c FROM fianzas WHERE client_id = ?');
    const lineas = await contar('SELECT COUNT(*)::int c FROM client_credit_lines WHERE client_id = ?');
    const expediente = await contar('SELECT COUNT(*)::int c FROM client_documents WHERE client_id = ?');
    const papeleria = await contar('SELECT COUNT(*)::int c FROM papeleria_requests WHERE client_id = ?');
    if (proyectos || fianzas || lineas || expediente || papeleria) {
      return res.status(400).json({
        error: `No se puede: tiene ${proyectos} obra(s), ${fianzas} póliza(s), ${lineas} línea(s) de `
             + `crédito, ${expediente} documento(s) de expediente y ${papeleria} solicitud(es) de `
             + 'papelería. Un contratante no tiene esas pantallas, así que quedarían capturadas sin '
             + 'que nadie las viera.',
      });
    }
    // Y esto es lo que dejaría un estado imposible: un contratante no puede ser
    // proveedor de nadie (el POST del padrón lo rechaza), así que si ya está en
    // el padrón de alguien, cambiarle el tipo lo dejaría ahí para siempre —
    // visible para ese contratante y sin forma de volverlo a agregar.
    const enPadrones = await contar(
      'SELECT COUNT(*)::int c FROM client_proveedores WHERE proveedor_id = ?'
    );
    if (enPadrones) {
      return res.status(400).json({
        error: `No se puede: es proveedor en ${enPadrones} padrón(es). Un contratante no le presenta `
             + 'fianzas a nadie: sácalo de esos padrones primero.',
      });
    }
  } else {
    const padron = await contar('SELECT COUNT(*)::int c FROM client_proveedores WHERE contratante_id = ?');
    const obras = await contar('SELECT COUNT(*)::int c FROM proyectos WHERE contratante_id = ?');
    if (padron || obras) {
      return res.status(400).json({
        error: `No se puede: tiene ${padron} proveedor(es) en su padrón y ${obras} obra(s) ligada(s). `
             + 'Un fiado no tiene padrón: quita esas ligas antes de cambiarle el tipo.',
      });
    }
  }

  await db.prepare('UPDATE clients SET tipo = ? WHERE id = ?').run(tipo, id);
  res.json({ ok: true, tipo });
});

// --- Padrón de proveedores de un contratante ---
//
// Quién le tiene que presentar fianza a quién. Va soloOperador: meter a una
// empresa en el padrón de otra es una decisión de la casa, no de quien atiende
// la cuenta.
//
// Estar en el padrón NO le enseña al contratante ni una póliza: eso lo abre la
// liga de la OBRA (proyectos.contratante_id). El padrón sirve para lo otro, que
// es justo lo que el desarrollador quiere saber: a quién le falta presentarla.

// POST /api/admin/clientes/:id/proveedores
//   { proveedor_id, alias, notas }                          -> liga uno que ya existe
//   { razon_social, rfc, telefono, alias, notas,
//     email?, password?, nombre_contacto? }                 -> lo crea y lo liga
//
// Los dos caminos, porque en la práctica el proveedor casi nunca está dado de
// alta, y mandar al operador a "Agregar cliente" primero le pide correo y
// contraseña — que de un proveedor al que nada más se le vigila la fianza casi
// nunca se tienen a la mano. Aquí el acceso al portal es OPCIONAL: un proveedor
// puede vivir en el padrón sin que nadie de esa empresa entre nunca, con Fortex
// capturándole la fianza.
router.post('/clientes/:id/proveedores', soloOperador, async (req, res) => {
  const contratanteId = Number(req.params.id);

  const contratante = await db
    .prepare('SELECT tipo, vendedor_id FROM clients WHERE id = ?')
    .get(contratanteId);
  if (!contratante) return res.status(404).json({ error: 'Cliente no encontrado' });
  if (contratante.tipo !== 'contratante') {
    return res.status(400).json({
      error: 'Solo una cuenta de tipo contratante lleva padrón de proveedores',
    });
  }

  let proveedorId = Number(req.body?.proveedor_id) || null;
  let creado = false;

  if (!proveedorId) {
    const razonSocial = String(req.body?.razon_social || '').trim();
    if (!razonSocial) {
      return res.status(400).json({
        error: 'Elige un cliente que ya exista o escribe la razón social del proveedor nuevo',
      });
    }

    try {
      const row = await db.prepare(
        `INSERT INTO clients (razon_social, rfc, telefono, tipo, vendedor_id)
         VALUES (?, ?, ?, 'fiado', ?) RETURNING id`
        // Hereda el vendedor titular del contratante: quien lleva la cuenta del
        // desarrollador es quien va a perseguir a sus proveedores —ahí está su
        // venta—, así que el proveedor le aparece en su cartera desde el primer
        // día en vez de quedar sin asignar.
      ).get(razonSocial, req.body?.rfc || null, req.body?.telefono || null,
            contratante.vendedor_id ?? null);
      proveedorId = row.id;
      creado = true;
    } catch (e) {
      return res.status(400).json({
        error: 'No se pudo crear el proveedor (¿RFC duplicado?)', detail: e.message,
      });
    }

    // El acceso al portal va aparte porque es opcional. Si falla (casi siempre,
    // correo repetido) se deshace el alta: una empresa a medias con el RFC ya
    // bloqueado es peor que ninguna. Es la misma cautela que en POST /clientes.
    if (req.body?.email) {
      try {
        await crearUsuario({
          nombre: req.body?.nombre_contacto || razonSocial,
          email: req.body.email,
          password: req.body.password,
          role: 'client',
          clientId: proveedorId,
        });
      } catch (e) {
        await db.prepare('DELETE FROM clients WHERE id = ?').run(proveedorId);
        return res.status(e.status || 400).json({ error: e.message });
      }
    }
  }

  if (proveedorId === contratanteId) {
    return res.status(400).json({ error: 'Una empresa no puede ser su propio proveedor' });
  }

  // El proveedor es un fiado normal: es quien presenta la fianza. Un contratante
  // no presenta ninguna, así que ligarlo como proveedor de otro no significaría
  // nada y dejaría dos padrones cruzados.
  const proveedor = await db.prepare('SELECT tipo FROM clients WHERE id = ?').get(proveedorId);
  if (!proveedor) return res.status(404).json({ error: 'Ese proveedor no existe' });
  if (proveedor.tipo !== 'fiado') {
    return res.status(400).json({ error: 'El proveedor tiene que ser una cuenta de tipo fiado' });
  }

  // Volver a agregarlo lo REACTIVA: es lo que se espera al volver a contratar a
  // alguien que se había suspendido, y aquí sí es una decisión explícita (a
  // diferencia de asegurarEnPadron, que no des-suspende).
  await db.prepare(
    `INSERT INTO client_proveedores (contratante_id, proveedor_id, alias, notas)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (contratante_id, proveedor_id) DO UPDATE SET activo = 1`
  ).run(contratanteId, proveedorId, req.body?.alias || null, req.body?.notas || null);

  // El alias y las notas se actualizan APARTE, y solo los que de verdad
  // vinieron. Con un `excluded.*` a secas, reactivar a un proveedor desde el
  // formulario de "ya es cliente" —que no dibuja el campo de notas— le borraba
  // al contratante la nota que tenía escrita.
  const cambios = [];
  const valores = [];
  for (const campo of ['alias', 'notas']) {
    if (campo in (req.body || {})) {
      cambios.push(`${campo} = ?`);
      valores.push(req.body[campo] || null);
    }
  }
  if (cambios.length) {
    await db.prepare(
      `UPDATE client_proveedores SET ${cambios.join(', ')}
       WHERE contratante_id = ? AND proveedor_id = ?`
    ).run(...valores, contratanteId, proveedorId);
  }

  res.json({ ok: true, proveedor_id: proveedorId, creado });
});

// PUT /api/admin/clientes/:id/proveedores/:proveedorId  { activo, alias, notas }
//
// Suspender es la baja NORMAL, y es la que hay que usar: el proveedor sale del
// padrón y el contratante deja de alcanzar sus obras en el mismo instante —el
// activo es una de las dos condiciones del alcance, ver lib/permisos.js—, pero
// queda el historial de lo que sí presentó.
router.put('/clientes/:id/proveedores/:proveedorId', soloOperador, async (req, res) => {
  const { activo, alias, notas } = req.body || {};
  const sets = [];
  const valores = [];
  if (activo !== undefined) { sets.push('activo = ?'); valores.push(activo ? 1 : 0); }
  if (alias !== undefined) { sets.push('alias = ?'); valores.push(alias || null); }
  if (notas !== undefined) { sets.push('notas = ?'); valores.push(notas || null); }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

  const { rows } = await db.prepare(
    `UPDATE client_proveedores SET ${sets.join(', ')}
     WHERE contratante_id = ? AND proveedor_id = ? RETURNING id`
  ).run(...valores, Number(req.params.id), Number(req.params.proveedorId));
  if (!rows.length) return res.status(404).json({ error: 'Ese proveedor no está en el padrón' });

  res.json({ ok: true });
});

// DELETE /api/admin/clientes/:id/proveedores/:proveedorId
//
// Borra LA LIGA, no la empresa: el proveedor sigue siendo cliente de Fortex con
// todas sus obras y pólizas. Esto es para la liga que nunca debió existir (se
// agregó al padrón equivocado). Para dejar de trabajar con alguien, lo correcto
// es SUSPENDERLO con el PUT de arriba, que conserva el historial.
//
// Se niega si todavía hay obras ligadas: quitarlo del padrón dejaría al
// contratante viendo las fianzas de esas obras sin el proveedor en su lista, y
// nadie sabría de quién es ese renglón. Primero se desliga la obra.
router.delete('/clientes/:id/proveedores/:proveedorId', soloOperador, async (req, res) => {
  const contratanteId = Number(req.params.id);
  const proveedorId = Number(req.params.proveedorId);

  const { c } = await db.prepare(
    'SELECT COUNT(*)::int c FROM proyectos WHERE contratante_id = ? AND client_id = ?'
  ).get(contratanteId, proveedorId);
  if (c > 0) {
    return res.status(400).json({
      error: `Ese proveedor tiene ${c} obra(s) ligada(s) a este contratante. Quítale la liga en la `
           + 'obra (el campo "Para") antes de sacarlo del padrón.',
    });
  }

  await db.prepare(
    'DELETE FROM client_proveedores WHERE contratante_id = ? AND proveedor_id = ?'
  ).run(contratanteId, proveedorId);
  res.json({ ok: true });
});

// PUT /api/admin/clientes/:id/lineas -> fijar/actualizar la línea de una afianzadora (upsert)
router.put('/clientes/:id/lineas', soloOperador, async (req, res) => {
  const clientId = Number(req.params.id);
  const { afianzadora_id, linea_credito } = req.body || {};
  if (!afianzadora_id) return res.status(400).json({ error: 'afianzadora_id requerido' });
  await exigirFiado(clientId, 'líneas de crédito');
  await db.prepare(
    `INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito)
     VALUES (?, ?, ?)
     ON CONFLICT(client_id, afianzadora_id)
       DO UPDATE SET linea_credito = excluded.linea_credito`
  ).run(clientId, Number(afianzadora_id), centavos(linea_credito));
  res.json({ ok: true });
});

// DELETE /api/admin/clientes/:id/lineas/:afianzadoraId -> quitar línea de una afianzadora
router.delete('/clientes/:id/lineas/:afianzadoraId', soloOperador, async (req, res) => {
  await db.prepare(
    'DELETE FROM client_credit_lines WHERE client_id = ? AND afianzadora_id = ?'
  ).run(Number(req.params.id), Number(req.params.afianzadoraId));
  res.json({ ok: true });
});

// --- Afianzadoras ---

router.get('/afianzadoras', async (req, res) => {
  res.json({ afianzadoras: await db.prepare('SELECT * FROM afianzadoras ORDER BY nombre').all() });
});

// POST /api/admin/afianzadoras -> agregar nueva afianzadora (escalable)
router.post('/afianzadoras', soloOperador, async (req, res) => {
  const { nombre } = req.body || {};
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  const slug = slugify(nombre);
  try {
    const row = await db.prepare('INSERT INTO afianzadoras (nombre, slug) VALUES (?, ?) RETURNING id').get(nombre, slug);
    res.json({ ok: true, id: row.id, slug });
  } catch (e) {
    res.status(400).json({ error: 'Afianzadora duplicada', detail: e.message });
  }
});

// --- Catálogo de tipos de fianza ---

router.get('/tipos-fianza', async (req, res) => {
  const tipos = await db
    .prepare('SELECT id, nombre, orden, activo FROM tipos_fianza WHERE activo = 1 ORDER BY orden, nombre')
    .all();
  res.json({ tipos });
});

router.post('/tipos-fianza', soloOperador, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    // Si el tipo existía y estaba desactivado, se reactiva en vez de duplicarlo.
    const row = await db.prepare(
      `INSERT INTO tipos_fianza (nombre, orden) VALUES (?, 500)
       ON CONFLICT (nombre) DO UPDATE SET activo = 1
       RETURNING id`
    ).get(nombre);
    res.json({ ok: true, id: row.id });
  } catch (e) {
    res.status(400).json({ error: 'No se pudo agregar el tipo', detail: e.message });
  }
});

// Baja lógica: las fianzas que ya lo usan conservan su tipo.
router.delete('/tipos-fianza/:id', soloOperador, async (req, res) => {
  await db.prepare('UPDATE tipos_fianza SET activo = 0 WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// --- Proyectos (obras) ---

const CAMPOS_PROYECTO = ['nombre', 'numero_contrato', 'beneficiario', 'monto_contrato',
                         'fecha_inicio', 'fecha_termino', 'estatus', 'notas',
                         'contratante_id', 'desarrollo_id', 'partida_id'];

// La PARTIDA manda sobre el desarrollo, y el desarrollo sobre el contratante.
// Tres columnas que hablan de lo mismo, y dos que salen de la primera: es la
// única forma de que no puedan discrepar.
//
// Devuelve { partida_id, desarrollo_id, contratante_id } o { error }.
async function resolverPartida(partidaId) {
  const pa = await db.prepare(
    `SELECT pa.id, pa.desarrollo_id, d.contratante_id
     FROM partidas pa
     JOIN desarrollos d ON d.id = pa.desarrollo_id
     WHERE pa.id = ?`
  ).get(Number(partidaId));
  if (!pa) return { error: 'Esa partida no existe' };
  return {
    partida_id: pa.id,
    desarrollo_id: pa.desarrollo_id,
    contratante_id: pa.contratante_id,
  };
}

// El DESARROLLO manda sobre el contratante. Si la obra se mete en un proyecto de
// un contratante, el contratante sale de ahí: no se le cree al body.
//
// Con dos columnas que dicen lo mismo —contratante_id y desarrollo_id— la única
// forma de que no discrepen es que una sea la fuente y la otra se derive. Y la
// que autoriza sigue siendo contratante_id, que es la que ve lib/permisos.js.
//
// Devuelve { desarrollo_id, contratante_id } o { error }.
async function resolverDesarrollo(desarrolloId) {
  const d = await db
    .prepare('SELECT id, contratante_id FROM desarrollos WHERE id = ?')
    .get(Number(desarrolloId));
  if (!d) return { error: 'Ese proyecto de contratante no existe' };
  return { desarrollo_id: d.id, contratante_id: d.contratante_id };
}

// Ligar la obra a un contratante es lo que le abre a ESA OTRA EMPRESA las
// pólizas de esta obra. Por eso se comprueban tres cosas y no una:
//   - que el contratante exista;
//   - que sea de tipo contratante — ligarla a otro fiado le enseñaría las
//     pólizas de este cliente a un competidor suyo;
//   - que no sea el mismo fiado que ejecuta la obra.
async function validarContratante(contratanteId, clientId) {
  if (!contratanteId) return null;
  const c = await db.prepare('SELECT tipo FROM clients WHERE id = ?').get(Number(contratanteId));
  if (!c) return 'El contratante no existe';
  if (c.tipo !== 'contratante') {
    return 'Esa cuenta no es de tipo contratante, y solo un contratante puede ver las fianzas '
         + 'de sus proveedores.';
  }
  if (Number(contratanteId) === Number(clientId)) {
    return 'Una obra no puede ser para el mismo fiado que la ejecuta';
  }
  return null;
}

// El vendedor captura la obra de su cliente, pero NO la liga a un contratante:
// eso le abre las pólizas de su cliente a otra empresa, y una vez que el
// contratante las vio, no hay cómo deshacerlo. Es de la casa, como las líneas
// de crédito.
const puedeLigarContratante = (user) => user?.role === 'admin' || user?.role === 'operador';

const NO_PUEDE_LIGAR = 'Ligar la obra a un contratante le abre las pólizas de este cliente a otra '
  + 'empresa, y eso no se deshace. Pídeselo a un operador.';

// Ligar una obra mete al proveedor en el padrón del contratante si no estaba.
// Sin esto, el desarrollador vería la fianza de la obra pero no al proveedor en
// su lista, y quedaría un renglón sin dueño aparente.
//
// DO NOTHING y no un UPDATE: si al proveedor lo SUSPENDIERON del padrón, volver
// a capturarle una obra no lo des-suspende. Eso sería reabrirle la puerta a
// otra empresa desde una pantalla de captura de obras, sin que nadie lo
// decidiera. Pero entonces el operador tiene que enterarse de que la obra quedó
// ligada y aun así invisible, y para eso se devuelve el aviso.
async function asegurarEnPadron(contratanteId, proveedorId) {
  if (!contratanteId) return null;
  await db.prepare(
    `INSERT INTO client_proveedores (contratante_id, proveedor_id)
     VALUES (?, ?) ON CONFLICT (contratante_id, proveedor_id) DO NOTHING`
  ).run(Number(contratanteId), Number(proveedorId));

  const fila = await db.prepare(
    'SELECT activo FROM client_proveedores WHERE contratante_id = ? AND proveedor_id = ?'
  ).get(Number(contratanteId), Number(proveedorId));
  return fila?.activo === 1 ? null : 'padron_suspendido';
}

const AVISO_SUSPENDIDO = 'La obra quedó ligada, pero ese proveedor está SUSPENDIDO en el padrón '
  + 'del contratante, así que el contratante todavía no la ve. Reactívalo en su padrón.';

router.post('/proyectos', async (req, res) => {
  const { client_id } = req.body || {};
  const nombre = String(req.body?.nombre || '').trim();
  if (!client_id || !nombre) {
    return res.status(400).json({ error: 'client_id y nombre son obligatorios' });
  }
  await exigirCliente(req.user, client_id);
  await exigirFiado(client_id, 'obras');

  // La cadena: partida manda sobre desarrollo, y desarrollo sobre contratante.
  let contratanteId = req.body?.contratante_id || null;
  let desarrolloId = req.body?.desarrollo_id || null;
  let partidaId = null;

  if (req.body?.partida_id) {
    const r = await resolverPartida(req.body.partida_id);
    if (r.error) return res.status(400).json({ error: r.error });
    if ((desarrolloId && Number(desarrolloId) !== r.desarrollo_id)
        || (contratanteId && Number(contratanteId) !== r.contratante_id)) {
      return res.status(400).json({
        error: 'Esa partida es de otro proyecto o de otro contratante. Elige la partida del '
             + 'proyecto correcto, o déjala sin asignar.',
      });
    }
    partidaId = r.partida_id;
    desarrolloId = r.desarrollo_id;
    contratanteId = r.contratante_id;
  } else if (desarrolloId) {
    const r = await resolverDesarrollo(desarrolloId);
    if (r.error) return res.status(400).json({ error: r.error });

    // Igual que en el PUT: si el body dice a la vez un desarrollo y un
    // contratante que no es su dueño, se rechaza. Derivar en silencio deja al
    // operador creyendo que capturó una cosa y guardó otra.
    if (contratanteId && Number(contratanteId) !== r.contratante_id) {
      return res.status(400).json({
        error: 'El proyecto que elegiste es de otro contratante. Elige el proyecto del '
             + 'contratante correcto, o déjalo sin agrupar.',
      });
    }

    desarrolloId = r.desarrollo_id;
    contratanteId = r.contratante_id;
  }

  if (contratanteId && !puedeLigarContratante(req.user)) {
    return res.status(403).json({ error: NO_PUEDE_LIGAR });
  }
  const errContratante = await validarContratante(contratanteId, client_id);
  if (errContratante) return res.status(400).json({ error: errContratante });

  const row = await db.prepare(
    `INSERT INTO proyectos (client_id, nombre, numero_contrato, beneficiario, monto_contrato,
                            fecha_inicio, fecha_termino, estatus, notas,
                            contratante_id, desarrollo_id, partida_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(Number(client_id), nombre,
        req.body.numero_contrato || null, req.body.beneficiario || null,
        centavos(req.body.monto_contrato),
        req.body.fecha_inicio || null, req.body.fecha_termino || null,
        req.body.estatus || 'en_proceso', req.body.notas || null,
        contratanteId ? Number(contratanteId) : null,
        desarrolloId ? Number(desarrolloId) : null, partidaId);

  const aviso = await asegurarEnPadron(contratanteId, client_id);
  res.json({ ok: true, id: row.id, aviso: aviso ? AVISO_SUSPENDIDO : null });
});

router.put('/proyectos/:id', async (req, res) => {
  const id = Number(req.params.id);
  const clientId = await exigirEntidad(req.user, 'proyecto', id);

  const body = { ...(req.body || {}) };
  if ('monto_contrato' in body) body.monto_contrato = centavos(body.monto_contrato);

  // La PARTIDA va primero de todo, porque es la que fija el desarrollo y con él
  // el contratante. Asignarle un fiado a "muros" es, en una sola operación,
  // decir de qué obra es y quién la va a ver.
  //
  // Vaciarla desasigna el contrato de ese pedazo de obra pero NO lo saca del
  // desarrollo ni lo desliga del contratante: son tres cosas y se piden aparte.
  if ('partida_id' in body) {
    const pedido = body.partida_id ? Number(body.partida_id) : null;
    if (pedido === null) {
      body.partida_id = null;
    } else {
      const r = await resolverPartida(pedido);
      if (r.error) return res.status(400).json({ error: r.error });

      // Si el body ADEMÁS nombra un desarrollo o un contratante que no son los
      // de esa partida, se rechaza en vez de derivar en silencio. Es la misma
      // razón que abajo: derivando, una petición que pedía una cosa guardaba
      // otra y contestaba 200.
      const contradice = (campo, esperado) => {
        if (!(campo in body)) return false;
        const v = body[campo] ? Number(body[campo]) : null;
        return v !== esperado;
      };
      if (contradice('desarrollo_id', r.desarrollo_id)
          || contradice('contratante_id', r.contratante_id)) {
        return res.status(400).json({
          error: 'Esa partida es de otro proyecto o de otro contratante. Elige la partida '
               + 'del proyecto correcto, o déjala sin asignar.',
        });
      }

      body.partida_id = r.partida_id;
      body.desarrollo_id = r.desarrollo_id;
      body.contratante_id = r.contratante_id;
    }
  }

  // El desarrollo va DESPUÉS de la partida y ANTES del contratante, por lo
  // mismo: cuando viene, es el que fija el contratante.
  //
  // Vaciarlo saca la obra del proyecto pero NO la desliga del contratante: son
  // dos cosas distintas y la segunda se pide aparte, vaciando "Para".
  if ('desarrollo_id' in body) {
    const pedido = body.desarrollo_id ? Number(body.desarrollo_id) : null;
    if (pedido === null) {
      body.desarrollo_id = null;
    } else {
      const r = await resolverDesarrollo(pedido);
      if (r.error) return res.status(400).json({ error: r.error });

      // Si el body ADEMÁS trae un contratante y no es el dueño de ese
      // desarrollo, se rechaza en vez de derivar en silencio.
      //
      // Derivando, "desliga esta obra" acababa en 200 SIN DESLIGAR NADA: el
      // formulario mandaba el desarrollo viejo junto con el contratante vacío,
      // el desarrollo reponía al contratante de antes, y el operador leía
      // "Proyecto actualizado" mientras la otra empresa seguía viendo las
      // pólizas. Una revocación que falla en silencio es lo peor que puede
      // hacer esta ruta.
      if ('contratante_id' in body) {
        const pedidoContratante = body.contratante_id ? Number(body.contratante_id) : null;
        if (pedidoContratante !== r.contratante_id) {
          return res.status(400).json({
            error: 'Esa obra está dentro de un proyecto de otro contratante. Sácala del '
                 + 'proyecto —déjalo en "sin agrupar"— antes de cambiarle el contratante.',
          });
        }
      }

      body.desarrollo_id = r.desarrollo_id;
      body.contratante_id = r.contratante_id;
      // Cambiar de desarrollo desasigna la partida: era de OTRO desarrollo, y
      // dejarla haría que las tres columnas discreparan. Si la petición nombró
      // la partida, el bloque de arriba ya la puso y ya comprobó que cuadra.
      if (!('partida_id' in body)) body.partida_id = null;
    }
  }

  // Vacío significa "para nadie del portal": la obra se desliga y el
  // contratante deja de ver sus fianzas.
  //
  // La guarda compara VALORES y no la presencia del campo. Tiene que ser así
  // porque el formulario manda `contratante_id` siempre —también vacío, que es
  // la única forma de poder desligar—: con una guarda por presencia, un
  // vendedor recibía 403 al guardar CUALQUIER edición de CUALQUIER obra suya,
  // aunque no tocara ese campo y aunque la obra no tuviera contratante.
  if ('contratante_id' in body) {
    const pedido = body.contratante_id ? Number(body.contratante_id) : null;
    const actual = (await db.prepare('SELECT contratante_id FROM proyectos WHERE id = ?')
      .get(id))?.contratante_id ?? null;

    if (pedido === actual) {
      // No cambia nada: no hay nada que autorizar ni que escribir.
      delete body.contratante_id;
    } else {
      if (!puedeLigarContratante(req.user)) return res.status(403).json({ error: NO_PUEDE_LIGAR });
      const err = await validarContratante(pedido, clientId);
      if (err) return res.status(400).json({ error: err });
      body.contratante_id = pedido;
      // Cambiar de contratante —o desligarla— saca la obra del desarrollo
      // anterior, que era del contratante de antes. Si se quedara, las dos
      // columnas discreparían, que es justo lo que este par existe para evitar:
      // la obra contaría en las métricas de uno y aparecería en el proyecto de
      // otro. Cuando la petición SÍ nombró un desarrollo, el bloque de arriba ya
      // lo puso y ya comprobó que el contratante coincide.
      if (!('desarrollo_id' in body)) body.desarrollo_id = null;
      // Y con el desarrollo se va la partida, que colgaba de él.
      if (!('partida_id' in body)) body.partida_id = null;
    }
  }

  const { sets, valores } = camposAActualizar(body, CAMPOS_PROYECTO);
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  await db.prepare(`UPDATE proyectos SET ${sets.join(', ')} WHERE id = ?`)
    .run(...valores, id);

  const aviso = await asegurarEnPadron(body.contratante_id, clientId);
  res.json({ ok: true, aviso: aviso ? AVISO_SUSPENDIDO : null });
});

// Solo se permite borrar proyectos sin fianzas: si tiene, hay que moverlas antes.
router.delete('/proyectos/:id', async (req, res) => {
  const id = Number(req.params.id);
  await exigirEntidad(req.user, 'proyecto', id);

  const { c } = await db.prepare('SELECT COUNT(*)::int c FROM fianzas WHERE proyecto_id = ?').get(id);
  if (c > 0) {
    return res.status(400).json({
      error: `El proyecto tiene ${c} fianza(s). Reasígnalas a otro proyecto antes de eliminarlo.`,
    });
  }

  // Borrar la obra se lleva TODOS los archivos que cuelgan de ella, y desde que
  // el contratante tiene su carpeta ahí puede haber archivos de OTRA empresa.
  // Esta ruta autoriza contra el dueño de la OBRA, así que sin esto era la
  // puerta ancha por la que un vendedor destruía archivos de una cuenta que no
  // alcanza — exactamente lo que DELETE /documentos/:id le niega con un 403.
  //
  // Se exige lo mismo por los dos caminos: hay que alcanzar a cada dueño de lo
  // que se va. Para un admin u operador no cambia nada (alcanzan todo); al
  // vendedor lo frena, que es el punto.
  const ajenos = await db.prepare(
    `SELECT d.client_id
     FROM documentos d
     WHERE d.entidad_tipo = 'proyecto' AND d.entidad_id = ?
       AND d.client_id <> (SELECT client_id FROM proyectos WHERE id = ?)`
  ).all(id, id);
  for (const dueno of new Set(ajenos.map((a) => a.client_id))) {
    await exigirCliente(req.user, dueno);
  }

  await borrarDocumentosDe('proyecto', id);
  await db.prepare('DELETE FROM proyectos WHERE id = ?').run(id);
  // Se dice cuántos archivos de terceros se fueron: un {ok:true} pelón esconde
  // que el borrado también vació la carpeta de un contratante.
  res.json({ ok: true, archivos_de_terceros: ajenos.length });
});

// --- Fianzas (pólizas) ---

const CAMPOS_FIANZA = ['clase', 'proyecto_id', 'afianzadora_id', 'numero_poliza', 'tipo_fianza_id',
                       'prima_neta', 'prima_total', 'monto_afianzado',
                       'fecha_inicio', 'fecha_vigencia',
                       'fecha_recordatorio', 'nota_recordatorio'];

// Todo lo que es dinero y puede venir en el body de una fianza.
const MONTOS_FIANZA = ['prima_neta', 'prima_total', 'monto_afianzado'];

// Tiene que coincidir con el CHECK de la columna 'clase' (schema.js).
const CLASES_FIANZA = ['fianza', 'previo'];

// Construye el SET de un UPDATE solo con los campos que vienen en el body.
// A diferencia de COALESCE, esto sí permite vaciar un campo mandando null.
function camposAActualizar(body, permitidos) {
  const sets = [];
  const valores = [];
  for (const campo of permitidos) {
    if (!(campo in (body || {}))) continue;
    const v = body[campo];
    sets.push(`${campo} = ?`);
    valores.push(v === '' ? null : v);
  }
  return { sets, valores };
}

// Valida que el proyecto exista y sea del cliente; devuelve el error o null.
async function validarProyecto(proyectoId, clientId) {
  if (!proyectoId) return 'Toda fianza debe pertenecer a un proyecto';
  const p = await db.prepare('SELECT client_id FROM proyectos WHERE id = ?').get(Number(proyectoId));
  if (!p) return 'El proyecto no existe';
  if (clientId != null && p.client_id !== Number(clientId)) {
    return 'El proyecto pertenece a otro cliente';
  }
  return null;
}

// El tipo lo manda el catálogo; la fianza solo guarda la referencia.
async function tipoExiste(tipoId) {
  if (!tipoId) return false;
  const t = await db.prepare('SELECT id FROM tipos_fianza WHERE id = ?').get(Number(tipoId));
  return Boolean(t);
}

// Fianza emitida o previo (lo mismo, pero antes de que la afianzadora emita).
// Se captura igual; lo que cambia es que el previo no cuenta como pasivo. Si no
// viene nada, es fianza: así se comportaba todo lo que ya está capturado.
function claseValida(clase) {
  if (clase == null || clase === '') return 'fianza';
  return CLASES_FIANZA.includes(clase) ? clase : null;
}

// POST /api/admin/fianzas -> alta de póliza (o previo) dentro de un proyecto
router.post('/fianzas', async (req, res) => {
  const { client_id, clase, proyecto_id, afianzadora_id, numero_poliza, tipo_fianza_id,
          prima_neta, prima_total, monto_afianzado, fecha_inicio, fecha_vigencia,
          fecha_recordatorio, nota_recordatorio } = req.body || {};

  if (!client_id || !afianzadora_id || !numero_poliza) {
    return res.status(400).json({ error: 'Cliente, afianzadora y número de póliza son obligatorios' });
  }
  await exigirCliente(req.user, client_id);
  await exigirFiado(client_id, 'pólizas');

  const claseFinal = claseValida(clase);
  if (!claseFinal) return res.status(400).json({ error: 'La clase debe ser fianza o previo' });

  const errProyecto = await validarProyecto(proyecto_id, client_id);
  if (errProyecto) return res.status(400).json({ error: errProyecto });

  if (!(await tipoExiste(tipo_fianza_id))) {
    return res.status(400).json({ error: 'Selecciona un tipo de fianza del catálogo' });
  }

  const row = await db.prepare(
    `INSERT INTO fianzas
       (client_id, clase, proyecto_id, afianzadora_id, numero_poliza, tipo_fianza_id,
        prima_neta, prima_total, monto_afianzado, fecha_inicio, fecha_vigencia,
        fecha_recordatorio, nota_recordatorio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(Number(client_id), claseFinal,
        Number(proyecto_id), Number(afianzadora_id), numero_poliza,
        Number(tipo_fianza_id),
        centavos(prima_neta), centavos(prima_total), centavos(monto_afianzado),
        fecha_inicio || null, fecha_vigencia || null,
        fecha_recordatorio || null, nota_recordatorio || null);
  res.json({ ok: true, id: row.id });
});

// PUT /api/admin/fianzas/:id -> edición completa de la póliza
router.put('/fianzas/:id', async (req, res) => {
  const id = Number(req.params.id);
  await exigirEntidad(req.user, 'fianza', id);

  const actual = await db
    .prepare('SELECT client_id, fecha_recordatorio FROM fianzas WHERE id = ?')
    .get(id);
  if (!actual) return res.status(404).json({ error: 'Fianza no encontrada' });

  const body = { ...(req.body || {}) };

  if ('proyecto_id' in body) {
    const err = await validarProyecto(body.proyecto_id, actual.client_id);
    if (err) return res.status(400).json({ error: err });
    body.proyecto_id = Number(body.proyecto_id);
  }

  if ('tipo_fianza_id' in body) {
    if (!(await tipoExiste(body.tipo_fianza_id))) {
      return res.status(400).json({ error: 'Selecciona un tipo de fianza del catálogo' });
    }
    body.tipo_fianza_id = Number(body.tipo_fianza_id);
  }

  // Pasar un previo a fianza (o al revés) es cambiar solo esta columna: el
  // renglón capturado se conserva tal cual, que es justo lo que se quiere el
  // día que la afianzadora emite.
  if ('clase' in body) {
    const claseFinal = claseValida(body.clase);
    if (!claseFinal) return res.status(400).json({ error: 'La clase debe ser fianza o previo' });
    body.clase = claseFinal;
  }

  // Los montos llegan en centavos; se normalizan a entero por si acaso.
  for (const campo of MONTOS_FIANZA) {
    if (campo in body) body[campo] = centavos(body[campo]);
  }

  const { sets, valores } = camposAActualizar(body, CAMPOS_FIANZA);
  // Si le ponen una fecha de recordatorio distinta, el aviso vuelve a estar vivo
  // aunque el anterior ya se hubiera marcado como atendido.
  if ('fecha_recordatorio' in body && (body.fecha_recordatorio || null) !== actual.fecha_recordatorio) {
    sets.push('recordatorio_atendido_el = NULL');
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });

  await db.prepare(`UPDATE fianzas SET ${sets.join(', ')} WHERE id = ?`).run(...valores, id);
  res.json({ ok: true });
});

// Marca el recordatorio como atendido sin borrar la fecha (queda el histórico).
router.put('/fianzas/:id/recordatorio', async (req, res) => {
  await exigirEntidad(req.user, 'fianza', req.params.id);

  const atendido = req.body?.atendido !== false;
  await db.prepare('UPDATE fianzas SET recordatorio_atendido_el = ? WHERE id = ?')
    .run(atendido ? todayISO() : null, Number(req.params.id));
  res.json({ ok: true });
});

router.delete('/fianzas/:id', async (req, res) => {
  const id = Number(req.params.id);
  await exigirEntidad(req.user, 'fianza', id);

  await borrarDocumentosDe('fianza', id);
  await db.prepare('DELETE FROM fianzas WHERE id = ?').run(id);
  res.json({ ok: true });
});

// GET /api/admin/recordatorios -> avisos internos vencidos o próximos (7 días)
router.get('/recordatorios', async (req, res) => {
  const dias = Number(req.query.dias) || 7;
  const cartera = filtroCartera(req.user, 'c.vendedor_id');
  const rows = await db.prepare(
    `SELECT f.id, f.clase, f.numero_poliza, t.nombre AS tipo_fianza,
            f.fecha_recordatorio, f.nota_recordatorio,
            f.monto_afianzado, c.id AS client_id, c.razon_social,
            a.nombre AS afianzadora_nombre, p.nombre AS proyecto_nombre
     FROM fianzas f
     JOIN clients c ON c.id = f.client_id
     JOIN afianzadoras a ON a.id = f.afianzadora_id
     LEFT JOIN tipos_fianza t ON t.id = f.tipo_fianza_id
     LEFT JOIN proyectos p ON p.id = f.proyecto_id
     WHERE f.fecha_recordatorio IS NOT NULL
       AND f.recordatorio_atendido_el IS NULL${cartera.sql}
     ORDER BY f.fecha_recordatorio`
  ).all(...cartera.params);

  const recordatorios = rows
    .map((r) => ({ ...r, dias_restantes: daysUntil(r.fecha_recordatorio) }))
    .filter((r) => r.dias_restantes !== null && r.dias_restantes <= dias);

  res.json({ recordatorios });
});

// --- Documentos de proyectos y fianzas ---

// Dos juegos: los de siempre (por entidad) y los de la carpeta del contratante,
// que es otra carpeta sobre la misma obra y con otros tipos (ver lib/documentos.js).
router.get('/tipos-documento', (req, res) => res.json({
  tipos: TIPOS_DOC,
  tipos_contratante: TIPOS_DOC_CONTRATANTE,
}));

// La tabla es polimórfica, así que no hay llave foránea que limpie sola:
// al borrar la entidad hay que llevarse sus archivos a mano.
async function borrarDocumentosDe(entidadTipo, entidadId) {
  const docs = await db.prepare(
    'SELECT url FROM documentos WHERE entidad_tipo = ? AND entidad_id = ?'
  ).all(entidadTipo, entidadId);
  if (!docs.length) return;

  await db.prepare('DELETE FROM documentos WHERE entidad_tipo = ? AND entidad_id = ?')
    .run(entidadTipo, entidadId);
  for (const d of docs) await borrarArchivo(d.url);
}

// Devuelve el cliente dueño de la entidad, o null si no existe.
async function duenoDe(entidadTipo, entidadId) {
  const tabla = entidadTipo === 'proyecto' ? 'proyectos' : 'fianzas';
  const fila = await db.prepare(`SELECT client_id FROM ${tabla} WHERE id = ?`).get(entidadId);
  return fila ? fila.client_id : null;
}

// POST /api/admin/:entidadTipo/:id/documentos  { public_id, nombre, tipo_doc }
//   entidadTipo: 'proyectos' | 'fianzas'
//
// El archivo ya está en Cloudinary (lo subió el navegador con la firma de
// /api/subidas/firma); aquí solo llega dónde quedó.
router.post('/:entidadTipo(proyectos|fianzas)/:id/documentos', async (req, res) => {
  const entidadTipo = req.params.entidadTipo === 'proyectos' ? 'proyecto' : 'fianza';
  const entidadId = Number(req.params.id);
  const tipoDoc = req.body?.tipo_doc || 'otro';

  if (!esTipoValido(entidadTipo, tipoDoc)) {
    return res.status(400).json({ error: `Tipo de documento no válido para ${entidadTipo}` });
  }

  const clientId = await duenoDe(entidadTipo, entidadId);
  if (!clientId) return res.status(404).json({ error: `No existe ese ${entidadTipo}` });
  await exigirCliente(req.user, clientId);

  const archivo = await adoptarArchivo({
    publicId: req.body?.public_id,
    clientId,
    nombre: req.body?.nombre,
  });

  const row = await db.prepare(
    `INSERT INTO documentos
       (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`
  ).get(clientId, entidadTipo, entidadId, tipoDoc, archivo.url,
        archivo.nombre, archivo.bytes);

  res.json({ ok: true, id: row.id, url: archivo.url });
});

// POST /api/admin/clientes/:id/obras/:obraId/documentos
//   :id = el CONTRATANTE (el dueño de la carpeta), :obraId = la obra del proveedor
//
// La otra mitad de lo que hace el contratante desde su portal: en la práctica el
// proveedor le pasa la fianza en papel al desarrollador, o directo a Fortex, y
// tiene que poder entrar por las dos puertas. La misma carpeta, el mismo dueño;
// lo único que cambia es el 'subido_por', para que en la pantalla se sepa quién
// la consiguió.
router.post('/clientes/:id/obras/:obraId/documentos', async (req, res) => {
  const contratanteId = Number(req.params.id);
  const tipoDoc = req.body?.tipo_doc || 'otro_contratante';

  // Lo barato primero: cuando esta petición llega, el archivo YA está en
  // Cloudinary, y cada rechazo tardío deja basura en la cuenta.
  if (!esTipoDeContratante(tipoDoc)) {
    return res.status(400).json({ error: 'Ese tipo de documento no es válido aquí' });
  }
  await exigirCliente(req.user, contratanteId);
  if ((await tipoDe(contratanteId)) !== 'contratante') {
    return res.status(400).json({ error: 'Esa carpeta es de una cuenta de tipo contratante' });
  }
  // La misma guarda que usa el contratante, y a propósito: si la obra no está en
  // su alcance —porque no está ligada, o porque su proveedor está suspendido—
  // el archivo caería en una carpeta que él no puede abrir.
  await exigirObraDelContratante(contratanteId, req.params.obraId);

  const archivo = await adoptarArchivo({
    publicId: req.body?.public_id,
    clientId: contratanteId,
    nombre: req.body?.nombre,
  });

  const row = await db.prepare(
    `INSERT INTO documentos
       (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo, size_bytes, subido_por)
     VALUES (?, 'proyecto', ?, ?, ?, ?, ?, 'fortex') RETURNING id`
  ).get(contratanteId, Number(req.params.obraId), tipoDoc,
        archivo.url, archivo.nombre, archivo.bytes);

  res.json({ ok: true, id: row.id });
});

// GET /api/admin/documentos/:id/archivo -> redirige al archivo
//
// Hermana de /descargar, pero por ID en vez de por URL. Existe porque hay
// pantallas del panel que a propósito NO reciben la URL —la carpeta del
// contratante se arma con panoramaDelContratante, que nunca selecciona url— y
// pasear la URL por el front solo para poder pedirla de vuelta sería darle una
// liga permanente de Cloudinary a algo que no la necesita.
//
// exigirEntidad averigua de quién es el documento y acota al vendedor a su
// cartera, que es la misma guarda de siempre.
router.get('/documentos/:id(\\d+)/archivo', async (req, res) => {
  await exigirEntidad(req.user, 'documento', req.params.id);

  const doc = await db.prepare('SELECT url FROM documentos WHERE id = ?')
    .get(Number(req.params.id));
  if (!doc || !/^https:\/\//.test(doc.url || '')) {
    return res.status(404).json({ error: 'Archivo no disponible' });
  }
  res.redirect(doc.url);
});

// DELETE /api/admin/documentos/:id -> quita el registro y el archivo del blob
router.delete('/documentos/:id', async (req, res) => {
  await exigirEntidad(req.user, 'documento', req.params.id);

  const doc = await db.prepare('SELECT url FROM documentos WHERE id = ?').get(Number(req.params.id));
  if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

  await db.prepare('DELETE FROM documentos WHERE id = ?').run(Number(req.params.id));
  await borrarArchivo(doc.url); // si esto falla, ya no hay registro que lo apunte
  res.json({ ok: true });
});

// --- Expediente del fiado (CSF, estados financieros, acta constitutiva…) ---
//
// Estos documentos los sube el propio fiado desde su portal, pero en la
// práctica muchos llegan por correo a Fortex: se cargan en su
// nombre y queda registrado que fue Fortex quien lo hizo.

// POST /api/admin/clientes/:id/documentos/:typeId  (multipart: archivo)
router.post('/clientes/:id/documentos/:typeId', async (req, res) => {
  const clientId = Number(req.params.id);
  // Primero lo barato: que el cliente exista, que quien sube lo alcance y que el
  // tipo de documento sea real. Rechazar DESPUÉS de adoptar el archivo dejaría
  // basura en Cloudinary, porque el navegador ya lo subió.
  await exigirCliente(req.user, clientId);
  await exigirTipoDocumento(Number(req.params.typeId));

  const archivo = await adoptarArchivo({
    publicId: req.body?.public_id,
    clientId,
    nombre: req.body?.nombre,
  });

  const { vencimiento, tipo } = await guardarDocumentoCliente({
    clientId,
    typeId: Number(req.params.typeId),
    archivo,
    subidoPor: 'fortex',
  });
  res.json({ ok: true, vencimiento, tipo });
});

// DELETE /api/admin/clientes/:id/documentos/:typeId
router.delete('/clientes/:id/documentos/:typeId', async (req, res) => {
  await exigirCliente(req.user, req.params.id);

  await borrarDocumentoCliente({
    clientId: Number(req.params.id),
    typeId: Number(req.params.typeId),
  });
  res.json({ ok: true });
});

// --- Catálogo de documentos requeridos (tabla document_types) ---
//
// Es la lista que le aparece a TODOS los fiados. Se edita desde el panel para
// no tener que redesplegar cuando una afianzadora empieza a pedir un papel
// nuevo (un balance parcial, una declaración anual…).

// GET /api/admin/documentos-requeridos -> catálogo con cuántos fiados lo tienen
router.get('/documentos-requeridos', async (req, res) => {
  const tipos = await db.prepare(
    `SELECT dt.*, COUNT(cd.id)::int AS cargados
     FROM document_types dt
     LEFT JOIN client_documents cd ON cd.document_type_id = dt.id
     GROUP BY dt.id
     ORDER BY dt.orden, dt.id`
  ).all();
  res.json({ tipos });
});

// Meses de vigencia y días de aviso: vacío significa "no vence".
function periodicidad(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

router.post('/documentos-requeridos', soloOperador, async (req, res) => {
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

  const alerta = periodicidad(req.body?.alerta_dias) ?? 30;
  try {
    const row = await db.prepare(
      `INSERT INTO document_types (nombre, slug, periodicidad_meses, alerta_dias, orden)
       VALUES (?, ?, ?, ?, 500) RETURNING id`
    ).get(nombre, slugify(nombre), periodicidad(req.body?.periodicidad_meses), alerta);
    res.json({ ok: true, id: row.id });
  } catch (e) {
    res.status(400).json({ error: 'Ya existe un documento con ese nombre', detail: e.message });
  }
});

router.put('/documentos-requeridos/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  const nombre = String(req.body?.nombre || '').trim();
  if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });

  // El slug NO se toca: es la llave con la que se identifica el tipo y hay
  // documentos ya cargados apuntando a este id.
  await db.prepare(
    `UPDATE document_types
     SET nombre = ?, periodicidad_meses = ?, alerta_dias = ?
     WHERE id = ?`
  ).run(nombre, periodicidad(req.body?.periodicidad_meses),
        periodicidad(req.body?.alerta_dias) ?? 30, id);
  res.json({ ok: true });
});

// Solo se puede quitar un tipo que nadie haya usado: si ya hay archivos
// colgados, borrarlo se los llevaría sin avisar.
router.delete('/documentos-requeridos/:id', soloOperador, async (req, res) => {
  const id = Number(req.params.id);
  const { c } = await db.prepare(
    'SELECT COUNT(*)::int c FROM client_documents WHERE document_type_id = ?'
  ).get(id);
  if (c > 0) {
    return res.status(400).json({
      error: `${c} cliente(s) ya tienen cargado este documento. Bórralo de sus expedientes antes de quitarlo del catálogo.`,
    });
  }
  await db.prepare('DELETE FROM document_types WHERE id = ?').run(id);
  res.json({ ok: true });
});

// --- Papelería específica (solicitudes que crea Fortex) ---

// POST /api/admin/papeleria -> crear solicitud puntual para un cliente
router.post('/papeleria', async (req, res) => {
  const { client_id, afianzadora_id, fianza_id, descripcion } = req.body || {};
  if (!client_id || !descripcion) {
    return res.status(400).json({ error: 'client_id y descripcion requeridos' });
  }
  await exigirCliente(req.user, client_id);

  const row = await db.prepare(
    `INSERT INTO papeleria_requests (client_id, afianzadora_id, fianza_id, descripcion)
     VALUES (?, ?, ?, ?) RETURNING id`
  ).get(client_id, afianzadora_id || null, fianza_id || null, descripcion);
  res.json({ ok: true, id: row.id });
});

// GET /api/admin/clientes/:id/detalle -> fianzas, documentos y papelería de un cliente
router.get('/clientes/:id/detalle', async (req, res) => {
  const id = Number(req.params.id);
  await exigirCliente(req.user, id);

  const cliente = await db.prepare(
    `SELECT c.id, c.razon_social, c.rfc, c.telefono, c.tipo, c.vendedor_id, v.nombre AS vendedor_nombre
     FROM clients c
     LEFT JOIN users v ON v.id = c.vendedor_id
     WHERE c.id = ?`
  ).get(id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

  // Las personas que pueden entrar por este fiado. El hash NUNCA sale de aquí.
  const usuarios = await db.prepare(
    `SELECT id, nombre, email, activo, created_at
     FROM users WHERE client_id = ? ORDER BY activo DESC, nombre`
  ).all(id);

  // Un contratante no tiene obras propias, ni pólizas, ni expediente, ni líneas
  // de crédito: lo que tiene es un padrón. Se contesta con la forma que le toca
  // en vez de mandarle listas vacías que el front tendría que interpretar.
  //
  // Y se le contesta con EXACTAMENTE lo que el contratante ve en su propio
  // portal (el mismo panoramaDelContratante), no con el expediente completo de
  // sus proveedores. Es a propósito, y es lo que hace que esta pantalla sea
  // segura para un vendedor: el vendedor que lleva la cuenta de Delta necesita
  // saber a qué proveedor le falta la fianza —ahí está su venta—, pero sus
  // proveedores pueden ser clientes de otro vendedor, y por aquí no se le
  // escapan ni las primas ni las líneas de crédito de nadie.
  if (cliente.tipo === 'contratante') {
    const {
      proveedores, proyectos: susProyectos, obras: obrasCrudas, metricas,
    } = await panoramaDelContratante(id);
    // La línea de crédito de sus proveedores, con lo que llevan comprometido en
    // TOTAL. Esto es solo para el panel: al contratante se le dice cuánto aparta
    // su proyecto —que es la suma de las pólizas que ya ve— y no cuánto tiene
    // autorizado su proveedor ni con quién.
    //
    // Y al VENDEDOR tampoco. Alcanzar a un contratante no puede volverse la
    // puerta trasera a las líneas de crédito de sus proveedores, que pueden ser
    // clientes de otro vendedor: por su detalle recibe un 403, y por aquí
    // estaba entrando lo mismo. Peor todavía, el comprometido_total suma
    // pólizas de obras que ese proveedor hace para OTROS contratantes.
    const lineasProveedores = esVendedor(req.user) ? [] : await lineasDeLosProveedores(id);
    // Los documentos de su carpeta van con el nombre legible del tipo, igual que
    // en su portal: es la misma pantalla vista desde el otro lado.
    const obras = obrasCrudas.map((o) => ({
      ...o,
      mis_documentos: (o.mis_documentos || []).map((d) => ({
        ...d, tipo_doc_nombre: nombreTipoDocContratante(d.tipo_doc),
      })),
    }));

    // Los suspendidos van APARTE y solo para Fortex: el contratante no los ve
    // (SQL_PADRON los filtra), pero el operador necesita poder reactivarlos.
    // Sin esto, suspender era una puerta de un solo sentido.
    const suspendidos = await db.prepare(
      `SELECT cp.proveedor_id AS id, c.razon_social, c.rfc, cp.alias, cp.notas,
              (SELECT COUNT(*)::int FROM proyectos p
               WHERE p.contratante_id = cp.contratante_id
                 AND p.client_id = cp.proveedor_id) AS obras_ligadas
       FROM client_proveedores cp
       JOIN clients c ON c.id = cp.proveedor_id
       WHERE cp.contratante_id = ? AND cp.activo = 0
       ORDER BY c.razon_social`
    ).all(id);

    // Los contratos que EXISTEN pero que esta pantalla no está mostrando,
    // porque su proveedor está suspendido en el padrón y panoramaDelContratante
    // filtra por cp.activo = 1.
    //
    // Hace falta decirlo o la pantalla se contradice a sí misma: la partida
    // vuelve a decir "sin contratista", el operador vuelve a asignar, y queda
    // una segunda obra fantasma. Pasó de verdad al probar el atajo.
    //
    // Va SOLO al panel: el contratante no ve a sus suspendidos —los suspendió
    // él— y esta cuenta no es dato suyo, es de la captura de Fortex.
    const invisibles = await db.prepare(
      `SELECT p.id, p.nombre, p.partida_id, p.desarrollo_id,
              p.client_id, c.razon_social AS proveedor_nombre
       FROM proyectos p
       JOIN client_proveedores cp
         ON cp.proveedor_id = p.client_id
        AND cp.contratante_id = p.contratante_id
       JOIN clients c ON c.id = p.client_id
       WHERE p.contratante_id = ? AND cp.activo = 0
       ORDER BY c.razon_social, p.nombre`
    ).all(id);

    return res.json({
      obras_invisibles: invisibles,
      cliente, usuarios, proveedores, suspendidos, obras, metricas,
      // 'proyectos' aquí son SUS desarrollos, no obras propias: un contratante
      // no ejecuta obra. El front lo distingue por cliente.tipo.
      proyectos: susProyectos,
      lineas_proveedores: lineasProveedores,
      lineas: [], fianzas: [], documentos: [], papeleria: [],
    });
  }

  // Del lado del fiado, en qué padrones está: a qué desarrolladores les surte y
  // por lo tanto quién le está viendo las fianzas de qué obras. Conviene tenerlo
  // a la vista antes de ligar una obra más.
  // Se traen TAMBIÉN los padrones suspendidos, con su `activo`, en vez de
  // filtrarlos: una obra que sigue ligada a un contratante que ya suspendió a
  // este fiado es justo lo que el operador tiene que ver (queda colgada, y el
  // DELETE del padrón se niega mientras exista). Lo que no puede pasar es que
  // el panel afirme que ese contratante está viendo las fianzas, porque no las
  // ve: de eso se encarga la etiqueta del front.
  const contratantes = await db.prepare(
    `SELECT cp.contratante_id AS id, c.razon_social, cp.alias, cp.activo,
            (SELECT COUNT(*)::int FROM proyectos p
             WHERE p.contratante_id = cp.contratante_id AND p.client_id = cp.proveedor_id) AS obras_ligadas
     FROM client_proveedores cp
     JOIN clients c ON c.id = cp.contratante_id
     WHERE cp.proveedor_id = ?
     ORDER BY c.razon_social`
  ).all(id);

  const fianzasRows = await db.prepare(
    `SELECT f.*, a.nombre AS afianzadora_nombre,
            t.nombre AS tipo_fianza,
            p.nombre AS proyecto_nombre
     FROM fianzas f
     JOIN afianzadoras a ON a.id = f.afianzadora_id
     LEFT JOIN tipos_fianza t ON t.id = f.tipo_fianza_id
     LEFT JOIN proyectos p ON p.id = f.proyecto_id
     WHERE f.client_id = ? ORDER BY f.fecha_vigencia`
  ).all(id);
  // Todos los archivos del cliente en una sola consulta; luego se reparten.
  const archivos = await db.prepare(
    `SELECT id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo, size_bytes, subido_el
     FROM documentos WHERE client_id = ? ORDER BY subido_el DESC`
  ).all(id);
  const porEntidad = agruparPorEntidad(archivos);

  // Un previo no tiene vigencia que juzgar: su 'estado' ES ser previo. Sin esto
  // saldría pintado en rojo como "vencida" nada más porque se le capturó una
  // fecha estimada que ya pasó.
  const fianzas = fianzasRows.map((f) => ({
    ...f,
    estado: f.clase === 'previo' ? 'previo' : estadoFianza(f.fecha_vigencia),
    dias_para_recordatorio: daysUntil(f.fecha_recordatorio),
    documentos: deEntidad(porEntidad, 'fianza', f.id),
  }));

  // Comprometido por afianzadora (fianzas no vencidas). Un previo no compromete
  // nada: la afianzadora todavía no emitió, así que no hay pasivo que descontar
  // de la línea de crédito.
  const comprometidoPorAfi = new Map();
  for (const f of fianzas) {
    if (f.clase === 'previo' || f.estado === 'vencida') continue;
    comprometidoPorAfi.set(
      f.afianzadora_id,
      (comprometidoPorAfi.get(f.afianzadora_id) || 0) + (f.monto_afianzado || 0)
    );
  }

  const lineasRows = await db.prepare(
    `SELECT cl.afianzadora_id, a.nombre AS afianzadora_nombre, cl.linea_credito
     FROM client_credit_lines cl
     JOIN afianzadoras a ON a.id = cl.afianzadora_id
     WHERE cl.client_id = ? ORDER BY a.nombre`
  ).all(id);
  const lineas = lineasRows.map((l) => {
    const comprometido = comprometidoPorAfi.get(l.afianzadora_id) || 0;
    return {
      ...l,
      linea_credito: l.linea_credito || 0,
      comprometido,
      disponible: (l.linea_credito || 0) - comprometido,
    };
  });

  const documentos = await db.prepare(
    `SELECT dt.nombre, dt.id AS document_type_id, dt.periodicidad_meses, dt.alerta_dias,
            cd.uploaded_at, cd.vencimiento, cd.original_name, cd.file_path,
            cd.size_bytes, cd.subido_por
     FROM document_types dt
     LEFT JOIN client_documents cd ON cd.document_type_id = dt.id AND cd.client_id = ?
     ORDER BY dt.orden, dt.id`
  ).all(id);

  const papeleria = await db.prepare(
    `SELECT p.*, a.nombre AS afianzadora_nombre, f.numero_poliza
     FROM papeleria_requests p
     LEFT JOIN afianzadoras a ON a.id = p.afianzadora_id
     LEFT JOIN fianzas f ON f.id = p.fianza_id
     WHERE p.client_id = ? ORDER BY p.created_at DESC`
  ).all(id);

  // Proyectos con sus fianzas dentro. Es la agrupación que ve el admin.
  //
  // Se trae el nombre del contratante ligado: es lo que le dice al operador
  // "ojo, las pólizas de esta obra las está viendo Desarrollos Delta".
  const proyectosRows = await db.prepare(
    `SELECT p.*, ct.razon_social AS contratante_nombre, de.nombre AS desarrollo_nombre
     FROM proyectos p
     LEFT JOIN clients ct ON ct.id = p.contratante_id
     LEFT JOIN desarrollos de ON de.id = p.desarrollo_id
     WHERE p.client_id = ? ORDER BY p.estatus, p.nombre`
  ).all(id);

  const proyectos = proyectosRows.map((p) => {
    // 'suyas' lleva todo lo capturado (fianzas y previos), porque la tabla del
    // panel los muestra juntos; los totales de dinero solo cuentan las emitidas.
    const suyas = fianzas.filter((f) => f.proyecto_id === p.id);
    const emitidas = suyas.filter((f) => f.clase !== 'previo');
    const afianzado = emitidas
      .filter((f) => f.estado !== 'vencida')
      .reduce((s, f) => s + (f.monto_afianzado || 0), 0);
    return {
      ...p,
      fianzas: suyas,
      documentos: deEntidad(porEntidad, 'proyecto', p.id),
      total_fianzas: emitidas.length,
      total_previos: suyas.length - emitidas.length,
      monto_afianzado: afianzado,
      // Las dos primas del proyecto. Cuidado al leerlas: 'suma_prima_total' es
      // la suma de las primas TOTALES de sus fianzas, no el total de las netas.
      suma_prima_neta: emitidas.reduce((s, f) => s + (f.prima_neta || 0), 0),
      suma_prima_total: emitidas.reduce((s, f) => s + (f.prima_total || 0), 0),
      // Qué tanto del contrato está respaldado por fianzas vigentes.
      pct_contrato_afianzado: p.monto_contrato > 0
        ? Math.round((afianzado / p.monto_contrato) * 100)
        : null,
    };
  });

  res.json({ cliente, usuarios, contratantes, lineas, proyectos, fianzas, documentos, papeleria });
});

// GET /api/admin/descargar?path=<url> -> redirige al archivo
//
// Antes redirigía a CUALQUIER https que le pasaran. Con un solo admin eso era
// nada más feo; con operadores en el sistema sería la puerta para bajarse el
// expediente de un fiado ajeno con solo tener su URL. Ahora el archivo tiene
// que estar registrado y quien lo pide, alcanzar a su dueño.
router.get('/descargar', async (req, res) => {
  const url = String(req.query.path || '');
  if (!/^https:\/\//.test(url)) {
    return res.status(404).json({ error: 'Archivo no disponible' });
  }

  const dueno = await db.prepare(
    `SELECT client_id FROM documentos          WHERE url = ?
     UNION ALL
     SELECT client_id FROM client_documents    WHERE file_path = ?
     UNION ALL
     SELECT client_id FROM papeleria_requests  WHERE file_path = ?
     LIMIT 1`
  ).get(url, url, url);
  if (!dueno) return res.status(404).json({ error: 'Archivo no disponible' });

  await exigirCliente(req.user, dueno.client_id);
  res.redirect(url);
});

// --- Usuarios ---
//
// Una empresa puede tener varias personas entrando (el director, el contador,
// el residente de obra), y todas ven lo mismo de su fiado. Las cuentas de
// Fortex (admin y operador) no cuelgan de ninguna empresa.

// GET /api/admin/usuarios/internos -> el personal de Fortex
router.get('/usuarios/internos', soloOperador, async (req, res) => {
  const usuarios = await db.prepare(
    `SELECT u.id, u.nombre, u.email, u.role, u.activo,
            (SELECT COUNT(*)::int FROM clients c WHERE c.vendedor_id = u.id) AS clientes_asignados
     FROM users u
     WHERE u.client_id IS NULL
     ORDER BY u.role, u.nombre`
  ).all();
  res.json({ usuarios, dominio: DOMINIO_INTERNO });
});

// POST /api/admin/usuarios -> alta de una persona (de un fiado o de Fortex)
router.post('/usuarios', soloAdmin, async (req, res) => {
  const { nombre, email, password, role, client_id } = req.body || {};
  const fila = await crearUsuario({
    nombre,
    email,
    password,
    role: role || 'client',
    clientId: client_id ? Number(client_id) : null,
  });
  res.json({ ok: true, id: fila.id });
});

// PUT /api/admin/usuarios/:id -> cambiar nombre, reactivar o reponer contraseña
router.put('/usuarios/:id', soloAdmin, async (req, res) => {
  await actualizarUsuario(Number(req.params.id), req.body || {});
  res.json({ ok: true });
});

// DELETE /api/admin/usuarios/:id -> baja lógica (deja de entrar, sigue en lista)
router.delete('/usuarios/:id', soloAdmin, async (req, res) => {
  await desactivarUsuario(Number(req.params.id));
  res.json({ ok: true });
});

// DELETE /api/admin/usuarios/:id/permanente -> la borra de veras
//
// Aparte de la baja lógica porque son dos intenciones distintas: desactivar es
// para quien ya trabajó y conviene conservar; borrar es para la cuenta que nunca
// debió existir (las de demostración, o una creada con el correo equivocado).
router.delete('/usuarios/:id/permanente', soloAdmin, async (req, res) => {
  await eliminarUsuario(Number(req.params.id), { solicitanteId: req.user.id });
  res.json({ ok: true });
});

export default router;
