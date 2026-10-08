import type { Prisma } from "../generated/client.ts";
import { CoreError } from "./errors.ts";

/** All dates, including hidden calendars and unscheduled dependent children. */
export async function calendarImpact(tx: Prisma.TransactionClient, userId: string, id: string) {
  const calendar = await tx.calendar.findFirst({ where: { id, userId } });
  if (!calendar) throw new CoreError("NOT_FOUND", "El calendario no está disponible.");
  const segments = await tx.seriesSegment.findMany({ where: { userId, calendarId: id, series: { is: { retiredAt: null } } }, select: { seriesId: true } });
  const seriesIds = [...new Set(segments.map(segment => segment.seriesId))];
  const scheduled = await tx.activity.findMany({ where: { userId, lifecycle: "active", schedule: { is: { calendarId: id, userId } } },
    select: { id: true, parentId: true } });
  const seriesRoots = seriesIds.length ? await tx.activity.findMany({ where: { userId, lifecycle: "active", occurrence: { is: { seriesId: { in: seriesIds } } } }, select: { id: true, parentId: true } }) : [];
  const rootIds = [...new Set([...scheduled, ...seriesRoots].filter(item => !item.parentId).map(item => item.id))];
  const children = rootIds.length ? await tx.activity.findMany({ where: { userId, lifecycle: "active", parentId: { in: rootIds } },
    select: { id: true, parentId: true } }) : [];
  const ids = [...new Set([...scheduled, ...seriesRoots, ...children].map(item => item.id))];
  const affectedParents = [...new Set(scheduled.filter(item => item.parentId && !rootIds.includes(item.parentId)).map(item => item.parentId!))];
  const stepRules=await tx.seriesStepDefinition.findMany({where:{userId,scheduleCalendarId:id,segment:{is:{series:{is:{retiredAt:null}}}}},select:{stepKeyId:true}});
  const scheduledStepCount=new Set(stepRules.map(step=>step.stepKeyId)).size;
  const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
  return { calendar, scheduledStepCount, ids, affectedParents, seriesIds, dataRevision: owner.dataRevision.toString(),
    scheduledCount: scheduled.length, deleteCount: ids.length, dependentCount: ids.length - scheduled.length };
}
