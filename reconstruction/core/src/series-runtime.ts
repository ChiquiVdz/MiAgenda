import { createHash } from "node:crypto";
import type { Prisma, SeriesSegment } from "../generated/client.ts";
import type { CoreCommand, OccurrenceRef, ScheduleInput } from "./contracts.ts";
import type { ActivityView } from "./views.ts";
import { CoreError, invalid } from "./errors.ts";
import { expandRecurrence, recurrenceRrule, storedRule } from "./recurrence.ts";
import { localInstant, localParts, shiftDate } from "./local-time.ts";
import { projectedProgress } from "./series-progress.ts";
import { stepOccurrenceSchedule, stepScheduleData } from "./series-step-schedule.ts";
import { segmentOccurrence, ordinalFromDate } from "./series-generation.ts";

export function stepActivityId(seriesId: string, ordinal: number, stepKeyId: string) {
  return occurrenceId(`${seriesId}:step:${stepKeyId}`, ordinal);
}

export function occurrenceId(seriesId: string, ordinal: number) {
  const hex = createHash("sha1").update(`miagenda:occurrence:${seriesId}:${ordinal}`).digest("hex").slice(0, 32).split("");
  hex[12] = "5"; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join(""); return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}
export function occurrenceSchedule(segment: SeriesSegment, date: string): ScheduleInput {
  if (segment.mode === "allDay") return { calendarId: segment.calendarId, timeZone: segment.timeZone, mode: "allDay", startDate: date, endDate: shiftDate(date, segment.durationDays!) };
  const startsAt = localInstant(date, segment.anchorLocal.slice(11), segment.timeZone);
  return { calendarId: segment.calendarId, timeZone: segment.timeZone, mode: "timed", startsAt,
    endsAt: new Date(Date.parse(startsAt) + segment.durationMinutes! * 60000).toISOString() };
}
export async function createSeries(tx: Prisma.TransactionClient, userId: string, command: Extract<CoreCommand, { action: "createRecurringTask" }>) {
  const schedule = command.schedule;
  if (!await tx.calendar.findFirst({ where: { id: schedule.calendarId, userId } })) throw new CoreError("NOT_FOUND", "El calendario no está disponible.");
  const start = schedule.mode === "allDay" ? null : localParts(schedule.startsAt, schedule.timeZone);
  const duration = schedule.mode === "timed" ? (Date.parse(schedule.endsAt) - Date.parse(schedule.startsAt)) / 60000 : null;
  if (duration !== null && (!Number.isInteger(duration) || duration % 15 || duration > 2147483647)) invalid("Las repeticiones usan duración en intervalos de 15 minutos dentro del rango permitido.");
  if (schedule.mode === "timed" && (new Date(schedule.startsAt).getUTCSeconds() || new Date(schedule.startsAt).getUTCMilliseconds() || Number(start!.time.slice(3)) % 15)) invalid("El inicio de una repetición debe coincidir con un intervalo de 15 minutos.");
  const durationDays = schedule.mode === "allDay" ? (Date.parse(schedule.endDate) - Date.parse(schedule.startDate)) / 86400000 : null;
  await tx.recurrenceSeries.create({ data: { id: command.id, userId, segments: { create: {
    calendarId: schedule.calendarId, fromOrdinal: 0, title: command.title, description: command.description,
    mode: schedule.mode, timeZone: schedule.timeZone, anchorLocal: start ? `${start.date}T${start.time}` : (schedule as Extract<ScheduleInput, { mode: "allDay" }>).startDate,
    rrule: recurrenceRrule(command.rule), untilDate: command.rule.untilDate ? new Date(`${command.rule.untilDate}T00:00:00Z`) : null,
    durationMinutes: duration, durationDays,
  } } } });
}

