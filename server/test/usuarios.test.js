// Varias personas por empresa, cada una con su correo. Lo que se cuida aquí:
// que todas vean lo mismo de SU fiado, que el acceso viejo por RFC no se rompa
// de golpe, y que una cuenta de Fortex no se pueda dar de alta con un correo
// de fuera.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';

import { baseEnMemoria } from './ayuda/pg-memoria.js';

process.env.DATABASE_URL ??= 'postgres://noop';
process.env.JWT_SECRET = 'secreto-de-prueba';

const { default: db } = await import('../src/db.js');
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

const { default: app } = await import('../src/app.js');
const { signToken } = await import('../src/auth/middleware.js');
const { inicializar } = await import('../src/migrations.js');

let servidor;
let base;
let admin;

const CLAVE = 'contrasena8';

before(async () => {
  await inicializar(memoria);
  const hash = bcrypt.hashSync(CLAVE, 4); // 4 rondas: es una prueba, no producción
  await memoria.exec(`
    INSERT INTO clients (razon_social, rfc) VALUES
      ('Constructora del Bajío', 'CBA120315ABC'),
      ('Ingeniería del Norte',   'IAN980720XYZ');

    INSERT INTO users (client_id, nombre, email, password_hash, role, activo) VALUES
      (NULL, 'Administración',  'admin@fortex.mx',        '${hash}', 'admin', 1),
      (1,    'Dirección',    'director@bajio.mx',      '${hash}', 'client', 1),
      (1,    'Contabilidad', 'contabilidad@bajio.mx',  '${hash}', 'client', 1),
      (2,    'Dirección',    'norte@demo.mx',          '${hash}', 'client', 1),
      (2,    'Ex empleado',  'exempleado@demo.mx',     '${hash}', 'client', 0);

    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta', 'aserta');
    INSERT INTO proyectos (client_id, nombre) VALUES (1, 'Acueducto');
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                         tipo_fianza_id, monto_afianzado)
      VALUES (1, 1, 1, 'ASE-0001',
              (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 5000000);
  `);

  admin = signToken({ id: 1, role: 'admin', nombre: 'Administración' });

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const entrar = (identificador, password = CLAVE) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identificador, password }),
  });

const conToken = (ruta, token) =>
  fetch(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });

const crear = (cuerpo) =>
  fetch(`${base}/api/admin/usuarios`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });

/* --- Entrar --- */

test('cada persona entra con su propio correo', async () => {
  for (const correo of ['director@bajio.mx', 'contabilidad@bajio.mx']) {
    const res = await entrar(correo);
    assert.equal(res.status, 200, correo);

    const { user } = await res.json();
    assert.equal(user.email, correo);
    assert.equal(user.razon_social, 'Constructora del Bajío', 'debe venir la empresa, no el nombre de la persona');
  }
});

test('dos personas de la misma empresa ven exactamente las mismas fianzas', async () => {
  const uno = await (await entrar('director@bajio.mx')).json();
  const otro = await (await entrar('contabilidad@bajio.mx')).json();

  const desde = async (token) => (await (await conToken('/api/fianzas', token)).json()).fianzas;
  const a = await desde(uno.token);
  const b = await desde(otro.token);

  assert.deepEqual(a.map((f) => f.numero_poliza), ['ASE-0001']);
  assert.deepEqual(a.map((f) => f.numero_poliza), b.map((f) => f.numero_poliza));
});

test('una empresa con una sola cuenta sigue entrando con su RFC', async () => {
  // Es como entraban todos los fiados antes de que hubiera varios usuarios:
  // romperles el acceso de un día para otro no era opción.
  const res = await entrar('IAN980720XYZ');
  assert.equal(res.status, 200);
  assert.equal((await res.json()).user.email, 'norte@demo.mx');
});

test('si la empresa ya tiene varias cuentas, el RFC no identifica a nadie', async () => {
  const res = await entrar('CBA120315ABC');
  assert.equal(res.status, 401, 'con dos personas dadas de alta hay que usar el correo');
});

test('una cuenta desactivada no entra', async () => {
  const res = await entrar('exempleado@demo.mx');
  assert.equal(res.status, 401);
});

test('la contraseña equivocada falla igual que un correo inexistente', async () => {
  // Distinguirlos le regala a cualquiera la lista de correos dados de alta.
  const mala = await entrar('director@bajio.mx', 'otra-cosa');
  const inexistente = await entrar('nadie@ejemplo.mx');

  assert.equal(mala.status, 401);
  assert.equal(inexistente.status, 401);
  assert.equal((await mala.json()).error, (await inexistente.json()).error);
});

/* --- Alta de cuentas --- */

test('el admin agrega otra persona a una empresa que ya existe', async () => {
  const res = await crear({
    nombre: 'Residencia de obra', email: 'obra@bajio.mx', password: CLAVE,
    role: 'client', client_id: 1,
  });
  assert.equal(res.status, 200);

  const { user } = await (await entrar('obra@bajio.mx')).json();
  assert.equal(user.client_id, 1);
});

test('una cuenta de Fortex exige correo del dominio de Fortex', async () => {
  const fuera = await crear({
    nombre: 'Operador pirata', email: 'operador@gmail.com', password: CLAVE, role: 'operador',
  });
  assert.equal(fuera.status, 400);
  assert.match((await fuera.json()).error, /@fortex\.mx/);

  const dentro = await crear({
    nombre: 'Mariana', email: 'mariana@fortex.mx', password: CLAVE, role: 'operador',
  });
  assert.equal(dentro.status, 200);
});

