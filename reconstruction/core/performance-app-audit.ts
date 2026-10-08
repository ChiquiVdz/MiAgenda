import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";
import { coreDatabaseUrl } from "./src/environment.ts";
import { localInstant, localParts, shiftDate } from "./src/local-time.ts";
import { ActivityQueries } from "./src/queries.ts";
import { identityAdapter } from "./src/authentication.ts";
import { PantryService } from "./src/pantry.ts";
import { RecipeService } from "./src/recipes.ts";
import { PlannerService } from "./src/planner.ts";
import { ShoppingService } from "./src/shopping.ts";

// Real account reads only: PostgreSQL rejects writes. Never print contents,
// identifiers, session tokens, SQL, parameters or connection credentials.
const mode = process.argv[2];
if (mode !== "before" && mode !== "after") throw new Error("Elige before o after.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: coreDatabaseUrl(),
  max: 2, options: "-c default_transaction_read_only=on", connectionTimeoutMillis: 10000 }),
  log: [{ emit: "event", level: "query" }] });
let queries = 0;
db.$on("query", () => { queries++; });
try {
  const owner = await db.user.findFirst({ where: { sessions: { some: { expires: { gt: new Date() } } } },
    select: { id: true, timeZone: true, dataRevision: true }, orderBy: { createdAt: "asc" } });
  if (!owner) throw new Error("No hay una cuenta con sesión activa para medir.");
  const session = await db.session.findFirst({ where: { userId: owner.id, expires: { gt: new Date() } }, select: { sessionToken: true } });
  const task = await db.activity.findFirst({ where: { userId: owner.id, lifecycle: "active" }, select: { id: true }, orderBy: { createdAt: "desc" } });
  const ingredient = await db.pantryBalance.findFirst({ where: { userId: owner.id }, select: { ingredientId: true } });
  const today = localParts(new Date(), owner.timeZone).date;
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const sunday = shiftDate(today, -weekday), monday = shiftDate(today, -((weekday + 6) % 7));
  const month = today.slice(0, 7) + "-01", year = today.slice(0, 4) + "-01-01";
  const nextMonth = new Date(`${month}T12:00:00Z`); nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const monthEnd = nextMonth.toISOString().slice(0, 10), yearEnd = `${Number(today.slice(0, 4)) + 1}-01-01`;
  const activity = new ActivityQueries(db), pantry = new PantryService(db), recipes = new RecipeService(db);
  const planner = new PlannerService(db), shopping = new ShoppingService(db);
  function agenda(start: string, end: string, highlightedOnly = false) {
    return activity.agenda(owner!.id, { startsAt: localInstant(start, "00:00", owner!.timeZone),
      endsAt: localInstant(end, "00:00", owner!.timeZone), startDate: start, endDate: end, highlightedOnly });
  }
  const reads: [string, () => Promise<unknown>][] = [
    ["session", async () => identityAdapter(db).getSessionAndUser!(session!.sessionToken)],
    ["inbox", () => activity.inbox(owner.id)], ["calendars", () => activity.calendars(owner.id)],
    ["agenda-day", () => agenda(today, shiftDate(today, 1))],
    ["agenda-week", () => agenda(sunday, shiftDate(sunday, 7))],
    ["agenda-month", () => agenda(month, monthEnd)], ["agenda-year", () => agenda(year, yearEnd, true)],
    ["pantry", () => pantry.snapshot(owner.id)], ["recipes", () => recipes.snapshot(owner.id)],
    ["planner-week", () => planner.snapshot(owner.id, monday, 7)],
    ["planner-fortnight", () => planner.snapshot(owner.id, monday, 14)],
    ["shopping", () => shopping.snapshot(owner.id)],
  ];
  if (task) reads.push(["detail", () => activity.detail(owner.id, task.id)]);
  if (ingredient) reads.push(["stock-history", () => pantry.history(owner.id, ingredient.ingredientId)]);
  const samples = [];
  for (let round = 1; round <= 3; round++) for (const [view, read] of reads) {
    let result: unknown, duration = 0;
    for (let attempt = 0; ; attempt++) {
      queries = 0; const start = performance.now();
      try { result = await read(); duration = performance.now() - start; break; }
      catch (cause) {
        const code = cause && typeof cause === "object" && "code" in cause ? String(cause.code).replace(/[^A-Z0-9_]/gi, "").slice(0, 32) : "READ_FAILED";
        console.log(JSON.stringify({ round, view, readAttemptFailed: attempt + 1, code }));
        if (attempt >= 1) throw cause;
      }
    }
    const serialized = JSON.stringify(result);
    // Authentication is measured but its content is never hashed/persisted.
    const sample = { round, view, ms: Math.round(duration), queries,
      bytes: view === "session" ? null : Buffer.byteLength(serialized),
      digest: view === "session" ? null : createHash("sha256").update(serialized).digest("hex") };
    samples.push(sample); console.log(JSON.stringify({ round, view, ms: sample.ms, queries, bytes: sample.bytes }));
  }
  const end = await db.user.findUniqueOrThrow({ where: { id: owner.id }, select: { dataRevision: true } });
  writeFileSync(`reconstruction/core/performance-app-${mode}.json`, JSON.stringify({
    measuredAt: new Date().toISOString(), dataChangedDuringRun: end.dataRevision !== owner.dataRevision,
    samples }, null, 2) + "\n");
} catch {
  console.error("No se pudo completar la medición de solo lectura. No se modificaron datos.");
  process.exitCode = 1;
} finally { await db.$disconnect(); }
