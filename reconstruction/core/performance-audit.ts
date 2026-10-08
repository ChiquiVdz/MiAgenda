import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";
import { coreDatabaseUrl } from "./src/environment.ts";
import { ActivityQueries } from "./src/queries.ts";
import { PantryService } from "./src/pantry.ts";
import { RecipeService } from "./src/recipes.ts";
import { PlannerService } from "./src/planner.ts";
import { ShoppingService } from "./src/shopping.ts";

// Read-only diagnostics: never log SQL, parameters, credentials or application content.
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: coreDatabaseUrl(),
  max: 2, options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 10000 }),
  log: [{ emit: "event", level: "query" }] });
let queries = 0, databaseMs = 0;
db.$on("query", event => { queries++; databaseMs += event.duration; });
try {
  const owner = await db.user.findFirst({ select: { id: true }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error("No hay cuenta para medir.");
  const activities = new ActivityQueries(db);
  const reads = [
    ["inbox", () => activities.inbox(owner.id)],
    ["calendars", () => activities.calendars(owner.id)],
    ["agenda", () => activities.agenda(owner.id, { startsAt: "2026-10-04T06:00:00Z", endsAt: "2026-10-11T06:00:00Z", startDate: "2026-10-04", endDate: "2026-10-11" })],
    ["pantry", () => new PantryService(db).snapshot(owner.id)],
    ["recipes", () => new RecipeService(db).snapshot(owner.id)],
    ["planner", () => new PlannerService(db).snapshot(owner.id, "2026-10-05", 7)],
    ["shopping", () => new ShoppingService(db).snapshot(owner.id)],
  ] as const;
  const samples = [];
  for (let round = 1; round <= 3; round++) for (const [view, read] of reads) {
    queries = 0; databaseMs = 0;
    const start = performance.now(), result = await read();
    const sample = { round, view, ms: Math.round(performance.now() - start), queries,
      databaseMs, bytes: Buffer.byteLength(JSON.stringify(result)) };
    samples.push(sample); console.log(JSON.stringify(sample));
  }
  const output = process.argv[2];
  if (output && /^reconstruction\/core\/performance-(before|after)\.json$/.test(output))
    writeFileSync(output, JSON.stringify({ measuredAt: new Date().toISOString(), samples }, null, 2) + "\n");
} finally { await db.$disconnect(); }