test('al fiado no se le exige dominio: muchos usan correo personal', async () => {
  const res = await crear({
    nombre: 'Dueño', email: 'don.pepe@gmail.com', password: CLAVE, role: 'client', client_id: 2,
  });
  assert.equal(res.status, 200);
});

test('no se crea un usuario de fiado sin empresa, ni uno de Fortex con empresa', async () => {
  const huerfano = await crear({ nombre: 'X', email: 'x@y.mx', password: CLAVE, role: 'client' });
  assert.equal(huerfano.status, 400);
  assert.match((await huerfano.json()).error, /de qué cliente/i);

  const confundido = await crear({
    nombre: 'Y', email: 'y@fortex.mx', password: CLAVE, role: 'operador', client_id: 1,
  });
  assert.equal(confundido.status, 400);
});

test('el correo repetido se rechaza con un mensaje que se entiende', async () => {
  const res = await crear({
    nombre: 'Repetido', email: 'director@bajio.mx', password: CLAVE, role: 'client', client_id: 2,
  });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Ya hay una cuenta con el correo/);
});

test('una contraseña de tres letras no pasa', async () => {
  const res = await crear({
    nombre: 'Flojo', email: 'flojo@bajio.mx', password: 'abc', role: 'client', client_id: 1,
  });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /8 caracteres/);
});

/* --- Bajas --- */

test('desactivar una cuenta le quita el acceso sin borrar su historial', async () => {
  const { id } = await (await crear({
    nombre: 'Temporal', email: 'temporal@bajio.mx', password: CLAVE, role: 'client', client_id: 1,
  })).json();

  assert.equal((await entrar('temporal@bajio.mx')).status, 200);

  const baja = await fetch(`${base}/api/admin/usuarios/${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${admin}` },
  });
  assert.equal(baja.status, 200);
  assert.equal((await entrar('temporal@bajio.mx')).status, 401);

  // Sigue en la base: si se borrara, se perdería de quién fue cada documento.
  const fila = await memoria.prepare('SELECT activo FROM users WHERE id = ?').get(id);
  assert.equal(fila.activo, 0);
});

test('no se puede desactivar la última cuenta de administrador', async () => {
  // Dejaría el portal cerrado para siempre: no hay otra puerta.
  const res = await fetch(`${base}/api/admin/usuarios/1`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${admin}` },
  });

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /única cuenta de administrador/i);
  assert.equal((await entrar('admin@fortex.mx')).status, 200, 'el admin debe seguir entrando');
});

/* --- Borrar de veras --- */

const borrarDefinitivo = (id, token = admin) =>
  fetch(`${base}/api/admin/usuarios/${id}/permanente`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });

test('una cuenta que nunca debió existir se borra de la lista', async () => {
  const { id } = await (await crear({
    nombre: 'Demo', email: 'demo@fortex.mx', password: CLAVE, role: 'operador',
  })).json();

  assert.equal((await borrarDefinitivo(id)).status, 200);

  const { total } = await memoria.prepare('SELECT COUNT(*)::int AS total FROM users WHERE id = ?').get(id);
  assert.equal(total, 0, 'la baja definitiva no debe dejarla marcada como inactiva');
  assert.equal((await entrar('demo@fortex.mx')).status, 401);
});

test('al borrar un operador sus clientes quedan sin responsable, no se pierden', async () => {
  const { id } = await (await crear({
    nombre: 'Operador efímero', email: 'efimero@fortex.mx', password: CLAVE, role: 'operador',
  })).json();
  await memoria.query('UPDATE clients SET vendedor_id = ? WHERE id = 1', [id]);

  assert.equal((await borrarDefinitivo(id)).status, 200);

  const c = await memoria.prepare('SELECT razon_social, vendedor_id FROM clients WHERE id = 1').get();
  assert.equal(c.razon_social, 'Constructora del Bajío', 'la empresa no debió irse con el operador');
  assert.equal(c.vendedor_id, null);
});

test('nadie borra su propia cuenta', async () => {
  // Dejaría el portal sin quien lo administre en cuanto expire la sesión.
  const res = await borrarDefinitivo(1);

  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /tu propia cuenta/i);
  assert.equal((await entrar('admin@fortex.mx')).status, 200);
});

test('no se borra el último administrador activo', async () => {
  const { id } = await (await crear({
    nombre: 'Segundo admin', email: 'segundo@fortex.mx', password: CLAVE, role: 'admin',
  })).json();

  // Con dos admins, el segundo sí se puede borrar…
  assert.equal((await borrarDefinitivo(id)).status, 200);

  // …y el que queda no, ni pidiéndolo desde otra sesión de admin.
  const otro = await (await crear({
    nombre: 'Tercero', email: 'tercero@fortex.mx', password: CLAVE, role: 'admin',
  })).json();
  const { signToken: firmar } = await import('../src/auth/middleware.js');
  const tokenTercero = firmar({ id: otro.id, role: 'admin', nombre: 'Tercero' });

  await borrarDefinitivo(1, tokenTercero); // se lleva al admin original
  const res = await fetch(`${base}/api/admin/usuarios/${otro.id}/permanente`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${tokenTercero}` },
  });
  assert.equal(res.status, 400, 'quedaría el portal sin ningún administrador');
});