/** Called inside the same owner lock / receipt transaction as the mutation. */
export async function materialize(tx: Prisma.TransactionClient, userId: string, ref: OccurrenceRef, id: string) {
  const rootId = occurrenceId(ref.seriesId, ref.ordinal);
  const series = await tx.recurrenceSeries.findFirst({ where: { id: ref.seriesId, userId, retiredAt: null } });
  if (!series) throw new CoreError("NOT_FOUND", "La serie ya no está disponible.");
  if (series.revision !== ref.seriesRevision) throw new CoreError("CONFLICT", "La serie cambió. Actualiza antes de modificar esta instancia.");
  if (await tx.occurrenceOverride.findFirst({ where: { seriesId: series.id, userId, ordinal: ref.ordinal } })) {
    throw new CoreError("CONFLICT", "Esta instancia cambió desde que la abriste. Actualiza antes de guardar.");
  }
  if (await tx.occurrenceRetirementRange.findFirst({ where: { userId, seriesId: series.id, fromOrdinal: { lte: ref.ordinal }, toOrdinal: { gt: ref.ordinal } } })) throw new CoreError("NOT_FOUND", "Esta repetición fue eliminada.");
  const segment = await tx.seriesSegment.findFirst({ where: { seriesId: series.id, userId, fromOrdinal: { lte: ref.ordinal }, OR: [{ toOrdinal: null }, { toOrdinal: { gt: ref.ordinal } }] }, orderBy: { fromOrdinal: "desc" }, include: { steps: { orderBy: [{ position: "asc" }, { id: "asc" }] } } });
  if (!segment) throw new CoreError("NOT_FOUND", "La definición de esta instancia ya no existe.");
  if (id !== rootId && !segment.steps.some(step => stepActivityId(series.id, ref.ordinal, step.stepKeyId) === id)) invalid("La identidad no corresponde a la ocurrencia.");
  const occurrence = segmentOccurrence(segment, ref.ordinal);
  const schedule = occurrenceSchedule(segment, occurrence.date);
  const rules = await tx.seriesProgressRule.findMany({ where: { userId, seriesId: series.id } });
  const progress = projectedProgress(segment.steps, rules, ref.ordinal);
  if (!protectedVisible(segment, segment.steps, rules, ref.ordinal)) throw new CoreError("NOT_FOUND", "Esta fecha ya no pertenece a la repetición.");
  const generations = await tx.seriesSegment.findMany({ where: { userId, seriesId: series.id }, include: { steps: true, series: { include: { retiredRanges: true } } } });
  const priorOverrides = await tx.occurrenceOverride.findMany({ where: { userId, seriesId: series.id }, select: { originalLocal: true, seriesId: true } });
  if (priorOverrides.some(item => item.originalLocal.slice(0, 10) === occurrence.date) || generationBlocked(segment, occurrence.date, generations, rules)) throw new CoreError("CONFLICT", "Esta fecha tiene una instancia conservada. Actualiza Agenda.");
  const override = await tx.occurrenceOverride.create({ data: { userId, seriesId: series.id, ordinal: ref.ordinal, originalLocal: occurrence.originalLocal, originalTimeZone: segment.timeZone } });
  await tx.activity.create({ data: { id: rootId, userId, title: segment.title, description: segment.description, occurrenceId: override.id, completedAt: progress.completedAt } });
  for (const child of progress.children) {
    const childId=stepActivityId(series.id,ref.ordinal,child.step.stepKeyId);
    await tx.activity.create({ data: { id: childId, userId, parentId: rootId, stepKeyId: child.step.stepKeyId, title: child.step.title, description: child.step.description, position: child.step.position, completedAt: child.completedAt } });
    let childSchedule:ScheduleInput|null=null;
    try { childSchedule=stepOccurrenceSchedule(child.step,occurrence.date,child.completedSequence,segment.calendarId); } catch(error){if(!(error instanceof CoreError && error.code==="INVALID_INPUT"))throw error;}
    if(childSchedule)await tx.activitySchedule.create({data:{activityId:childId,userId,...stepScheduleData(childSchedule)}});
  }
  await tx.activitySchedule.create({ data: { activityId: rootId, userId, calendarId: schedule.calendarId, timeZone: schedule.timeZone, mode: schedule.mode,
    ...(schedule.mode === "timed" ? { startsAt: new Date(schedule.startsAt), endsAt: new Date(schedule.endsAt) } : { startDate: new Date(`${schedule.startDate}T00:00:00Z`), endDate: new Date(`${schedule.endDate}T00:00:00Z`) }) } });
  return tx.activity.findFirstOrThrow({ where: { id, userId } });
}

