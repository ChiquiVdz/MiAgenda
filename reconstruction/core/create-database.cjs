// Explicit operator action: create an additional EMPTY database on the current
// Neon project. Does not delete, reset or change tables in the legacy database.
const fs = require("node:fs");
const path = require("node:path");
const { parse } = require("dotenv");
const { Client } = require("pg");
const root = path.resolve(__dirname, "../..");
const targetFile = path.join(__dirname, ".env.local");

async function main() {
  if (fs.existsSync(targetFile)) throw new Error("El entorno del núcleo ya existe; no se reemplazó.");
  const raw = parse(fs.readFileSync(path.join(root, ".env.local"), "utf8")).DATABASE_URL;
  if (!raw) throw new Error("No hay conexión actual para preparar la base separada.");
  const url = new URL(raw);
  if (!/\.neon\.tech$/i.test(url.hostname)) throw new Error("Este preparador solo admite el proyecto Neon existente.");
  if (decodeURIComponent(url.pathname) === "/miagenda_core") throw new Error("La conexión actual ya apunta al nombre reservado para el núcleo.");
  url.searchParams.delete("uselibpqcompat");
  url.searchParams.set("sslmode", "verify-full");
  const client = new Client({ connectionString: url.toString(), connectionTimeoutMillis: 10000, query_timeout: 15000 });
  try {
    await client.connect();
    const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", ["miagenda_core"]);
    if (found.rows.length) throw new Error("miagenda_core ya existe. Configura su URL manualmente; no se cambió esa base.");
    await client.query('CREATE DATABASE "miagenda_core"');
    url.pathname = "/miagenda_core";
    // Exclusive create prevents overwriting a connection the user just supplied.
    fs.writeFileSync(targetFile, `MIAGENDA_CORE_DATABASE_URL=${JSON.stringify(url.toString())}\n`, { flag: "wx" });
    console.log("Base miagenda_core creada y conexión guardada sin mostrar credenciales.");
  } finally { await client.end(); }
}
main().catch(error => {
  // Never echo connection strings or raw driver error objects.
  const allowed = ["El entorno", "No hay", "Este preparador", "La conexión", "miagenda_core"];
  console.error(allowed.some(prefix => error.message?.startsWith(prefix)) ? error.message :
    `No se pudo crear la base separada desde la conexión actual (${String(error.code ?? "sin código").replace(/[^A-Z0-9_]/g, "")}). Usa los pasos de Neon indicados.`);
  process.exitCode = 1;
});
