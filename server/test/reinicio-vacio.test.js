// El reinicio en blanco borra datos de producción. Lo que se verifica:
//  - que no se lleve entre las patas la cuenta admin (es un renglón de
//    clients: perderla deja el portal sin forma de entrar);
//  - que no truene con fianzas.proyecto_id, que es ON DELETE RESTRICT;
//  - que sí borre TODO lo del cliente, sin dejar huérfanos.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

import { baseEnMemoria } from './ayuda/pg-memoria.js';

process.env.DATABASE_URL ??= 'postgres://noop';

const { default: db } = await import('../src/db.js');
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

const { reiniciarVacio } = await import('../src/seed.js');
const { inicializar, MIGRACIONES } = await import('../src/migrations.js');

const contar = async (tabla) =>
  (await memoria.prepare(`SELECT COUNT(*)::int AS total FROM ${tabla}`).get()).total;

before(async () => {
  await inicializar(memoria);
  await memoria.exec(`
    INSERT INTO clients (razon_social, email, password_hash, role)
      VALUES ('Fortex', 'admin@fortex.mx', 'hash-del-admin', 'admin');
    INSERT INTO clients (razon_social, rfc, email, password_hash)
      VALUES ('GASPE', 'KUKF010115BV6', 'isidro@fortex.mx', 'x'),
             ('Otra SA', 'OTR010101AAA', 'otra@demo.mx', 'x');
    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta','aserta'), ('Chubb','chubb');
    INSERT INTO proyectos (client_id, nombre, monto_contrato) VALUES (2,'Obra A',100000000);
    INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito) VALUES (2,1,300000000);
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                         tipo_fianza_id, prima_neta, monto_afianzado)
      VALUES (2, 1, 1, 'ASE-1',
              (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 1850000, 120000000);
    INSERT INTO papeleria_requests (client_id, descripcion) VALUES (2, 'Carta de no adeudo');
    INSERT INTO notifications (client_id, tipo, ref_key) VALUES (2, 'fianza_30', 'fianza:1');
  `);
});

test('borra los clientes y todo lo que cuelga de ellos', async () => {
  const resumen = await reiniciarVacio();

  assert.deepEqual(resumen, {
    clientes: 2, proyectos: 1, fianzas: 1, admins_conservados: 1,
  });

  assert.equal(await contar('proyectos'), 0);
  assert.equal(await contar('fianzas'), 0);
  assert.equal(await contar('client_credit_lines'), 0, 'quedaron líneas huérfanas');
  assert.equal(await contar('papeleria_requests'), 0, 'quedó papelería huérfana');
  assert.equal(await contar('notifications'), 0, 'quedaron notificaciones huérfanas');
});

test('conserva intacta la cuenta admin, con su contraseña', async () => {
  const admins = await memoria.prepare(
    `SELECT email, password_hash, role FROM clients`).all();

  assert.equal(admins.length, 1, 'debe quedar exactamente la cuenta admin');
  assert.equal(admins[0].email, 'admin@fortex.mx');
  assert.equal(admins[0].role, 'admin');
  assert.equal(admins[0].password_hash, 'hash-del-admin',
    'no debe reescribirse la contraseña del admin');
});

test('conserva afianzadoras y catálogos', async () => {
  assert.equal(await contar('afianzadoras'), 2);
  assert.ok(await contar('tipos_fianza') >= 10, 'el catálogo del ramo debe seguir ahí');
  assert.equal(await contar('schema_migrations'), MIGRACIONES.length,
    'no debe perderse el registro de migraciones');
});

test('correrlo dos veces no falla ni borra de más', async () => {
  const resumen = await reiniciarVacio();
  assert.deepEqual(resumen, {
    clientes: 0, proyectos: 0, fianzas: 0, admins_conservados: 1,
  });
  assert.equal(await contar('clients'), 1);
});

test('se niega a reiniciar si no hay ninguna cuenta admin', async () => {
  const sinAdmin = baseEnMemoria();
  await inicializar(sinAdmin);
  db.query = sinAdmin.query;
  db.prepare = sinAdmin.prepare;
  await sinAdmin.exec(
    `INSERT INTO clients (razon_social, email, password_hash) VALUES ('Solo cliente','c@d.mx','x')`);

  await assert.rejects(() => reiniciarVacio(), /sin acceso/);

  const quedan = await sinAdmin.prepare('SELECT COUNT(*)::int AS total FROM clients').get();
  assert.equal(quedan.total, 1, 'no debió borrar nada al abortar');

  db.query = memoria.query;
  db.prepare = memoria.prepare;
});
