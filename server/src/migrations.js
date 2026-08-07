// Migraciones de una sola vía.
//
// SCHEMA_SQL corre completo cada vez que se llama /api/setup, así que ahí solo
// puede ir DDL idempotente. Un "multiplica los montos por 100" no lo es: a la
// segunda corrida deja la base en centavos de centavo. Por eso estos cambios
// viven aquí, con un registro en schema_migrations que los aplica una vez.
//
// Reglas: una migración YA APLICADA no se edita nunca (se agrega otra), y el
// orden del arreglo es el orden de ejecución.

import { SCHEMA_SQL } from './schema.js';

const TS_DEFAULT = "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD HH24:MI:SS')";

export const MIGRACIONES = [
  {
    // Reparte las fianzas que existían antes de que hubiera proyectos y tipos
    // de catálogo. Tiene que correr ANTES de 003, que tira la columna de texto.
    nombre: '001_backfill_proyectos_y_tipos',
    // Si la 003 ya se llevó la columna de texto, no hay nada que repartir
    // (y consultarla reventaría). Ninguna fianza nueva puede nacer huérfana:
    // la API exige proyecto y tipo.
    omitirSi: async (db) => (await tipoDeColumna(db, 'fianzas', 'tipo_fianza')) === null,
    sql: `
      INSERT INTO tipos_fianza (nombre, orden)
      SELECT DISTINCT btrim(f.tipo_fianza), 500
      FROM fianzas f
      WHERE f.tipo_fianza IS NOT NULL
        AND btrim(f.tipo_fianza) <> ''
        AND NOT EXISTS (
          SELECT 1 FROM tipos_fianza t WHERE lower(t.nombre) = lower(btrim(f.tipo_fianza))
        )
      ON CONFLICT (nombre) DO NOTHING;

      UPDATE fianzas f SET tipo_fianza_id = t.id
      FROM tipos_fianza t
      WHERE f.tipo_fianza_id IS NULL
        AND lower(t.nombre) = lower(btrim(f.tipo_fianza));

      INSERT INTO proyectos (client_id, nombre, notas)
      SELECT DISTINCT f.client_id, 'General',
             'Creado automáticamente al migrar fianzas que no tenían proyecto.'
      FROM fianzas f
      WHERE f.proyecto_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM proyectos p WHERE p.client_id = f.client_id AND p.nombre = 'General'
        );

      UPDATE fianzas f SET proyecto_id = p.id
      FROM proyectos p
      WHERE f.proyecto_id IS NULL
        AND p.client_id = f.client_id
        AND p.nombre = 'General';
    `,
  },
  {
    // Dinero a BIGINT en centavos. El float acumulaba error en montos de
    // millones; el redondeo se hace vía numeric, que es exacto.
    nombre: '002_dinero_en_centavos',
    // Cinturón y tirantes: el registro de schema_migrations ya evita repetirla,
    // pero si ese registro se perdiera, correrla de nuevo multiplicaría por 100
    // otra vez. Si los montos ya son BIGINT, no hay nada que convertir.
    omitirSi: async (db) => (await tipoDeColumna(db, 'fianzas', 'monto_afianzado')) === 'bigint',
    sql: `
      ALTER TABLE clients
        ALTER COLUMN linea_credito TYPE BIGINT USING round(linea_credito::numeric * 100);
      ALTER TABLE clients ALTER COLUMN linea_credito SET DEFAULT 0;

      ALTER TABLE client_credit_lines
        ALTER COLUMN linea_credito TYPE BIGINT USING round(linea_credito::numeric * 100);
      ALTER TABLE client_credit_lines ALTER COLUMN linea_credito SET DEFAULT 0;

      ALTER TABLE fianzas
        ALTER COLUMN prima_neta TYPE BIGINT USING round(prima_neta::numeric * 100);
      ALTER TABLE fianzas ALTER COLUMN prima_neta SET DEFAULT 0;

      ALTER TABLE fianzas
        ALTER COLUMN monto_afianzado TYPE BIGINT USING round(monto_afianzado::numeric * 100);
      ALTER TABLE fianzas ALTER COLUMN monto_afianzado SET DEFAULT 0;

      ALTER TABLE proyectos
        ALTER COLUMN monto_contrato TYPE BIGINT USING round(monto_contrato::numeric * 100);
      ALTER TABLE proyectos ALTER COLUMN monto_contrato SET DEFAULT 0;
    `,
  },
  {
    // Tira la columna de texto libre: ahora el tipo lo manda el catálogo.
    // Antes de soltarla, cualquier fianza que se hubiera quedado sin tipo se
    // marca explícitamente, para no perderla en silencio.
    nombre: '003_quitar_tipo_fianza_legacy',
    sql: `
      INSERT INTO tipos_fianza (nombre, orden) VALUES ('Sin especificar', 900)
      ON CONFLICT (nombre) DO NOTHING;

      UPDATE fianzas
      SET tipo_fianza_id = (SELECT id FROM tipos_fianza WHERE nombre = 'Sin especificar')
      WHERE tipo_fianza_id IS NULL;

      ALTER TABLE fianzas DROP COLUMN IF EXISTS tipo_fianza;
    `,
  },
  {
    // La prima total (lo que el fiado paga de verdad: neta + derecho de póliza
    // + IVA) es nueva. En las fianzas que ya estaban capturadas no hay de dónde
    // sacarla, y dejarlas en cero haría que los totales del portal se leyeran
    // como "aquí no se paga nada". Se arranca desde la neta, que es el piso
    // real, y el admin la ajusta al editar la póliza.
    //
    // Solo toca las que están en cero: si el registro de migraciones se
    // perdiera y esto volviera a correr, no pisa lo ya capturado.
    nombre: '004_prima_total_desde_prima_neta',
    sql: `
      UPDATE fianzas SET prima_total = prima_neta
      WHERE prima_total = 0 AND prima_neta > 0;
    `,
  },
];

