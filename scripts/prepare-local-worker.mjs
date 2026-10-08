import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Fingerprint the application's sources, so a deployment never serves an old
// offline shell indefinitely. Run before Next builds, without timestamps.
const hash = createHash("sha256");
async function visit(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    else { hash.update(path); hash.update(await readFile(path)); }
  }
}
await visit("src");
await visit("reconstruction/core/src");
hash.update(await readFile("package-lock.json"));
await visit("public/icons");
const path = "public/sw.js", worker = await readFile(path, "utf8");
hash.update(worker.replace(/const CACHE = "[^"]+";/, "const CACHE = VERSION;"));
await writeFile(path, worker.replace(/const CACHE = "[^"]+";/, `const CACHE = "miagenda-shell-${hash.digest("hex").slice(0, 16)}";`));
