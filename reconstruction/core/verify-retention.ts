import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "./generated/client.ts";
import { coreDatabaseUrl } from "./src/environment.ts";
import { cleanupCoreUser } from "./src/retention.ts";
import { ActivityService } from "./src/service.ts";
import { ActivityQueries } from "./src/queries.ts";
import { occurrenceId } from "./src/series-runtime.ts";

// Integration verification: real migrations/triggers/services, isolated schema.
// No test clock/API override is installed in the application.
const schema = `miagenda_retention_test_${randomUUID().replaceAll("-", "")}`;
assert.match(schema, /^miagenda_retention_test_[a-f0-9]{32}$/);
const connectionString = coreDatabaseUrl();
const admin = new pg.Client({ connectionString });
let client: PrismaClient | undefined;
let created = false;
const checks: string[] = [];
const check = (name: string, condition: unknown) => { assert.ok(condition, name); checks.push(name); console.log(`PASS ${name}`); };
const tableNames = [...readFileSync("reconstruction/core/schema.prisma", "utf8").matchAll(/@@map\("([a-z_]+)"\)/g)].map(match => match[1]);
const bareTables = new RegExp(`\\b(FROM|JOIN|UPDATE|INTO)\\s+(${tableNames.join("|")})\\b`, "gi");
const rewrite = (sql: string) => sql.replace(/\bpublic\b/g, schema).replace(bareTables, `$1 ${schema}.$2`);
// Prisma's ORM uses the adapter schema; production raw queries explicitly name
// public, so adapt ONLY their namespace while running this isolated copy.
function isolated<T extends object>(target: T): T {
  return new Proxy(target, { get(object, key) {
    if (key === "$transaction") return (fn: (tx: object) => unknown, options: unknown) =>
      (object as any).$transaction((tx: object) => fn(isolated(tx)), options);
    if (key === "$queryRaw" || key === "$executeRaw") return (query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]) => {
      const strings = Array.isArray(query) ? query : (query as Prisma.Sql).strings;
      const mapped = strings.map(rewrite) as unknown as TemplateStringsArray;
      Object.defineProperty(mapped, "raw", { value: strings.map(rewrite) });
      return (object as any)[key](Array.isArray(query) ? mapped : Prisma.sql(mapped, ...(query as Prisma.Sql).values), ...values);
    };
    const value = Reflect.get(object, key);
    return typeof value === "function" ? value.bind(object) : value;
  } });
}

