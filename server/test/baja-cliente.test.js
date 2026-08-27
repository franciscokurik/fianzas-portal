// Dar de baja una empresa es el camino más destructivo del portal: se lleva su
// historial completo y no hay deshacer. Corre SIN transacción (el driver HTTP de
// Neon no las da), así que cada paso a medias es un estado real que alguien va a
// ver, y por eso el orden de borrado está escrito a mano en vez de dejarlo al
// CASCADE.
//
// Lo que se fija aquí:
//  - que no truene con fianzas.proyecto_id, que es ON DELETE RESTRICT;
//  - que no deje archivos huérfanos, ni los propios ni los que OTRO colgó de sus
//    obras (la tabla 'documentos' es polimórfica: no hay llave foránea sobre
//    entidad_id que limpie sola, así que esto se le olvida a quien lo toque);
//  - que dar de baja a un contratante NO se lleve las obras ni las pólizas de
//    sus proveedores, que son de ellos;
//  - que el resumen diga el daño colateral, porque es lo único que el admin lee
//    antes de apretar.
import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { baseEnMemoria } from './ayuda/pg-memoria.js';

process.env.DATABASE_URL ??= 'postgres://noop';

const { default: db } = await import('../src/db.js');
const memoria = baseEnMemoria();
db.query = memoria.query;
db.prepare = memoria.prepare;

const { eliminarCliente } = await import('../src/services/clientes.js');
const { inicializar } = await import('../src/migrations.js');

const DELTA = 1;
const VEGA = 2;

const contar = async (tabla, donde = '1 = 1') =>
  (await memoria.prepare(`SELECT COUNT(*)::int AS c FROM ${tabla} WHERE ${donde}`).get()).c;

before(async () => {
  await inicializar(memoria);
  // La afianzadora se siembra UNA vez y no se toca entre pruebas: borrarla y
  // recrearla movía su id —la secuencia no se reinicia— y las fianzas de abajo
  // acababan apuntando a un id que ya no existía.
  await memoria.query("INSERT INTO afianzadoras (nombre, slug) VALUES ('Aserta', 'aserta')");
});

// Cada prueba borra algo, así que se reconstruye el mundo antes de cada una.
beforeEach(async () => {
  await memoria.exec(`
    DELETE FROM documentos; DELETE FROM fianzas; DELETE FROM client_proveedores;
    DELETE FROM proyectos; DELETE FROM clients;
    ALTER SEQUENCE clients_id_seq RESTART WITH 1;
    ALTER SEQUENCE proyectos_id_seq RESTART WITH 1;
    ALTER SEQUENCE documentos_id_seq RESTART WITH 1;

    INSERT INTO clients (razon_social, tipo) VALUES
      ('Desarrollos Delta', 'contratante'),
      ('Cimentaciones Vega', 'fiado');
    INSERT INTO client_proveedores (contratante_id, proveedor_id) VALUES (1, 2);

    -- Una obra de Vega ligada a Delta, con su póliza.
    INSERT INTO proyectos (client_id, contratante_id, nombre, monto_contrato, estatus)
      VALUES (2, 1, 'Torre Delta', 12500000, 'en_proceso');
    INSERT INTO fianzas (client_id, proyecto_id, afianzadora_id, numero_poliza, monto_afianzado)
      VALUES (2, 1, (SELECT id FROM afianzadoras LIMIT 1), 'ASE-1', 500000);

    -- Dos archivos sobre la MISMA obra, de dueños distintos. Es la combinación
    -- que el borrado por client_id se dejaba a medias.
    INSERT INTO documentos (client_id, entidad_tipo, entidad_id, tipo_doc, url, nombre_archivo, subido_por)
      VALUES (2, 'proyecto', 1, 'contrato',          'https://cdn/contrato.pdf', 'contrato.pdf', 'fortex'),
             (1, 'proyecto', 1, 'fianza_presentada', 'https://cdn/presentada.pdf', 'presentada.pdf', 'contratante');
  `);
});

test('la baja de un proveedor no deja documentos huérfanos de nadie', async () => {
  const borrado = await eliminarCliente(VEGA);

  assert.equal(await contar('proyectos'), 0);
  assert.equal(await contar('fianzas'), 0);
  // El del contratante también se fue, aunque su client_id NO era el del cliente
  // que se dio de baja: colgaba de una obra que ya no existe.
  assert.equal(await contar('documentos'), 0,
    'quedó un documento apuntando a un proyecto borrado, y su archivo en Cloudinary');

  // Y el resumen los contó: son los archivos que el admin cree que está borrando.
  assert.equal(borrado.archivos, 2);
  assert.equal(borrado.padrones_de_los_que_sale, 1);
});

test('la baja de un contratante NO se lleva las obras ni las pólizas de sus proveedores', async () => {
  const borrado = await eliminarCliente(DELTA);

  // Delta se fue...
  assert.equal(await contar('clients', 'id = 1'), 0);
  assert.equal(await contar('client_proveedores'), 0, 'su padrón se va con él, por CASCADE');

  // ...pero la obra y la póliza son de Vega y se quedan, solo desligadas.
  assert.equal(await contar('proyectos'), 1);
  assert.equal(await contar('fianzas'), 1);
  const obra = await memoria.prepare('SELECT contratante_id, nombre FROM proyectos WHERE id = 1').get();
  assert.equal(obra.contratante_id, null, 'ON DELETE SET NULL: la obra queda, sin contratante');
  assert.equal(obra.nombre, 'Torre Delta');

  // El contrato del proveedor sigue ahí; la copia de Delta se fue con Delta.
  const quedan = await memoria.prepare('SELECT tipo_doc FROM documentos ORDER BY id').all();
  assert.deepEqual(quedan.map((d) => d.tipo_doc), ['contrato']);

  // Y el resumen dice el daño colateral: una obra de un tercero queda sin
  // contratante. Es el único número que habla de datos que no son de Delta.
  assert.equal(borrado.obras_desligadas, 1);
  assert.equal(borrado.proyectos, 0, 'Delta no tenía obras propias');
});

test('la baja de un fiado normal sigue funcionando igual', async () => {
  // Sin contratante de por medio: el camino de siempre no se tocó.
  await memoria.query('UPDATE proyectos SET contratante_id = NULL WHERE id = 1');
  await memoria.query('DELETE FROM client_proveedores');
  await memoria.query(`DELETE FROM documentos WHERE client_id = 1`);

  const borrado = await eliminarCliente(VEGA);
  assert.equal(borrado.proyectos, 1);
  assert.equal(borrado.fianzas, 1);
  assert.equal(borrado.archivos, 1);
  assert.equal(await contar('clients'), 1, 'solo se fue Vega');
});