export async function virtualAgenda(tx: Prisma.TransactionClient, userId: string, calendarIds: string[], startDate: string, endDate: string): Promise<ActivityView[]> {
  const segments = await tx.seriesSegment.findMany({ where: { userId, series: { is: { retiredAt: null } } }, include: { series: { include: { retiredRanges: true } }, steps: { orderBy: [{ position: "asc" }, { id: "asc" }] } } });
  if (!segments.length) return [];
  // Overrides suppress the original even if moved outside this range / into Inbox.
  const overrides = await tx.occurrenceOverride.findMany({ where: { userId, seriesId: { in: segments.map(segment => segment.seriesId) } }, select: { seriesId: true, ordinal: true, originalLocal: true } });
  const excluded = new Set(overrides.map(item => `${item.seriesId}:${item.ordinal}`));
  const occupiedDates = new Set(overrides.map(item => `${item.seriesId}:${item.originalLocal.slice(0, 10)}`));
  const progressRules = await tx.seriesProgressRule.findMany({ where: { userId, seriesId: { in: segments.map(segment => segment.seriesId) } } });
  const items: ActivityView[] = [];
  for (const segment of segments) {
    const stepRules=segment.steps.flatMap(step=>[step,...(Array.isArray(step.scheduleHistory)?step.scheduleHistory as unknown as typeof segment.steps:[])]);
    if (!calendarIds.includes(segment.calendarId)) continue;
    const offsets=stepRules.map(step=>step.scheduleDayOffset??0);
    const lookback = Math.max(segment.durationDays ?? Math.ceil(segment.durationMinutes! / 1440),...stepRules.map(step=>(step.scheduleDayOffset??0)+(step.scheduleDurationDays??Math.ceil((step.scheduleDurationMinutes??0)/1440))));
    const forward=Math.max(0,...offsets.map(value=>-value));
    const anchor = segment.anchorLocal.slice(0, 10);
    let windowStart = new Date(Math.max(Date.parse(`${anchor}T00:00:00Z`), Date.parse(`${startDate}T00:00:00Z`) - (lookback + 1) * 86400000)).toISOString().slice(0, 10);
    const endMillis=Math.min(Date.parse("9999-12-31T00:00:00Z"),Date.parse(endDate+"T00:00:00Z")+(forward+1)*86400000);
    const rangeEnd = new Date(endMillis).toISOString().slice(0,10);
    const rule = storedRule(segment.rrule, segment.untilDate, segment.anchorLocal);
    while (windowStart < rangeEnd) {
      const windowEnd = Math.min(Date.parse(`${rangeEnd}T00:00:00Z`), Date.parse(`${windowStart}T00:00:00Z`) + 370 * 86400000);
      const windowEndDate = new Date(windowEnd).toISOString().slice(0, 10);
      for (const localOccurrence of expandRecurrence({ anchorLocal: segment.anchorLocal, rule, startDate: windowStart, endDate: windowEndDate, limit: 1000 }).items) {
        const occurrence = { ...localOccurrence, ordinal: localOccurrence.ordinal + Number(segment.ordinalOffset) };
        if (occurrence.ordinal < Number(segment.fromOrdinal) || (segment.toOrdinal !== null && occurrence.ordinal >= Number(segment.toOrdinal)) || excluded.has(`${segment.seriesId}:${occurrence.ordinal}`)) continue;
        if (segment.series.retiredRanges.some(range => range.fromOrdinal <= occurrence.ordinal && range.toOrdinal > occurrence.ordinal)) continue;
        if (occupiedDates.has(`${segment.seriesId}:${occurrence.date}`) || generationBlocked(segment, occurrence.date, segments, progressRules)) continue;
        const progress = projectedProgress(segment.steps, progressRules.filter(rule => rule.seriesId === segment.seriesId), occurrence.ordinal);
        if (!protectedVisible(segment, segment.steps, progressRules.filter(rule => rule.seriesId === segment.seriesId), occurrence.ordinal)) continue;
        let schedule: ScheduleInput;
        try { schedule = occurrenceSchedule(segment, occurrence.date); } catch (error) { if (error instanceof CoreError && error.code === "INVALID_INPUT") continue; throw error; }
        const normalize=(value:ScheduleInput|null)=>value?({...value,startsAt:value.mode==="timed"?value.startsAt:null,endsAt:value.mode==="timed"?value.endsAt:null,startDate:value.mode==="allDay"?value.startDate:null,endDate:value.mode==="allDay"?value.endDate:null}):null;
        const recurrence = { seriesId: segment.seriesId, ordinal: occurrence.ordinal, seriesRevision: segment.series.revision, virtual: true, originalDate: occurrence.date };
        const rootId = occurrenceId(segment.seriesId, occurrence.ordinal);
        const children=progress.children.map(child=>{
          let childSchedule:ScheduleInput|null=null;
          try{childSchedule=stepOccurrenceSchedule(child.step,occurrence.date,child.completedSequence,segment.calendarId);}catch(error){if(!(error instanceof CoreError && error.code==="INVALID_INPUT"))throw error;}
          return {id:stepActivityId(segment.seriesId,occurrence.ordinal,child.step.stepKeyId),kind:"task" as const,title:child.step.title,description:child.step.description,parentId:rootId,parentCalendarId:segment.calendarId,position:child.step.position,revision:0,stepKeyId:child.step.stepKeyId,completedAt:child.completedAt?.toISOString()??null,keep:false,highlighted:false,createdAt:segment.series.createdAt.toISOString(),updatedAt:segment.series.createdAt.toISOString(),schedule:normalize(childSchedule),recurrence};
        });
        if(calendarIds.includes(segment.calendarId))items.push({ id: rootId, kind: "task", title: segment.title, description: segment.description,
          parentId: null, parentCalendarId:undefined, position: 0, revision: 0, stepKeyId: null, completedAt: progress.completedAt?.toISOString() ?? null, keep: false, highlighted: false,
          createdAt: segment.series.createdAt.toISOString(), updatedAt: segment.series.createdAt.toISOString(), schedule: normalize(schedule),children,recurrence });
        for(const child of children)if(child.schedule && calendarIds.includes(child.schedule.calendarId))items.push({...child,children:[]});
      }
      windowStart = windowEndDate;
    }
  }
  return items;
}

