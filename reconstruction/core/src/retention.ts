import { Prisma, type PrismaClient } from "../generated/client.ts";
import { uuid } from "./contracts.ts";
import { CoreError } from "./errors.ts";
import { localInstant } from "./local-time.ts";
import { occurrenceSchedule, protectedVisible } from "./series-runtime.ts";
import { projectedProgress } from "./series-progress.ts";
import { segmentEnd, segmentOccurrence } from "./series-generation.ts";

type Tx = Prisma.TransactionClient;
const day = 86400000;
export const retentionDays = 5;
export const retentionBatchSize = 50;

async function eligible(tx: Tx, userId: string, now: Date, limit: number) {
  const cutoff = new Date(now.getTime() - retentionDays * day);
  // Retire complete aggregates, never lose a casilla needed by an active root.
  return tx.$queryRaw<{ id: string; occurrenceId: string | null }[]>`
    SELECT a.id, a."occurrenceId" FROM public.activities a
    LEFT JOIN public.activity_schedules s ON s."activityId" = a.id AND s."userId" = a."userId"
    WHERE a."userId" = ${userId}::uuid AND a.lifecycle = 'active' AND a.kind IN ('task','meal')
      AND a."parentId" IS NULL AND NOT a.keep AND a."completedAt" <= ${cutoff}
      AND (s."activityId" IS NULL OR s."purgeEligibleAt" <= ${now})
      AND NOT EXISTS (SELECT 1 FROM public.activities c
        LEFT JOIN public.activity_schedules cs ON cs."activityId" = c.id AND cs."userId" = c."userId"
        WHERE c."parentId" = a.id AND c."userId" = a."userId" AND c.lifecycle = 'active'
          AND (c.keep OR (c."completedAt" IS NULL AND NOT (a.kind='meal' AND EXISTS(SELECT 1 FROM public.meal_step_data d WHERE d."activityId"=c.id AND d."userId"=c."userId" AND d.role='preparation' AND d.optional))) OR c."completedAt" > ${cutoff}
            OR (cs."activityId" IS NOT NULL AND (cs."purgeEligibleAt" IS NULL OR cs."purgeEligibleAt" > ${now}))))
    ORDER BY a."completedAt", a.id LIMIT ${limit}`;
}

async function retireRows(tx: Tx, userId: string, now: Date, limit: number) {
  const rows = await eligible(tx, userId, now, limit);
  if (!rows.length) return 0;
  const children = await tx.activity.findMany({ where: { userId, lifecycle: "active", parentId: { in: rows.map(row => row.id) } }, select: { id: true } });
  const ids = [...rows.map(row => row.id), ...children.map(row => row.id)];
  await tx.mealCell.deleteMany({where:{userId,blockId:{in:rows.map(row=>row.id)}}});
  await tx.activitySchedule.deleteMany({ where: { userId, activityId: { in: ids } } });
  await tx.activity.updateMany({ where: { userId, id: { in: ids }, lifecycle: "active" }, data: {
    lifecycle: "retired", title: "", description: null, position: 0, completedAt: null, keep: false, highlighted: false,
  } });
  const occurrenceIds = rows.flatMap(row => row.occurrenceId ? [row.occurrenceId] : []);
  if (occurrenceIds.length) await tx.occurrenceOverride.updateMany({ where: { userId, id: { in: occurrenceIds } }, data: { retiredAt: now } });
  return ids.length;
}

