import type { Prisma } from "../generated/client.ts";
import type { CoreCommand } from "./contracts.ts";
import { CoreError, invalid } from "./errors.ts";
import { localParts, shiftDate } from "./local-time.ts";
import { expandRecurrence, parseRecurrence, recurrenceRrule, storedRule } from "./recurrence.ts";
import { generationSize, ordinalFromDate, segmentEnd, segmentOccurrence, splitSegment } from "./series-generation.ts";
import { occurrenceId, protectedVisible, generationBlocked, virtualAgenda } from "./series-runtime.ts";
import { projectedProgress } from "./series-progress.ts";

type Tx = Prisma.TransactionClient;
type Change = Extract<CoreCommand, { action: "changeRecurrence" }>;
const include = { steps: true, series: { include: { retiredRanges: true } } } as const;

async function context(tx: Tx, userId: string, seriesId: string, ordinal: number) {
  const family = await tx.recurrenceSeries.findFirst({ where: { id: seriesId, userId, retiredAt: null } });
  if (!family) throw new CoreError("NOT_FOUND", "La serie ya no está disponible.");
  const segments = await tx.seriesSegment.findMany({ where: { userId, seriesId }, include, orderBy: { fromOrdinal: "asc" } });
  const selected = segments.find(segment => segment.fromOrdinal <= ordinal && segmentEnd(segment) > ordinal);
  if (!selected) throw new CoreError("NOT_FOUND", "La definición de esta instancia ya no existe.");
  const overrides = await tx.occurrenceOverride.findMany({ where: { userId, seriesId }, include: { activity: { include: { schedule: true, children: { where: { lifecycle: "active" } } } } } });
  const own = overrides.find(item => item.ordinal === BigInt(ordinal));
  const originalDate = own?.originalLocal.slice(0, 10) ?? segmentOccurrence(selected, ordinal).date;
  const rules = await tx.seriesProgressRule.findMany({ where: { userId, seriesId } });
  if (own ? own.activity?.lifecycle !== "active" : selected.series.retiredRanges.some(range => range.fromOrdinal <= ordinal && range.toOrdinal > ordinal) || !protectedVisible(selected, selected.steps, rules, ordinal) || generationBlocked(selected, originalDate, segments, rules) || overrides.some(item => item.originalLocal.slice(0, 10) === originalDate)) throw new CoreError("NOT_FOUND", "Esta instancia ya no está disponible.");
  const clocks = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const today = localParts(clocks[0].now, selected.timeZone).date;
  // A protected exception edits the current pattern, not an obsolete generation.
  const pattern = segments.filter(segment => !segment.protectedOnly).sort((a, b) => a.ordinalOffset > b.ordinalOffset ? -1 : a.ordinalOffset < b.ordinalOffset ? 1 : a.fromOrdinal > b.fromOrdinal ? -1 : 1)[0] ?? selected;
  return { family, segments, selected, pattern, own, overrides, rules, originalDate, today };
}

export async function recurrenceInfo(tx: Tx, userId: string, seriesId: string, ordinal: number) {
  const value = await context(tx, userId, seriesId, ordinal);
  const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
  return { rule: storedRule(value.pattern.rrule, value.pattern.untilDate, value.pattern.anchorLocal),
    originalDate: value.originalDate, anchorDate: value.pattern.anchorLocal.slice(0, 10),
    seriesRevision: value.family.revision, dataRevision: owner.dataRevision.toString() };
}

function protectedRanges(segment: Awaited<ReturnType<typeof context>>["segments"][number], rules: Awaited<ReturnType<typeof context>>["rules"], boundary: bigint) {
  const end = segmentEnd(segment);
  const boundaries = [...new Set([boundary, end, ...rules.flatMap(rule => [rule.fromOrdinal, ...(rule.toOrdinal === null ? [] : [rule.toOrdinal])]).filter(value => value > boundary && value < end)])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  const ranges: { from: number; to: number }[] = [];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const state = projectedProgress(segment.steps, rules, Number(boundaries[index]));
    if (state.completedAt || state.children.some(child => child.completedAt)) ranges.push({ from: Number(boundaries[index]), to: Number(boundaries[index + 1]) });
  }
  return ranges;
}

