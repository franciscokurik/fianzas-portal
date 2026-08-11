// Reponer la contraseña olvidada. Es la única puerta que se abre sin sesión,
// así que lo que se cuida aquí es que el enlace no sirva más de lo debido y que
// pedirlo no delate qué correos están dados de alta.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import bcrypt from 'bcryptjs';

import { baseEnMemoria } from './ayuda/pg-memoria.js';

process.env.DATABASE_URL ??= 'postgres://noop';
process.env.JWT_SECRET = 'secreto-de-prueba';
process.env.EMAIL_MODE = 'console'; // no se manda nada de verdad
process.env.APP_URL = 'https://portal-de-prueba.mx';

const { default: db } = await import('../src/db.js');
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

const { default: app } = await import('../src/app.js');
const { inicializar } = await import('../src/migrations.js');
const { pedirRecuperacion } = await import('../src/services/recuperacion.js');

let servidor;
let base;

const CLAVE_VIEJA = 'la-de-siempre';
const CLAVE_NUEVA = 'una-nueva-8';

before(async () => {
  await inicializar(memoria);
  const hash = bcrypt.hashSync(CLAVE_VIEJA, 4);
  await memoria.exec(`
    INSERT INTO clients (razon_social) VALUES ('Constructora');
    INSERT INTO users (client_id, nombre, email, password_hash, role, activo) VALUES
      (1, 'Dirección',   'director@demo.mx', '${hash}', 'client', 1),
      (1, 'Ex empleado', 'baja@demo.mx',     '${hash}', 'client', 0);
  `);

  servidor = createServer(app);
  await new Promise((r) => servidor.listen(0, r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

const post = async (ruta, cuerpo) => {
  const r = await fetch(`${base}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return { status: r.status, cuerpo: await r.json() };
};

const entrar = (identificador, password) => post('/api/auth/login', { identificador, password });

// El token en claro solo viaja en el correo; para probar el flujo se toma
// directo del servicio, que es el único que lo conoce.
const tokenPara = async (email) => (await pedirRecuperacion(email, 'https://portal-de-prueba.mx')).token;

test('pedir el enlace responde igual exista o no la cuenta', async () => {
  const existe = await post('/api/auth/recuperar', { email: 'director@demo.mx' });
  const noExiste = await post('/api/auth/recuperar', { email: 'quien-sabe@ejemplo.mx' });

  assert.equal(existe.status, 200);
  assert.equal(noExiste.status, 200);
  // Distinguirlos serviría para ir probando correos hasta dar con los clientes.
  assert.deepEqual(existe.cuerpo, noExiste.cuerpo);
});

test('el enlace deja poner una contraseña nueva y con esa se entra', async () => {
  const token = await tokenPara('director@demo.mx');

  const res = await post('/api/auth/restablecer', { token, password: CLAVE_NUEVA });
  assert.equal(res.status, 200);

  assert.equal((await entrar('director@demo.mx', CLAVE_NUEVA)).status, 200);
  assert.equal((await entrar('director@demo.mx', CLAVE_VIEJA)).status, 401,
    'la contraseña anterior debe dejar de servir');
});

test('el enlace es de un solo uso', async () => {
  const token = await tokenPara('director@demo.mx');
  assert.equal((await post('/api/auth/restablecer', { token, password: 'otra-clave-8' })).status, 200);

  const repetido = await post('/api/auth/restablecer', { token, password: 'y-otra-mas-8' });
  assert.equal(repetido.status, 400);
  assert.match(repetido.cuerpo.error, /ya no sirve/i);
});

test('pedir un enlace nuevo invalida el anterior', async () => {
  // Pasa seguido: la persona pide dos porque cree que no le llegó el primero.
  const viejo = await tokenPara('director@demo.mx');
  const nuevo = await tokenPara('director@demo.mx');

  assert.equal((await post('/api/auth/restablecer', { token: viejo, password: 'con-el-viejo-8' })).status, 400);
  assert.equal((await post('/api/auth/restablecer', { token: nuevo, password: 'con-el-nuevo-8' })).status, 200);
});

test('un enlace vencido no sirve', async () => {
  const token = await tokenPara('director@demo.mx');
  // Se envejece a mano: es lo que haría el reloj en una hora.
  await memoria.query(`UPDATE password_resets SET expira_el = '2020-01-01 00:00:00' WHERE usado_el IS NULL`);

  const res = await post('/api/auth/restablecer', { token, password: 'tarde-pero-8' });
  assert.equal(res.status, 400);
});

test('un token inventado no sirve, y falla igual que uno vencido', async () => {
  const inventado = await post('/api/auth/restablecer', { token: 'aaaaBBBBccccDDDD', password: CLAVE_NUEVA });
  assert.equal(inventado.status, 400);

  const vacio = await post('/api/auth/restablecer', { password: CLAVE_NUEVA });
  assert.equal(vacio.status, 400);
});

test('una cuenta desactivada no genera enlace, pero la respuesta no lo delata', async () => {
  const res = await post('/api/auth/recuperar', { email: 'baja@demo.mx' });
  assert.equal(res.status, 200);

  const { total } = await memoria.prepare(
    `SELECT COUNT(*)::int AS total FROM password_resets WHERE user_id = 2`).get();
  assert.equal(total, 0, 'no debe poder reactivarse una cuenta dada de baja por esta vía');
});

test('la contraseña nueva respeta el mínimo', async () => {
  const token = await tokenPara('director@demo.mx');
  const res = await post('/api/auth/restablecer', { token, password: 'corta' });

  assert.equal(res.status, 400);
  assert.match(res.cuerpo.error, /8 caracteres/);
});

test('en la base no se guarda el token, solo su huella', async () => {
  const token = await tokenPara('director@demo.mx');
  const filas = await memoria.prepare('SELECT token_hash FROM password_resets').all();

  assert.ok(filas.length > 0);
  assert.ok(!filas.some((f) => f.token_hash === token),
    'quien lea la tabla (o un respaldo) no debe poder entrar con lo que ve');
});

test('reponer la contraseña desde el panel mata los enlaces pendientes', async () => {
  // El caso que importa: se repone la cuenta de alguien porque se sospecha que
  // le entraron. Si un enlace emitido antes siguiera sirviendo, quien lo tenga
  // vuelve a cambiar la contraseña y la reposición no sirvió de nada.
  const token = await tokenPara('director@demo.mx');

  const { actualizarUsuario } = await import('../src/services/usuarios.js');
  await actualizarUsuario(1, { password: 'la-que-puso-el-admin' });

  const res = await post('/api/auth/restablecer', { token, password: 'con-el-enlace-viejo' });
  assert.equal(res.status, 400, 'el enlace anterior debió quedar muerto');

  // Y la contraseña que puso el admin es la que vale.
  assert.equal((await entrar('director@demo.mx', 'la-que-puso-el-admin')).status, 200);
  assert.equal((await entrar('director@demo.mx', 'con-el-enlace-viejo')).status, 401);
});