// Parte un bloque de SQL en sentencias sueltas: el driver HTTP de Neon corre
// UNA por llamada. Se quitan los comentarios de línea para no arrastrarlos.
export function sentencias(bloqueSQL) {
  return bloqueSQL
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function tablaExiste(db, nombre) {
  const fila = await db.prepare('SELECT to_regclass(?) IS NOT NULL AS existe').get(nombre);
  return Boolean(fila?.existe);
}

export async function tipoDeColumna(db, tabla, columna) {
  const fila = await db.prepare(
    `SELECT data_type FROM information_schema.columns
     WHERE table_name = ? AND column_name = ?`
  ).get(tabla, columna);
  return fila?.data_type ?? null;
}

async function asegurarRegistro(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    nombre      TEXT PRIMARY KEY,
    aplicada_el TEXT NOT NULL DEFAULT ${TS_DEFAULT}
  )`);
}

// Base recién creada: SCHEMA_SQL ya la dejó en su forma final, así que las
// migraciones no tienen nada que hacer y se registran como aplicadas.
export async function marcarTodasAplicadas(db) {
  await asegurarRegistro(db);
  for (const m of MIGRACIONES) {
    await db
      .prepare('INSERT INTO schema_migrations (nombre) VALUES (?) ON CONFLICT DO NOTHING')
      .run(m.nombre);
  }
  return [];
}

// Deja la base al día: DDL idempotente + migraciones pendientes.
// Recibe el acceso a datos como parámetro para que las pruebas puedan correr
// exactamente este código contra un Postgres de memoria.
export async function inicializar(db) {
  // Si la base viene en blanco, SCHEMA_SQL ya la crea en su forma final: las
  // migraciones no tienen nada que arreglar y se dan por aplicadas.
  const baseNueva = !(await tablaExiste(db, 'fianzas'));

  for (const stmt of sentencias(SCHEMA_SQL)) {
    await db.query(stmt);
  }

  return baseNueva ? marcarTodasAplicadas(db) : correrMigraciones(db);
}

export async function correrMigraciones(db) {
  await asegurarRegistro(db);
  const previas = await db.prepare('SELECT nombre FROM schema_migrations').all();
  const aplicadas = new Set(previas.map((r) => r.nombre));

  const corridas = [];
  for (const m of MIGRACIONES) {
    if (aplicadas.has(m.nombre)) continue;

    // La migración se da por hecha aunque no haya que ejecutarla: así queda
    // registrada y no se vuelve a evaluar en cada arranque.
    if (!(m.omitirSi && (await m.omitirSi(db)))) {
      for (const stmt of sentencias(m.sql)) {
        await db.query(stmt);
      }
      corridas.push(m.nombre);
    }
    await db.prepare('INSERT INTO schema_migrations (nombre) VALUES (?)').run(m.nombre);
  }
  return corridas;
}
