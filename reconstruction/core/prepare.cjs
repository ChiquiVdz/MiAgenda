// Offline preparation only: schema validation and SQL generation from an empty
// datamodel. No real datasource, migrate deploy/dev, db push or db execute.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");

const root = path.resolve(__dirname, "../..");
// This utility only builds the INITIAL nine-table subset. Once a forward
// migration exists, running it would overwrite the current recurrence schema.
const currentInstallation = path.join(__dirname, "installation.json");
if (fs.existsSync(currentInstallation) && JSON.parse(fs.readFileSync(currentInstallation, "utf8")).forwardMigrations?.some(item => item.applied)) {
  throw new Error("Forward migrations are installed. Do not rerun initial preparation; use prisma generate and new incremental migrations.");
}
const sourcePath = path.join(root, "docs/schema.objetivo.prisma");
const source = fs.readFileSync(sourcePath, "utf8");
const models = ["User", "Account", "Session", "VerificationToken", "Calendar", "CalendarPreference", "Activity", "ActivitySchedule", "CommandReceipt"];
const enums = ["ActivityKind", "ActivityLifecycle", "ScheduleMode"];
const omit = {
  User: new Set(["series", "privateIngredients", "ingredientPreferences", "pantry", "recipes", "mealSlots", "operations", "shoppingEntries", "purchases"]),
  Calendar: new Set(["segments"]),
  Activity: new Set(["occurrenceId", "seriesStepId", "occurrence", "seriesStep", "mealBlock", "mealStep", "operations"]),
};
function block(type, name) {
  const match = source.match(new RegExp(`^${type} ${name} \\{([\\s\\S]*?)^\\}`, "m"));
  if (!match) throw new Error(`Missing source block ${type} ${name}`);
  const lines = match[0].split(/\r?\n/).filter((line) => {
    const first = line.trim().split(/\s+/)[0];
    if (omit[name]?.has(first)) return false;
    if (name === "Activity" && /@@unique\(\[(parentId, seriesStepId|occurrenceId, userId)\]\)/.test(line)) return false;
    return true;
  });
  return lines.join("\n");
}
const header = `// Isolated core, derived from docs/schema.objetivo.prisma.\n// Future module/recurrence relations are introduced by later migrations.\ngenerator client {\n  provider = "prisma-client"\n  output = "./generated"\n  importFileExtension = "ts"\n}\ndatasource db {\n  provider = "postgresql"\n}\n`;
const schema = header + "\n" + enums.map((name) => block("enum", name)).join("\n\n") + "\n\n" + models.map((name) => block("model", name)).join("\n\n") + "\n";
const schemaPath = path.join(__dirname, "schema.prisma");
fs.writeFileSync(schemaPath, schema);
const cli = path.join(root, "node_modules/prisma/build/index.js");
const config = path.join(__dirname, "prisma.config.ts");
function run(args) {
  const result = spawnSync(process.execPath, [cli, ...args, "--config", config], { cwd: root, encoding: "utf8", timeout: 120000 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `Prisma exited ${result.status}`);
  return result.stdout;
}
process.stdout.write(run(["validate", "--schema", schemaPath]));
const baseSql = run(["migrate", "diff", "--from-empty", "--to-schema", schemaPath, "--script"]);
if ((baseSql.match(/CREATE TABLE /g) || []).length !== models.length) {
  throw new Error("Prisma did not emit all core tables; migration was not prepared.");
}
const constraints = fs.readFileSync(path.join(__dirname, "constraints.sql"), "utf8");
const migrationDir = path.join(__dirname, "migrations/20261003000100_core");
fs.mkdirSync(migrationDir, { recursive: true });
const guard = `-- ISOLATED DATABASE ONLY. Do not execute against the current MiAgenda DB.\nBEGIN;\nSET LOCAL search_path = public, pg_catalog;\nDO $guard$\nBEGIN\n  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace\n    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')\n      AND c.relname <> '_prisma_migrations'\n      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype = 'e')) THEN\n    RAISE EXCEPTION 'MiAgenda core requires an empty isolated database; no existing objects were changed';\n  END IF;\nEND\n$guard$;\n\n`;
const migration = guard + baseSql + "\n-- Additional domain constraints, not represented by Prisma.\n" + constraints + "\nCOMMIT;\n";
const installationPath = path.join(__dirname, "installation.json");
if (fs.existsSync(installationPath)) {
  const installed = JSON.parse(fs.readFileSync(installationPath, "utf8"));
  const hash = crypto.createHash("sha256").update(migration).digest("hex");
  if (installed.migrationSha256 !== hash) {
    throw new Error("The initial migration is already installed. Preserve it and add a new forward migration.");
  }
}
fs.writeFileSync(path.join(migrationDir, "migration.sql"), migration);
fs.writeFileSync(path.join(__dirname, "migrations/migration_lock.toml"), 'provider = "postgresql"\n');
fs.writeFileSync(path.join(__dirname, "prepared.json"), JSON.stringify({
  source: "docs/schema.objetivo.prisma",
  sourceSha256: crypto.createHash("sha256").update(source).digest("hex"),
  schemaSha256: crypto.createHash("sha256").update(schema).digest("hex"),
  migrationSha256: crypto.createHash("sha256").update(migration).digest("hex"),
  tables: models,
  validation: "prisma validate passed; SQL generated offline; installation tracked separately in installation.json",
}, null, 2) + "\n");
console.log(`Prepared ${models.length} core tables and migration SQL offline.`);
