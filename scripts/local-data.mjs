// Local administration only. Credentials never appear in output or backup metadata.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { parse } from 'dotenv';
import pg from 'pg';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const folder = resolve(process.env.MIAGENDA_BACKUP_DIR || join(process.env.LOCALAPPDATA || root, 'MiAgenda', 'backups'));
const keyFile = join(dirname(folder), 'recovery.key');
const tables = [...readFileSync(join(root, 'reconstruction/core/schema.prisma'), 'utf8').matchAll(/@@map\("([a-z_]+)"\)/g)].map(match => match[1]);
const migrations = readdirSync(join(root, 'reconstruction/core/migrations')).filter(name => /^\d+_/.test(name)).sort().map(name => ({ name, sql: readFileSync(join(root, 'reconstruction/core/migrations', name, 'migration.sql'), 'utf8') }));
const hash = value => createHash('sha256').update(value).digest('hex');
const quote = value => `"${value.replaceAll('"', '""')}"`;
const args = process.argv.slice(2);
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
function connection(restore = false) {
  const path = join(root, 'reconstruction/core', restore ? '.env.restore.local' : '.env.local');
  const name = restore ? 'MIAGENDA_RESTORE_DATABASE_URL' : 'MIAGENDA_CORE_DATABASE_URL';
  const raw = process.env[name] || (existsSync(path) ? parse(readFileSync(path))[name] : undefined);
  if (!raw) throw new Error(`Falta ${name} en ${path}.`);
  const url = new URL(raw);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!restore && decodeURIComponent(url.pathname) !== '/miagenda_core')) throw new Error('La conexión no corresponde a la base esperada.');
  url.searchParams.delete('uselibpqcompat'); url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}
