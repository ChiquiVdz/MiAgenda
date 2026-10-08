import { createCoreDatabase } from "./src/database.ts";

// Read-only installation inspection. No users/tasks/test fixtures are created.
const db = createCoreDatabase();
try {
  const database = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  const tables = await db.$queryRaw<{ name: string }[]>`
    SELECT tablename AS name FROM pg_catalog.pg_tables
    WHERE schemaname = 'public' ORDER BY tablename`;
  const triggers = await db.$queryRaw<{ name: string }[]>`
    SELECT t.tgname AS name FROM pg_catalog.pg_trigger t
    JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal ORDER BY t.tgname`;
  const migrations = await db.$queryRaw<{ name: string }[]>`
    SELECT migration_name AS name FROM public._prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  const constraints = await db.$queryRaw<{ name: string }[]>`
    SELECT con.conname AS name FROM pg_catalog.pg_constraint con
    JOIN pg_catalog.pg_namespace n ON n.oid = con.connamespace
    WHERE n.nspname = 'public' AND con.contype = 'c' ORDER BY con.conname`;
  console.log(JSON.stringify({ database: database[0].name,
    tables: tables.map(row => row.name), triggers: triggers.map(row => row.name),
    checks: constraints.map(row => row.name),
    migrations: migrations.map(row => row.name) }, null, 2));
} catch {
  console.error("No se pudo inspeccionar la instalación del núcleo; no se cambiaron datos.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