try {
  await admin.connect();
  await admin.query(`CREATE SCHEMA "${schema}"`); created = true;
  const folder = resolve("reconstruction/core/migrations");
  for (const migration of readdirSync(folder).filter(name => /^\d/.test(name)).sort()) {
    await admin.query("BEGIN");
    await admin.query(`SET LOCAL search_path = "${schema}", pg_catalog`);
    await admin.query(rewrite(readFileSync(resolve(folder, migration, "migration.sql"), "utf8")).replace(/^(BEGIN|COMMIT);\s*$/gm, ""));
    await admin.query("COMMIT");
  }
  client = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }, { schema }) });
  const db = isolated(client);
  const namespace = await db.$queryRaw<{ schema: string }[]>`SELECT table_schema::text AS schema FROM information_schema.tables WHERE table_schema = ${schema} AND table_name = 'users'`;
  assert.equal(namespace[0].schema, schema);
  const clock = await db.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = clock[0].now, day = 86400000;
  const ago = (days: number) => new Date(now.getTime() - days * day);
  const date = (offset: number) => new Date(now.getTime() + offset * day).toISOString().slice(0, 10);
  const owner = randomUUID(), other = randomUUID(), calendar = randomUUID();
  await db.user.create({ data: { id: owner, name: "Retention verification", timeZone: "UTC" } });
  await db.user.create({ data: { id: other, name: "Other isolated test owner", timeZone: "UTC" } });
  await db.calendar.create({ data: { id: calendar, userId: owner, name: "Verification", color: "#527860" } });
  async function task(label: string, completedDays: number | null, parentId: string | null = null, userId = owner) {
    const id = randomUUID();
    await db.activity.create({ data: { id, userId, parentId, title: label, description: "Temporary verification fixture", completedAt: completedDays === null ? null : ago(completedDays) } });
    return id;
  }
  async function scheduled(id: string, offset = -10, allDay = false) {
    await db.activitySchedule.create({ data: { activityId: id, userId: owner, calendarId: calendar, timeZone: "UTC",
      ...(allDay ? { mode: "allDay", startDate: new Date(`${date(offset - 1)}T00:00:00Z`), endDate: new Date(`${date(offset)}T00:00:00Z`) }
        : { mode: "timed", startsAt: new Date(`${date(offset)}T12:00:00Z`), endsAt: new Date(`${date(offset)}T13:00:00Z`) }) } });
  }
  async function kept(id: string) { await db.activity.update({ where: { id }, data: { keep: true } }); }
  const expired = await task("Expired inbox", 6);
  const fourDays = await task("Four days", 4);
  const boundary = await task("Just under 120 hours", 5 - 1 / 24);
  const pending = await task("Old pending", null); await scheduled(pending);
  const expiredEvent = await task("Expired scheduled", 7); await scheduled(expiredEvent);
  const future = await task("Future completed event", 7); await scheduled(future, 2);
  const futureAllDay = await task("Future all day", 7); await scheduled(futureAllDay, 2, true);
  const expiredAllDay = await task("Expired all day", 7); await scheduled(expiredAllDay, -1, true);
  const keptParent = await task("Keep parent", 7); await scheduled(keptParent); await kept(keptParent);
  const protectedChild = await task("Protected by parent", 7, keptParent); await scheduled(protectedChild);
  const keptChildParent = await task("Parent protected by kept child", 7); await scheduled(keptChildParent);
  const keptChild = await task("Kept child", 7, keptChildParent); await scheduled(keptChild); await kept(keptChild);
  const futureChildParent = await task("Parent protected by future child", 7);
  const futureChild = await task("Future child", 7, futureChildParent); await scheduled(futureChild, 2);
  const freshChildParent = await task("Parent protected by recent child", 7);
  const freshChild = await task("Recent child", 4, freshChildParent);
  const pendingParent = await task("Pending parent with expired child event", null);
  const expiredChildEvent = await task("Expired event but keep casilla", 7, pendingParent); await scheduled(expiredChildEvent);
  const pendingChild = await task("Pending child", null, pendingParent);
  const aggregate = await task("Expired aggregate", 7); await scheduled(aggregate);
  const aggregateChild = await task("Expired aggregate child", 7, aggregate); await scheduled(aggregateChild);
  const otherTask = await task("Other owner must stay untouched", 20, null, other);
  for (let index = 0; index < 53; index++) await task(`Batch ${index}`, 9);

  // Create/modify recurrence using actual commands, then age only test state.
  const service = new ActivityService(db), queries = new ActivityQueries(db);
  const seriesId = randomUUID();
  await service.execute(owner, { commandId: randomUUID(), action: "createRecurringTask", id: seriesId, title: "Recurring verification", description: null,
    schedule: { mode: "timed", calendarId: calendar, timeZone: "UTC", startsAt: `${date(-10)}T12:00:00Z`, endsAt: `${date(-10)}T13:00:00Z` },
    rule: { frequency: "DAILY", interval: 1, weekdays: [], untilDate: null } });
  let series = await db.recurrenceSeries.findUniqueOrThrow({ where: { id: seriesId } });
  await service.execute(owner, { commandId: randomUUID(), action: "setCompleted", id: occurrenceId(seriesId, 0), expectedRevision: 0, completed: true, scope: "all", expectedSeriesRevision: series.revision,
    occurrence: { seriesId, ordinal: 0, seriesRevision: series.revision } });
  await db.seriesProgressRule.updateMany({ where: { userId: owner, seriesId }, data: { appliedAt: ago(7) } });
  await db.activity.update({ where: { id: occurrenceId(seriesId, 0) }, data: { completedAt: ago(7) } });
  async function exception(ordinal: number, action: "keep" | "move" | "pending") {
    series = await db.recurrenceSeries.findUniqueOrThrow({ where: { id: seriesId } });
    const common = { commandId: randomUUID(), id: occurrenceId(seriesId, ordinal), expectedRevision: 0, occurrence: { seriesId, ordinal, seriesRevision: series.revision } };
    if (action === "keep") await service.execute(owner, { ...common, action: "setFlags", keep: true });
    if (action === "pending") await service.execute(owner, { ...common, action: "setCompleted", completed: false });
    if (action === "move") await service.execute(owner, { ...common, action: "scheduleTask", schedule: { mode: "timed", calendarId: calendar, timeZone: "UTC", startsAt: `${date(2)}T12:00:00Z`, endsAt: `${date(2)}T13:00:00Z` } });
  }
  await exception(2, "keep"); await exception(3, "move"); await exception(4, "pending");

  const active = async (id: string) => (await db.activity.findUniqueOrThrow({ where: { id } })).lifecycle === "active";
  const hasSchedule = async (id: string) => !!await db.activitySchedule.findUnique({ where: { activityId_userId: { activityId: id, userId: owner } } });
  const first = await cleanupCoreUser(db, owner);
  const rootsRetired = await db.activity.count({ where: { userId: owner, parentId: null, lifecycle: "retired" } });
  check("First batch retires no more than 50 root aggregates", rootsRetired > 0 && rootsRetired <= 50);
  let rounds = 1, result = first;
  while (result.hasMore && rounds < 20) { result = await cleanupCoreUser(db, owner); rounds++; }
  check("Remaining batches finish", !result.hasMore);
  check("Completed inbox older than five days retires", !await active(expired));
  check("Four-day completion remains", await active(fourDays));
  check("Under 120 hours remains", await active(boundary));
  check("Pending activity remains", await active(pending));
  check("Completed past scheduled activity retires", !await active(expiredEvent));
  check("Future completed activity keeps schedule", await active(future) && await hasSchedule(future));
  check("Future all-day activity remains", await active(futureAllDay) && await hasSchedule(futureAllDay));
  check("Past all-day activity retires", !await active(expiredAllDay));
  check("Keep parent protects child and both schedules", await active(keptParent) && await active(protectedChild) && await hasSchedule(keptParent) && await hasSchedule(protectedChild));
  check("Kept child protects parent", await active(keptChildParent) && await active(keptChild) && await hasSchedule(keptChild));
  check("Future child protects parent", await active(futureChildParent) && await active(futureChild) && await hasSchedule(futureChild));
  check("Recent child protects parent", await active(freshChildParent) && await active(freshChild));
  check("Pending child and parent remain", await active(pendingParent) && await active(pendingChild));
  const child = await db.activity.findUniqueOrThrow({ where: { id: expiredChildEvent } });
  check("Expired child event removed but casilla/name/progress remain", child.lifecycle === "active" && !!child.completedAt && !!child.title && !await hasSchedule(expiredChildEvent));
  check("Eligible parent and child retire together", !await active(aggregate) && !await active(aggregateChild));
  const tombstone = await db.activity.findUniqueOrThrow({ where: { id: expired } });
  check("Retired details are cleared, identity remains", tombstone.id === expired && tombstone.title === "" && tombstone.description === null && tombstone.completedAt === null);
  check("Different owner untouched", await active(otherTask));
  check("Kept recurrent exception remains", await active(occurrenceId(seriesId, 2)));
  check("Moved future recurrent exception remains", await active(occurrenceId(seriesId, 3)) && await hasSchedule(occurrenceId(seriesId, 3)));
  check("Pending recurrent exception remains", await active(occurrenceId(seriesId, 4)));
  async function agenda() { return queries.agenda(owner, { startsAt: `${date(-11)}T00:00:00Z`, endsAt: `${date(4)}T00:00:00Z`, startDate: date(-11), endDate: date(4), calendarIds: [calendar] }); }
  const after = await agenda();
  check("Purged virtual recurrence does not reappear", !after.items.some(item => item.id === occurrenceId(seriesId, 1)));
  check("Future virtual recurrence still appears", after.items.some(item => item.id === occurrenceId(seriesId, 12)));
  check("Virtual purge never materializes future occurrences", !await db.activity.findUnique({ where: { id: occurrenceId(seriesId, 12) } }));
  check("Recurring family remains active", !(await db.recurrenceSeries.findUniqueOrThrow({ where: { id: seriesId } })).retiredAt);
  const countBefore = await db.activity.count({ where: { userId: owner } });
  const rangeCount = await db.occurrenceRetirementRange.count({ where: { userId: owner } });
  const revisionBefore = (await db.user.findUniqueOrThrow({ where: { id: owner } })).dataRevision;
  const again = await cleanupCoreUser(db, owner);
  check("Second execution is a no-op within daily cadence", !again.changed && !again.hasMore && (await db.user.findUniqueOrThrow({ where: { id: owner } })).dataRevision === revisionBefore);
  // Run real purge logic again, not just the cadence early return.
  await db.user.update({ where: { id: owner }, data: { retentionCheckedAt: null, retentionSegmentCursor: null } });
  let repeated = await cleanupCoreUser(db, owner);
  check("Forced test rerun makes no duplicate retirements", !repeated.changed);
  for (let i = 0; repeated.hasMore && i < 20; i++) { repeated = await cleanupCoreUser(db, owner); assert.equal(repeated.changed, false); }
  check("Repeated cleanup keeps same row/range counts", !repeated.hasMore && await db.activity.count({ where: { userId: owner } }) === countBefore && await db.occurrenceRetirementRange.count({ where: { userId: owner } }) === rangeCount);
  check("Repeated agenda read keeps exclusions", !(await agenda()).items.some(item => item.id === occurrenceId(seriesId, 1)));
  const report = { checkedAt: new Date().toISOString(), isolation: "temporary PostgreSQL schema; real migrations/triggers/services; no application user data accessed", checks, passed: checks.length, rounds, outcome: "passed", temporarySchemaRemoved: false };
  writeFileSync(resolve("reconstruction/core/retention-verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`RESULT ${checks.length} checks passed`);
} catch (error) {
  if (error instanceof assert.AssertionError) console.error(`FAIL ${error.message}`);
  else {
    const safe = (value: unknown, depth = 0): string[] => {
      if (!value || typeof value !== "object" || depth > 5) return [];
      return Object.entries(value).flatMap(([key, entry]) => ["code", "originalCode", "kind", "constraint", "name"].includes(key) && typeof entry === "string" && /^[A-Za-z0-9_]{1,100}$/.test(entry) ? [`${key}:${entry}`] : ["meta", "cause", "driverAdapterError"].includes(key) ? safe(entry, depth + 1) : []);
    };
    console.error("Verification failed", safe(error).join(" "));
  }
  process.exitCode = 1;
} finally {
  await client?.$disconnect();
  if (created) {
    assert.match(schema, /^miagenda_retention_test_[a-f0-9]{32}$/);
    await admin.query("ROLLBACK");
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    console.log("Temporary test schema removed");
    if (process.exitCode !== 1) {
      const path = resolve("reconstruction/core/retention-verification.json");
      const report = JSON.parse(readFileSync(path, "utf8")); report.temporarySchemaRemoved = true;
      writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
    }
  }
  await admin.end();
}