function recoveryKey(create = false) {
  if (!existsSync(keyFile)) {
    if (!create || readdirSync(folder).some(name => name.endsWith('.miagenda'))) throw new Error('Falta recovery.key. Recupera la clave original; no se sustituye automáticamente.');
    writeFileSync(keyFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  }
  const value = readFileSync(keyFile, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('La clave de recuperación no es válida.');
  return Buffer.from(value, 'hex');
}
function readBackup(path) {
  const encoded = readFileSync(path);
  if (encoded.subarray(0, 8).toString() !== 'MIAGENDA') throw new Error('Formato de respaldo desconocido.');
  const decipher = createDecipheriv('aes-256-gcm', recoveryKey(), encoded.subarray(8, 20));
  decipher.setAuthTag(encoded.subarray(20, 36));
  const backup = JSON.parse(gunzipSync(Buffer.concat([decipher.update(encoded.subarray(36)), decipher.final()])).toString());
  if (backup.format !== 1 || !Array.isArray(backup.migrations) || !Array.isArray(backup.tables) || backup.schemaHash !== hash(backup.migrations.map(item => item.sql).join('\n'))) throw new Error('Respaldo inválido.');
  for (const table of backup.tables) {
    if (!/^[a-z_]+$/.test(table.name) || hash(table.rows) !== table.hash) throw new Error('Respaldo incompleto.');
  }
  return backup;
}
async function records(client, schema, name) {
  // Preserve bigint/decimal precision: PostgreSQL JSON text is never parsed in JS.
  const result = await client.query(`SELECT row_to_json(t)::text AS row FROM ${quote(schema)}.${quote(name)} t ORDER BY row_to_json(t)::text`);
  const rows = `[${result.rows.map(item => item.row).join(',')}]`;
  return { name, count: result.rowCount, rows, hash: hash(rows) };
}
async function backup(client, label = 'daily') {
  mkdirSync(folder, { recursive: true });
  const key = recoveryKey(true);
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let snapshot;
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const all = [...tables, '_prisma_migrations'];
    const items = [];
    for (const name of all) items.push(await records(client, 'public', name));
    const installed = await client.query('SELECT migration_name FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name');
    if (installed.rows.map(item => item.migration_name).join('|') !== migrations.map(item => item.name).join('|')) throw new Error('Las migraciones locales y aplicadas no coinciden; no se genera una copia incompleta.');
    snapshot = { format: 1, at: new Date().toISOString(), schemaHash: hash(migrations.map(item => item.sql).join('\n')), migrations, tables: items };
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(Buffer.from(JSON.stringify(snapshot)))), cipher.final()]);
  const path = join(folder, `${label}-${snapshot.at.replaceAll(':', '-')}.miagenda`);
  writeFileSync(`${path}.partial`, Buffer.concat([Buffer.from('MIAGENDA'), iv, cipher.getAuthTag(), encrypted]), { flag: 'wx', mode: 0o600 });
  readBackup(`${path}.partial`); renameSync(`${path}.partial`, path);
  console.log(`Respaldo cifrado guardado: ${path}`);
  return path;
}
function migrateSql(sql, schema) {
  return sql.replace(/^\s*(BEGIN|COMMIT);\s*$/gm, '').replace(/\bpublic\b/g, schema);
}
async function insertOrder(client, schema, names) {
  const result = await client.query(`SELECT child.relname AS child, parent.relname AS parent FROM pg_constraint fk
    JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_namespace ns ON ns.oid=child.relnamespace
    JOIN pg_class parent ON parent.oid=fk.confrelid WHERE fk.contype='f' AND ns.nspname=$1`, [schema]);
  const remaining = new Set(names), ordered = [];
  while (remaining.size) {
    const ready = [...remaining].filter(name => !result.rows.some(link => link.child === name && link.parent !== name && remaining.has(link.parent)));
    if (!ready.length) throw new Error('Dependencia circular entre tablas; requiere una adaptación de recuperación.');
    for (const name of ready) { ordered.push(name); remaining.delete(name); }
  }
  return ordered;
}
async function restore(client, snapshot, schema) {
  await client.query(`CREATE SCHEMA ${quote(schema)}`);
  await client.query(`SET LOCAL search_path = ${quote(schema)}, pg_catalog`);
  for (const migration of snapshot.migrations) await client.query(migrateSql(migration.sql, schema));
  await client.query(`CREATE TABLE ${quote(schema)}._prisma_migrations (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL,
    finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz,
    started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0)`);
  const names = snapshot.tables.map(item => item.name);
  for (const name of names) await client.query(`ALTER TABLE ${quote(schema)}.${quote(name)} DISABLE TRIGGER USER`);
  await client.query(`TRUNCATE ${names.map(name => `${quote(schema)}.${quote(name)}`).join(',')} RESTART IDENTITY`);
  for (const name of await insertOrder(client, schema, names)) {
    const table = snapshot.tables.find(item => item.name === name);
    if (table.count) await client.query(`INSERT INTO ${quote(schema)}.${quote(name)} SELECT * FROM json_populate_recordset(NULL::${quote(schema)}.${quote(name)}, $1::json)`, [table.rows]);
  }
  const sequences = await client.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=$1 AND column_default LIKE 'nextval(%'`, [schema]);
  for (const { table_name: name, column_name: column } of sequences.rows) {
    const relation = `${quote(schema)}.${quote(name)}`;
    await client.query(`SELECT setval(pg_get_serial_sequence($1,$2), COALESCE((SELECT max(${quote(column)}) FROM ${relation}),1), EXISTS(SELECT 1 FROM ${relation}))`, [relation, column]);
  }
  for (const name of names) await client.query(`ALTER TABLE ${quote(schema)}.${quote(name)} ENABLE TRIGGER USER`);
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  for (const table of snapshot.tables) {
    const result = await records(client, schema, table.name);
    if (result.hash !== table.hash || result.count !== table.count) throw new Error(`La restauración no coincide: ${table.name}.`);
  }
}
async function verify(client, path) {
  const snapshot = readBackup(path), schema = `miagenda_recovery_${randomBytes(12).toString('hex')}`;
  await client.query('BEGIN');
  try {
    await restore(client, snapshot, schema);
    // Rollback removes the entire rehearsal, with no writes to the live schema.
    await client.query('ROLLBACK');
    console.log(`Restauración comprobada: ${snapshot.tables.length} tablas; contenido idéntico. No se modificó la base activa.`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
async function resetTests(client, path) {
  if (option('--confirm') !== 'BORRAR-DATOS-DE-PRUEBA') throw new Error('Se requiere --confirm BORRAR-DATOS-DE-PRUEBA.');
  const snapshot = readBackup(path);
  await verify(client, path);
  const preserve = ['users', 'accounts', 'sessions', 'verification_tokens', 'ingredients'];
  const personal = tables.filter(name => !preserve.includes(name));
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    await client.query(`LOCK TABLE ${tables.map(name => `public.${quote(name)}`).join(',')} IN ACCESS EXCLUSIVE MODE`);
    for (const table of snapshot.tables.filter(item => personal.includes(item.name) || item.name === 'ingredients' || item.name === 'users')) {
      if ((await records(client, 'public', table.name)).hash !== table.hash) throw new Error('Hubo cambios desde el respaldo. Genera otro antes de borrar.');
    }
    await client.query(`TRUNCATE ${personal.map(name => `public.${quote(name)}`).join(',')} RESTART IDENTITY`);
    await client.query('ALTER TABLE public.ingredients DISABLE TRIGGER USER');
    await client.query("DELETE FROM public.ingredients WHERE scope='private'");
    await client.query('ALTER TABLE public.ingredients ENABLE TRIGGER USER');
    await client.query('UPDATE public.users SET "dataRevision"="dataRevision"+1, "retentionCheckedAt"=NULL, "retentionSegmentCursor"=NULL, "kitchenInitialized"=false, "eatingMinutes"=20, "washingMinutes"=10, "updatedAt"=clock_timestamp()');
    await client.query('INSERT INTO public.calendars (id,"userId",name,color) SELECT gen_random_uuid(),id,\'General\',\'#16a34a\' FROM public.users');
    await client.query('INSERT INTO public.calendar_preferences ("calendarId","userId",visible,position) SELECT id,"userId",true,0 FROM public.calendars');
    await client.query('COMMIT');
    console.log('Datos de prueba retirados. Se conservaron cuentas, sesiones y catálogo común.');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
async function main() {
  const action = args[0];
  if (!['backup', 'verify', 'restore', 'reset-test-data', 'daily', 'status'].includes(action)) throw new Error('Usa backup, verify --file, restore --file, reset-test-data --file, daily o status.');
  const client = new pg.Client({ connectionString: connection(action === 'restore'), connectionTimeoutMillis: 15000, query_timeout: 120000 });
  client.on('error', () => {});
  await client.connect();
  try {
    if (action === 'status') {
      const result = await client.query(`SELECT (SELECT count(*) FROM public.users)::int AS accounts,
        (SELECT count(*) FROM public.activities)::int AS activities,
        (SELECT count(*) FROM public.recurrence_series)::int AS series,
        (SELECT count(*) FROM public.recipes)::int AS recipes,
        (SELECT count(*) FROM public.pantry_balances)::int AS pantry,
        (SELECT count(*) FROM public.shopping_entries)::int AS shopping,
        (SELECT count(*) FROM public.inventory_operations)::int AS inventory_operations,
        (SELECT count(*) FROM public.ingredients WHERE scope='global')::int AS common_ingredients,
        (SELECT count(*) FROM public.ingredients WHERE scope='private')::int AS private_ingredients,
        (SELECT count(*) FROM public.calendars WHERE name='General')::int AS general_calendars`);
      console.log(JSON.stringify(result.rows[0]));
    }
    else if (action === 'backup') await backup(client, option('--label') === 'before-reset' ? 'before-reset' : 'daily');
    else if (action === 'verify') await verify(client, resolve(option('--file') || ''));
    else if (action === 'reset-test-data') await resetTests(client, resolve(option('--file') || ''));
    else if (action === 'restore') {
      if (option('--confirm') !== 'RESTAURAR-EN-BASE-VACIA') throw new Error('Se requiere --confirm RESTAURAR-EN-BASE-VACIA.');
      const source = new URL(connection()), destination = new URL(connection(true));
      if (source.hostname === destination.hostname && source.pathname === destination.pathname) throw new Error('El destino debe ser otra base; no se reemplaza la activa.');
      const existing = await client.query("SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','S') LIMIT 1");
      if (existing.rowCount) throw new Error('La base destino no está vacía. No se modificó.');
      const snapshot = readBackup(resolve(option('--file') || ''));
      await client.query('BEGIN');
      try { await client.query('DROP SCHEMA public'); await restore(client, snapshot, 'public'); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; }
      console.log('Restauración terminada en la base separada. Para usarla, configura su conexión en MiAgenda.');
    } else {
      mkdirSync(folder, { recursive: true });
      const today = new Date().toISOString().slice(0, 10);
      if (!readdirSync(folder).some(name => name.startsWith(`daily-${today}`) && name.endsWith('.miagenda'))) await backup(client);
      const { createCoreDatabase } = await import('../reconstruction/core/src/database.ts');
      const { cleanupCoreCron } = await import('../reconstruction/core/src/retention.ts');
      const db = createCoreDatabase();
      try { for (let batch = 0; batch < 20; batch++) { const result = await cleanupCoreCron(db); if (!result.pending) break; } }
      finally { await db.$disconnect(); }
      const daily = readdirSync(folder).filter(name => /^daily-.*\.miagenda$/.test(name)).sort().reverse();
      for (const name of daily.slice(7)) unlinkSync(join(folder, name));
      console.log('Mantenimiento diario terminado; se conservan siete copias diarias y la copia previa al borrado.');
    }
  } finally { await client.end(); }
}
main().catch(error => {
  // pg errors can contain SQL, connection strings or row contents. Never print them.
  const message = error?.code ? `Error de base de datos (${String(error.code).replace(/[^A-Z0-9_]/gi, '')}).` :
    (error instanceof Error && !/postgres(?:ql)?:\/\//i.test(error.message) ? error.message : 'No se pudo completar la operación.');
  console.error(message); process.exitCode = 1;
});
