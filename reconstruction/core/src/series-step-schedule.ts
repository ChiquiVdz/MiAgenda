import type { Prisma, SeriesStepDefinition } from "../generated/client.ts";
import type { ScheduleInput } from "./contracts.ts";
import { invalid } from "./errors.ts";
import { localInstant, localParts, shiftDate } from "./local-time.ts";

export const emptyStepSchedule = { scheduleCalendarId: null, scheduleMode: null, scheduleTimeZone: null, scheduleDayOffset: null, scheduleTime: null, scheduleDurationMinutes: null, scheduleDurationDays: null };
export function stepScheduleDefinition(schedule: ScheduleInput, parentDate: string) {
  const local = schedule.mode === "timed" ? localParts(schedule.startsAt, schedule.timeZone) : null;
  const date = local?.date ?? (schedule as Extract<ScheduleInput,{mode:"allDay"}>).startDate;
  const offset = (Date.parse(date+"T00:00:00Z")-Date.parse(parentDate+"T00:00:00Z"))/86400000;
  const duration = schedule.mode === "timed" ? (Date.parse(schedule.endsAt)-Date.parse(schedule.startsAt))/60000 : (Date.parse(schedule.endDate)-Date.parse(schedule.startDate))/86400000;
  if (!Number.isInteger(offset) || Math.abs(offset)>366 || !Number.isInteger(duration) || duration<1 || duration>(local?527040:366)) invalid("El horario relativo admite hasta un año de diferencia y duración.");
  if (local && (duration%15 || Number(local.time.slice(3))%15 || new Date(schedule.mode==="timed"?schedule.startsAt:"").getUTCSeconds() || new Date(schedule.mode==="timed"?schedule.startsAt:"").getUTCMilliseconds())) invalid("Usa intervalos de 15 minutos para la subtarea recurrente.");
  return { scheduleCalendarId: schedule.calendarId, scheduleMode: schedule.mode, scheduleTimeZone: schedule.timeZone, scheduleDayOffset: offset, scheduleTime: local?.time ?? null, scheduleDurationMinutes: local?duration:null, scheduleDurationDays: local?null:duration };
}
export function stepOccurrenceSchedule(step: Pick<SeriesStepDefinition, keyof typeof emptyStepSchedule> & {scheduleHistory?: unknown}, parentDate: string, completedSequence?: bigint, inheritedCalendarId?:string): ScheduleInput | null {
  // Keep virtual completions on the rule they actually had, without creating rows for them.
  if (completedSequence !== undefined && Array.isArray(step.scheduleHistory)) {
    const earlier = (step.scheduleHistory as (typeof step & {sequence:string})[]).find(item=>completedSequence<BigInt(item.sequence));
    if (earlier) step=earlier;
  }
  if (!step.scheduleCalendarId || !step.scheduleMode) return null;
  const date = shiftDate(parentDate, step.scheduleDayOffset!);
  if (step.scheduleMode === "allDay") return {mode:"allDay",calendarId:inheritedCalendarId??step.scheduleCalendarId,timeZone:step.scheduleTimeZone!,startDate:date,endDate:shiftDate(date,step.scheduleDurationDays!)};
  const startsAt=localInstant(date,step.scheduleTime!,step.scheduleTimeZone!);
  return {mode:"timed",calendarId:inheritedCalendarId??step.scheduleCalendarId,timeZone:step.scheduleTimeZone!,startsAt,endsAt:new Date(Date.parse(startsAt)+step.scheduleDurationMinutes!*60000).toISOString()};
}
export function parentLocalDate(schedule: {mode:string;startsAt:Date|null;startDate:Date|null;timeZone:string}|null, originalLocal:string) {
  return schedule?.mode === "timed" && schedule.startsAt ? localParts(schedule.startsAt,schedule.timeZone).date : schedule?.startDate?.toISOString().slice(0,10) ?? originalLocal.slice(0,10);
}
export function stepScheduleData(schedule: ScheduleInput) {
  return {calendarId:schedule.calendarId,timeZone:schedule.timeZone,mode:schedule.mode, startsAt:schedule.mode==="timed"?new Date(schedule.startsAt):null,endsAt:schedule.mode==="timed"?new Date(schedule.endsAt):null,startDate:schedule.mode==="allDay"?new Date(schedule.startDate+"T00:00:00Z"):null,endDate:schedule.mode==="allDay"?new Date(schedule.endDate+"T00:00:00Z"):null};
}

/** Keep future schedules and retained virtual completions consistent with calendar removal. */
export async function moveStepCalendar(tx:Prisma.TransactionClient,userId:string,calendarId:string,destinationId:string|null){
  const definitions=await tx.seriesStepDefinition.findMany({where:{userId},include:{stepKey:{select:{seriesId:true}}}});
  const families=new Set<string>();
  for(const step of definitions){
    const history=Array.isArray(step.scheduleHistory)?step.scheduleHistory as Record<string,Prisma.JsonValue>[]:[];
    const oldHistory=history.some(item=>item.scheduleCalendarId===calendarId);
    if(step.scheduleCalendarId!==calendarId&&!oldHistory)continue;
    families.add(step.stepKey.seriesId);
    if(!destinationId&&step.scheduleCalendarId===calendarId){await tx.seriesStepDefinition.delete({where:{id:step.id}});continue;}
    const nextHistory=history.map(item=>item.scheduleCalendarId===calendarId?{...item,...(destinationId?{scheduleCalendarId:destinationId}:emptyStepSchedule)}:item) as Prisma.InputJsonValue;
    await tx.seriesStepDefinition.update({where:{id:step.id},data:{...(step.scheduleCalendarId===calendarId?{scheduleCalendarId:destinationId}:{}),scheduleHistory:nextHistory}});
  }
  if(families.size)await tx.recurrenceSeries.updateMany({where:{userId,id:{in:[...families]}},data:{revision:{increment:1}}});
}