async function retireChildSchedules(tx: Tx, userId: string, now: Date) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT c.id FROM public.activities c JOIN public.activities p ON p.id = c."parentId" AND p."userId" = c."userId"
    JOIN public.activity_schedules s ON s."activityId" = c.id AND s."userId" = c."userId"
    WHERE c."userId" = ${userId}::uuid AND c.lifecycle = 'active' AND c.kind = 'task'
      AND p.lifecycle = 'active' AND NOT p.keep AND NOT c.keep AND c."completedAt" IS NOT NULL
      AND s."purgeEligibleAt" <= ${now}
    ORDER BY s."purgeEligibleAt", c.id LIMIT ${retentionBatchSize}`;
  if (rows.length) {
    const ids = rows.map(row => row.id);
    await tx.activity.updateMany({ where: { userId, id: { in: ids } }, data: { keep: false, highlighted: false } });
    await tx.activitySchedule.deleteMany({ where: { userId, activityId: { in: ids } } });
  }
  return rows.length;
}

/** Compact adjacent/overlapping exclusions; persisted exceptions are separately
 * authoritative and can remain protected inside a retired virtual range. */
async function retireRange(tx: Tx, userId: string, seriesId: string, from: bigint, to: bigint) {
  const overlaps = await tx.occurrenceRetirementRange.findMany({ where: { userId, seriesId, reason: "purged", fromOrdinal: { lte: to }, toOrdinal: { gte: from } } });
  if (overlaps.some(range => range.fromOrdinal <= from && range.toOrdinal >= to)) return false;
  for (const range of overlaps) { if (range.fromOrdinal < from) from = range.fromOrdinal; if (range.toOrdinal > to) to = range.toOrdinal; }
  if (overlaps.length) await tx.occurrenceRetirementRange.deleteMany({ where: { userId, id: { in: overlaps.map(range => range.id) } } });
  // A deletion range at the same boundary already excludes these ordinals.
  const existing = await tx.occurrenceRetirementRange.findUnique({ where: { seriesId_fromOrdinal: { seriesId, fromOrdinal: from } } });
  if (existing) await tx.occurrenceRetirementRange.update({ where: { id: existing.id }, data: { toOrdinal: existing.toOrdinal > to ? existing.toOrdinal : to } });
  else await tx.occurrenceRetirementRange.create({ data: { userId, seriesId, fromOrdinal: from, toOrdinal: to, reason: "purged" } });
  return true;
}

async function retireVirtual(tx: Tx, userId: string, now: Date, cursor: string | null) {
  const cutoff = new Date(now.getTime() - retentionDays * day);
  const segment = await tx.seriesSegment.findFirst({ where: { userId, ...(cursor ? { id: { gt: cursor } } : {}),
    series: { is: { retiredAt: null, progressRules: { some: { completed: true, appliedAt: { lte: cutoff } } } } } },
    orderBy: { id: "asc" }, include: { steps: true, series: { include: { retiredRanges: true } } } });
  if (!segment) return { cursor: null, cycleDone: true, ranges: 0 };
  const rules = await tx.seriesProgressRule.findMany({ where: { userId, seriesId: segment.seriesId } });
  // Find the first occurrence whose end hasn't passed, including durations
  // spanning several days. Invalid local times have no visible occurrence.
  let low = Number(segment.fromOrdinal), high = Number(segmentEnd(segment));
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    let passed = false;
    try {
      const date = segmentOccurrence(segment, middle).date;
      let schedule;
      try { schedule = occurrenceSchedule(segment, date); }
      catch (error) {
        if (!(error instanceof CoreError) || error.code !== "INVALID_INPUT") throw error;
        // Noon is a conservative boundary for a nonexistent local start.
        const startsAt = localInstant(date, "12:00", segment.timeZone);
        passed = Date.parse(startsAt) + (segment.durationMinutes ?? segment.durationDays! * 1440) * 60000 <= now.getTime();
      }
      if (schedule) passed = Date.parse(schedule.mode === "timed" ? schedule.endsAt : localInstant(schedule.endDate, "00:00", schedule.timeZone)) <= now.getTime();
    } catch { /* beyond valid rule/date horizon */ }
    if (passed) low = middle + 1; else high = middle;
  }
  const end = low;
  if (end <= Number(segment.fromOrdinal)) return { cursor: segment.id, cycleDone: false, ranges: 0 };
  // Split only at state changes, not into every future date.
  const boundaries = [...new Set([Number(segment.fromOrdinal), end,
    ...rules.flatMap(item => [Number(item.fromOrdinal), ...(item.toOrdinal === null ? [] : [Number(item.toOrdinal)])]),
    ...(segment.protectedRanges as { from: number; to: number }[]).flatMap(item => [item.from, item.to]),
    ...segment.series.retiredRanges.flatMap(item => [Number(item.fromOrdinal), Number(item.toOrdinal)])])]
    .filter(value => value >= Number(segment.fromOrdinal) && value <= end).sort((a, b) => a - b);
  let ranges = 0, more = false;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i], to = boundaries[i + 1];
    if (segment.series.retiredRanges.some(item => item.fromOrdinal <= from && item.toOrdinal >= to)) continue;
    if (!protectedVisible(segment, segment.steps, rules, from)) continue;
    const progress = projectedProgress(segment.steps, rules, from);
    if (progress.completedAt && progress.completedAt <= cutoff && progress.children.every(child => child.completedAt && child.completedAt <= cutoff)) {
      if (ranges >= 10) { more = true; break; }
      if (await retireRange(tx, userId, segment.seriesId, BigInt(from), BigInt(to))) ranges++;
    }
  }
  if (ranges) await tx.recurrenceSeries.update({ where: { id: segment.seriesId }, data: { revision: { increment: 1 } } });
  return { cursor: more ? cursor : segment.id, cycleDone: false, ranges };
}

/** Invoked by an authenticated maintenance POST or protected cron. Never by GET
 * queries. Same owner lock/order as ActivityService, with no external calls. */
export async function cleanupCoreUser(db: PrismaClient, owner: string) {
  const userId = uuid(owner);
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`;
    const owners = await tx.$queryRaw<{ retentionCheckedAt: Date | null; retentionSegmentCursor: string | null }[]>`
      SELECT "retentionCheckedAt", "retentionSegmentCursor" FROM public.users WHERE id = ${userId}::uuid FOR UPDATE`;
    if (!owners.length) throw new CoreError("UNAUTHENTICATED", "La sesión no está disponible.");
    // PostgreSQL's clock, never a date supplied by a client.
    const clocks = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = clocks[0].now, ownerState = owners[0];
    if (ownerState.retentionCheckedAt && now.getTime() - ownerState.retentionCheckedAt.getTime() < day) return { changed: false, retired: 0, ranges: 0, hasMore: false };
    const virtual = await retireVirtual(tx, userId, now, ownerState.retentionSegmentCursor);
    const schedulesRetired = await retireChildSchedules(tx, userId, now);
    const retired = await retireRows(tx, userId, now, retentionBatchSize);
    // Receipt compaction has its own agreed horizon in the offline block.
    // Never remove the identities/receipts that prevent replayed effects.
    const hasMore = !virtual.cycleDone || schedulesRetired === retentionBatchSize || (await eligible(tx, userId, now, 1)).length > 0;
    await tx.user.update({ where: { id: userId }, data: { retentionSegmentCursor: virtual.cursor, retentionCheckedAt: hasMore ? null : now } });
    return { changed: retired > 0 || virtual.ranges > 0 || schedulesRetired > 0, retired, ranges: virtual.ranges, schedulesRetired, hasMore };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });
}

export async function cleanupCoreCron(db: PrismaClient) {
  const users = await db.user.findMany({ orderBy: [{ retentionCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }], take: 10, select: { id: true } });
  let retired = 0, ranges = 0, pending = 0;
  for (const user of users) {
    const result = await cleanupCoreUser(db, user.id);
    retired += result.retired; ranges += result.ranges; if (result.hasMore) pending++;
  }
  return { processedUsers: users.length, retired, ranges, pending };
}