async function plan(tx: Tx, userId: string, command: Change) {
  const value = await context(tx, userId, command.seriesId, command.ordinal);
  if (command.id !== occurrenceId(command.seriesId, command.ordinal)) invalid("Solo la principal permite cambiar la frecuencia.");
  if (value.family.revision !== command.expectedSeriesRevision || (value.own ? value.own.activity!.revision !== command.expectedRevision : command.expectedRevision !== 0)) throw new CoreError("CONFLICT", "La serie cambió. Actualiza antes de revisar la repetición.");
  const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
  if (owner.dataRevision.toString() !== command.expectedDataRevision) throw new CoreError("CONFLICT", "Los datos cambiaron. Revisa de nuevo el resumen antes de confirmar.");
  const previousRule = storedRule(value.pattern.rrule, value.pattern.untilDate, value.pattern.anchorLocal);
  const retainMonthAnchor = command.rule.frequency === previousRule.frequency && ["MONTHLY", "YEARLY"].includes(command.rule.frequency);
  const anchor = command.scope === "all" || retainMonthAnchor ? value.pattern.anchorLocal.slice(0, 10) : value.originalDate;
  const effectiveDate = command.scope === "all" || value.originalDate < value.today ? value.today : value.originalDate;
  const rule = parseRecurrence(command.rule, anchor);
  const offset = value.segments.reduce((max, segment) => segment.ordinalOffset > max ? segment.ordinalOffset : max, BigInt(0)) + generationSize;
  if (offset > BigInt(2140000000)) invalid("Esta serie alcanzó el límite de cambios de frecuencia.");
  const { id: _id, steps: _steps, series: _series, ...definition } = value.pattern;
  const next = { ...definition, id: "", anchorLocal: anchor + value.pattern.anchorLocal.slice(10), rrule: recurrenceRrule(rule), untilDate: rule.untilDate ? new Date(`${rule.untilDate}T00:00:00Z`) : null,
    ordinalOffset: offset, fromOrdinal: offset, toOrdinal: null, protectedOnly: false, protectedRanges: [] };
  next.fromOrdinal = ordinalFromDate(next, effectiveDate);
  const affected = value.segments.filter(segment => !segment.protectedOnly).flatMap(segment => {
    const boundary = ordinalFromDate(segment, effectiveDate);
    return boundary >= segmentEnd(segment) ? [] : [{ segment, boundary, ranges: protectedRanges(segment, value.rules, boundary) }];
  });
  return { ...value, rule, effectiveDate, next, affected, owner };
}

export async function previewFrequency(tx: Tx, userId: string, command: Change) {
  const value = await plan(tx, userId, command);
  const startDate = value.effectiveDate, endDate = shiftDate(startDate, Math.min(240, Math.floor((Date.parse("9999-12-31") - Date.parse(startDate)) / 86400000)));
  const calendars = [...new Set(value.segments.map(segment => segment.calendarId))];
  const oldItems = startDate < endDate ? (await virtualAgenda(tx, userId, calendars, startDate, endDate)).filter(item => !item.parentId && item.recurrence?.seriesId === command.seriesId) : [];
  const simulated = value.segments.map(segment => {
    const affected = value.affected.find(item => item.segment.id === segment.id);
    return affected ? { ...segment, fromOrdinal: affected.boundary, protectedOnly: true, protectedRanges: affected.ranges } : segment;
  });
  const occupied = new Set(value.overrides.map(item => item.originalLocal.slice(0, 10)));
  const oldDates = new Set(oldItems.map(item => item.schedule!.mode === "timed" ? localParts(item.schedule!.startsAt!, item.schedule!.timeZone).date : item.schedule!.startDate!));
  const keptDates = new Set(oldItems.filter(item => item.completedAt || item.children.some(child => child.completedAt)).map(item => item.schedule!.mode === "timed" ? localParts(item.schedule!.startsAt!, item.schedule!.timeZone).date : item.schedule!.startDate!));
  const nextDates = new Set<string>(keptDates);
  if (startDate < endDate && value.next.fromOrdinal < segmentEnd(value.next)) for (const item of expandRecurrence({ anchorLocal: value.next.anchorLocal, rule: value.rule, startDate, endDate, limit: 1000 }).items) {
    if (!occupied.has(item.date) && !generationBlocked(value.next, item.date, simulated, value.rules)) nextDates.add(item.date);
  }
  const preserved = value.overrides.filter(item => item.activity?.lifecycle === "active" && item.originalLocal.slice(0, 10) >= startDate && item.originalLocal.slice(0, 10) < endDate).length + keptDates.size;
  return { effectiveDate: startDate, previewEndDate: endDate, added: [...nextDates].filter(date => !oldDates.has(date)).length,
    removed: [...oldDates].filter(date => !nextDates.has(date)).length, preserved,
    dataRevision: value.owner.dataRevision.toString(), seriesRevision: value.family.revision };
}

export async function changeFrequency(tx: Tx, userId: string, command: Change) {
  const value = await plan(tx, userId, command);
  // Freeze legacy unbounded instructions before allocating another namespace.
  const oldEnd = value.next.ordinalOffset;
  await tx.seriesProgressRule.updateMany({ where: { userId, seriesId: command.seriesId, toOrdinal: null }, data: { toOrdinal: oldEnd } });
  for (const item of value.affected) {
    const future = await splitSegment(tx, item.segment, item.boundary);
    if (future) await tx.seriesSegment.update({ where: { id: future.id }, data: { protectedOnly: true, protectedRanges: item.ranges } });
  }
  // Materialized instances and their children are intentionally untouched.
  const { id: _id, ...definition } = value.next;
  if (definition.fromOrdinal < segmentEnd(value.next)) {
    const next = await tx.seriesSegment.create({ data: { ...definition, protectedRanges: [] } });
    for (const { id: _step, segmentId: _segment, ...step } of value.pattern.steps) await tx.seriesStepDefinition.create({ data: { ...step, scheduleHistory: step.scheduleHistory as Prisma.InputJsonValue, segmentId: next.id } });
  }
  await tx.recurrenceSeries.update({ where: { id: command.seriesId }, data: { revision: { increment: 1 } } });
}
