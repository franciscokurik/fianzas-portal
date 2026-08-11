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
    INSERT INTO clients (razon_social, rfc)
      VALUES ('GASPE', 'KUKF010115BV6'), ('Otra SA', 'OTR010101AAA');
    -- Personal de Fortex (sin empresa) y gente de los fiados. Al reiniciar se
    -- conservan los primeros y se van los segundos con su empresa.
    INSERT INTO users (client_id, nombre, email, password_hash, role) VALUES
      (NULL, 'Administración', 'admin@fortex.mx', 'hash-del-admin', 'admin'),
      (NULL, 'Mariana',     'mariana@fortex.mx', 'hash-vendedora', 'vendedor'),
      (1, 'Isidro', 'isidro@gaspe.mx', 'x', 'client'),
      (2, 'Otra',   'otra@demo.mx',    'x', 'client');
    UPDATE clients SET vendedor_id = 2 WHERE id = 1;

    INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta','aserta'), ('Chubb','chubb');
    INSERT INTO proyectos (client_id, nombre, monto_contrato) VALUES (1,'Obra A',100000000);
    INSERT INTO client_credit_lines (client_id, afianzadora_id, linea_credito) VALUES (1,1,300000000);
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza,
                         tipo_fianza_id, prima_neta, monto_afianzado)
      VALUES (1, 1, 1, 'ASE-1',
              (SELECT id FROM tipos_fianza WHERE nombre='Cumplimiento'), 1850000, 120000000);
    INSERT INTO papeleria_requests (client_id, descripcion) VALUES (1, 'Carta de no adeudo');
    INSERT INTO notifications (client_id, tipo, ref_key) VALUES (1, 'fianza_30', 'fianza:1');
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
  assert.equal(await contar('clients'), 0, 'las empresas fiadas debieron irse todas');
});

test('conserva al personal de Fortex, con su contraseña', async () => {
  const internos = await memoria.prepare(
    `SELECT email, password_hash, role FROM users ORDER BY role`).all();

  assert.deepEqual(internos.map((u) => u.role), ['admin', 'vendedor'],
    'deben quedar el admin y el vendedor, y ningún usuario de fiado');
  assert.equal(internos[0].password_hash, 'hash-del-admin',
    'no debe reescribirse la contraseña del admin');
  assert.equal(internos[1].email, 'mariana@fortex.mx');
});

test('los usuarios de los fiados se van con su empresa', async () => {
  const { total } = await memoria
    .prepare(`SELECT COUNT(*)::int AS total FROM users WHERE role = 'client'`).get();
  assert.equal(total, 0, 'quedaron cuentas apuntando a empresas borradas');
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
  assert.equal(await contar('clients'), 0);
});

test('se niega a reiniciar si no hay ninguna cuenta admin', async () => {
  const sinAdmin = baseEnMemoria();
  await inicializar(sinAdmin);
  db.query = sinAdmin.query;
  db.prepare = sinAdmin.prepare;
  await sinAdmin.exec(`
    INSERT INTO clients (razon_social) VALUES ('Solo cliente');
    INSERT INTO users (client_id, nombre, email, password_hash, role)
      VALUES (1, 'Alguien', 'c@d.mx', 'x', 'client');
  `);

  await assert.rejects(() => reiniciarVacio(), /sin acceso/);

  const quedan = await sinAdmin.prepare('SELECT COUNT(*)::int AS total FROM clients').get();
  assert.equal(quedan.total, 1, 'no debió borrar nada al abortar');

  db.query = memoria.query;
  db.prepare = memoria.prepare;
});