type Generation = SeriesSegment & { steps: Prisma.SeriesStepDefinitionGetPayload<object>[]; series: { retiredRanges: Prisma.OccurrenceRetirementRangeGetPayload<object>[] } };
export function protectedVisible(segment: SeriesSegment, steps: Generation["steps"], rules: Prisma.SeriesProgressRuleGetPayload<object>[], ordinal: number) {
  if (!segment.protectedOnly) return true;
  return (segment.protectedRanges as { from: number; to: number }[]).some(range => range.from <= ordinal && range.to > ordinal);
}
/** Older kept/progressed/deleted dates take precedence over new generations.
 * This prevents duplicates and resurrection without materializing the future. */
export function generationBlocked(segment: SeriesSegment, date: string, generations: Generation[], rules: Prisma.SeriesProgressRuleGetPayload<object>[]) {
  for (const older of generations) {
    if (older.seriesId !== segment.seriesId || older.ordinalOffset >= segment.ordinalOffset) continue;
    const ordinal = ordinalFromDate(older, date);
    if (older.toOrdinal !== null && ordinal >= older.toOrdinal) continue;
    let original;
    try { original = segmentOccurrence(older, Number(ordinal)); } catch (error) { if (error instanceof CoreError && error.code === "INVALID_INPUT") continue; throw error; }
    if (original.date !== date) continue;
    if (older.series.retiredRanges.some(range => range.fromOrdinal <= ordinal && range.toOrdinal > ordinal)) return true;
    if (!older.protectedOnly) return true;
    if (protectedVisible(older, older.steps, rules.filter(rule => rule.seriesId === segment.seriesId), Number(ordinal))) return true;
  }
  return false;
}
