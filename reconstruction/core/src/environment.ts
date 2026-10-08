import { readFileSync, existsSync } from "node:fs";
import { resolve, basename } from "node:path";
import { parse } from "dotenv";

function fileValues(relative: string): Record<string, string> {
  // Runtime paths: never let a bundler import credentials as a build asset.
  const cwd = process.cwd();
  const core = basename(cwd) === "core" && basename(resolve(cwd, "..")) === "reconstruction"
    ? cwd : resolve(cwd, "reconstruction/core");
  const path = resolve(core, "src", relative);
  return existsSync(path) ? parse(readFileSync(path)) : {};
}

/** The native core is the only database; never fall back to a legacy URL. */
export function coreDatabaseUrl(): string {
  const raw = process.env.MIAGENDA_CORE_DATABASE_URL ??
    fileValues("../.env.local").MIAGENDA_CORE_DATABASE_URL;
  if (!raw) throw new Error("Falta MIAGENDA_CORE_DATABASE_URL en reconstruction/core/.env.local.");
  let target: URL;
  try { target = new URL(raw); } catch { throw new Error("La conexión del núcleo no es una URL válida."); }
  if (!["postgresql:", "postgres:"].includes(target.protocol) ||
    decodeURIComponent(target.pathname) !== "/miagenda_core") {
    throw new Error("El núcleo exige una base independiente llamada miagenda_core.");
  }
  target.searchParams.delete("uselibpqcompat");
  target.searchParams.set("sslmode", "verify-full");
  return target.toString();
}
