import type { Prisma } from "../generated/client.ts";
import type { CoreCommand, ScheduleInput } from "./contracts.ts";
import { CoreError, invalid } from "./errors.ts";
import { localInstant, localParts, shiftDate } from "./local-time.ts";
import { stepActivityId } from "./series-runtime.ts";
import { projectedProgress } from "./series-progress.ts";
import { scopeSegments, segmentEnd } from "./series-generation.ts";

import { emptyStepSchedule, parentLocalDate, stepOccurrenceSchedule, stepScheduleData, stepScheduleDefinition } from "./series-step-schedule.ts";

type Tx = Prisma.TransactionClient;

async function retire(tx: Tx, userId: string, ids: string[]) {
  if (!ids.length) return;
  await tx.activitySchedule.deleteMany({ where: { userId, activityId: { in: ids } } });
  await tx.activity.updateMany({ where: { userId, id: { in: ids }, lifecycle: "active" }, data: { lifecycle: "retired", title: "", description: null, keep: false, highlighted: false, position: 0 } });
}

function scheduleData(schedule: ScheduleInput) {
  return { calendarId: schedule.calendarId, timeZone: schedule.timeZone, mode: schedule.mode,
    startsAt: schedule.mode === "timed" ? new Date(schedule.startsAt) : null,
    endsAt: schedule.mode === "timed" ? new Date(schedule.endsAt) : null,
    startDate: schedule.mode === "allDay" ? new Date(`${schedule.startDate}T00:00:00Z`) : null,
    endDate: schedule.mode === "allDay" ? new Date(`${schedule.endDate}T00:00:00Z`) : null };
}

/** Scope commands include every active exception by ORIGINAL ordinal, even
 * moved instances, different calendars, or instances whose schedule was removed.
 * The owner lock is acquired by ActivityService before entering this function.
 */
export async function applySeriesScope(tx: Tx, userId: string, command: CoreCommand,
  reconcile: (parentId: string) => Promise<void>): Promise<{ affectedIds: string[]; removedIds: string[] }> {
  const targetId = command.action === "createTask" ? command.parentId : command.id;
  if (!targetId) invalid("El alcance de serie requiere una actividad existente.");
  const target = await tx.activity.findFirst({ where: { id: targetId, userId, lifecycle: "active", kind: "task" }, include: { occurrence: true } });
  if (!target) throw new CoreError("NOT_FOUND", "La actividad ya no está disponible.");
  const expected = command.action === "createTask" ? command.expectedParentRevision : "expectedRevision" in command ? command.expectedRevision : -1;
  if (target.revision !== expected) throw new CoreError("CONFLICT", "La actividad cambió. Actualiza antes de aplicar a la serie.");
  const root = target.parentId ? await tx.activity.findFirst({ where: { id: target.parentId, userId, lifecycle: "active" }, include: { occurrence: true } }) : target;
  if (!root?.occurrence) invalid("Esta actividad no pertenece a una serie recurrente.");
  const seriesId = root.occurrence.seriesId;
  const family = await tx.recurrenceSeries.findFirst({ where: { id: seriesId, userId, retiredAt: null } });
  if (!family) throw new CoreError("NOT_FOUND", "La serie ya no está disponible.");
  if (family.revision !== command.expectedSeriesRevision) throw new CoreError("CONFLICT", "La serie cambió. Actualiza antes de aplicar este alcance.");
  const fromDate = command.scope === "all" ? null : root.occurrence.originalLocal.slice(0, 10);
  const segments = await scopeSegments(tx, userId, seriesId, fromDate);
  const roots = await tx.activity.findMany({ where: { userId, lifecycle: "active", occurrence: { is: { userId, seriesId, ...(fromDate ? { originalLocal: { gte: fromDate } } : {}) } } }, include: { children: { where: { lifecycle: "active" } }, schedule: true, occurrence: true } });
  const rootIds = roots.map(item => item.id), affected = new Set(rootIds), removedIds: string[] = [];
  const now = new Date();
  // A legacy instance-only child gets a private stable key. Never match by name.
  let stepKeyId = target.stepKeyId;
  if (target.parentId && !stepKeyId) {
    stepKeyId = target.id;
    await tx.seriesStepKey.create({ data: { id: stepKeyId, userId, seriesId } });
    await tx.activity.update({ where: { id: target.id }, data: { stepKeyId } });
    target.stepKeyId = stepKeyId;
    for (const parent of roots) for (const child of parent.children) if (child.id === target.id) child.stepKeyId = stepKeyId;
  }
  const matchingChildren = roots.flatMap(parent => parent.children.filter(child => child.stepKeyId === stepKeyId));

  if (command.action === "setCompleted") {
    const sequenceRows = await tx.$queryRaw<{ sequence: bigint }[]>`SELECT public.miagenda_touch_owner(${userId}::uuid) AS sequence`;
    for (const segment of segments) await tx.seriesProgressRule.create({ data: { userId, seriesId, stepKeyId: target.parentId ? stepKeyId : null,
      fromOrdinal: segment.fromOrdinal, toOrdinal: segmentEnd(segment), completed: command.completed, sequence: sequenceRows[0].sequence, commandId: command.commandId, appliedAt: now } });
    const selected = target.parentId ? matchingChildren : roots.flatMap(parent => [parent, ...parent.children]);
    const ids = selected.filter(item => command.completed !== !!item.completedAt).map(item => item.id);
    if (ids.length) await tx.activity.updateMany({ where: { userId, id: { in: ids }, lifecycle: "active" }, data: { completedAt: command.completed ? now : null } });
    selected.forEach(item => affected.add(item.id));
    if (target.parentId) for (const parentId of rootIds) await reconcile(parentId);
    // A progress instruction invalidates virtual revisions without materializing them.
    await tx.recurrenceSeries.update({ where: { id: seriesId }, data: { revision: { increment: 1 } } });
  } else if (command.action === "deleteTask" && !target.parentId) {
    if (command.scope === "all") await tx.recurrenceSeries.update({ where: { id: seriesId }, data: { retiredAt: now } });
    else {
      for (const segment of segments) await tx.occurrenceRetirementRange.upsert({ where: { seriesId_fromOrdinal: { seriesId, fromOrdinal: segment.fromOrdinal } }, create: { userId, seriesId, fromOrdinal: segment.fromOrdinal, toOrdinal: segmentEnd(segment), reason: "deleted" }, update: { toOrdinal: segmentEnd(segment) } });
      await tx.recurrenceSeries.update({ where: { id: seriesId }, data: { revision: { increment: 1 } } });
    }
    removedIds.push(...roots.flatMap(parent => [parent.id, ...parent.children.map(child => child.id)]));
    await retire(tx, userId, removedIds);
  } else {
    if ((command.action === "scheduleTask" || command.action === "unscheduleTask") && target.parentId) {
      const rootDate=parentLocalDate(roots.find(item=>item.id===root.id)?.schedule??null,root.occurrence.originalLocal);
      if(command.action==="scheduleTask" && !await tx.calendar.findFirst({where:{id:command.schedule.calendarId,userId}})) throw new CoreError("NOT_FOUND","El calendario no está disponible.");
      const definition=command.action==="scheduleTask"?stepScheduleDefinition(command.schedule,rootDate):emptyStepSchedule;
      const definitions=await tx.seriesStepDefinition.findMany({where:{userId,segmentId:{in:segments.map(segment=>segment.id)},stepKeyId:stepKeyId!}});
      const sequence=await tx.$queryRaw<{sequence:bigint}[]>`SELECT public.miagenda_touch_owner(${userId}::uuid) AS sequence`;
      for(const previous of definitions){
        const old=Object.fromEntries(Object.keys(emptyStepSchedule).map(key=>[key,previous[key as keyof typeof emptyStepSchedule]]));
        const history=[...(Array.isArray(previous.scheduleHistory)?previous.scheduleHistory:[]),{...old,sequence:sequence[0].sequence.toString()}] as Prisma.InputJsonValue;
        await tx.seriesStepDefinition.update({where:{id:previous.id},data:{...definition,...(definition.scheduleMode ? {scheduleCalendarId:segments.find(segment=>segment.id===previous.segmentId)!.calendarId}:{}),scheduleHistory:history}});
      }
      for(const parent of roots) for(const child of parent.children){
        if(child.stepKeyId!==stepKeyId || child.completedAt)continue;
        affected.add(child.id);
        const next=stepOccurrenceSchedule(definition,parentLocalDate(parent.schedule,parent.occurrence!.originalLocal),undefined,parent.schedule?.calendarId);
        if(next)await tx.activitySchedule.upsert({where:{activityId_userId:{activityId:child.id,userId}},create:{activityId:child.id,userId,...stepScheduleData(next)},update:stepScheduleData(next)});
        else {await tx.activity.update({where:{id:child.id},data:{keep:false,highlighted:false}});await tx.activitySchedule.deleteMany({where:{userId,activityId:child.id}});}
      }
    } else if (command.action === "editTask") {
      const changes = { ...(command.title !== undefined ? { title: command.title } : {}), ...(command.description !== undefined ? { description: command.description } : {}), ...(command.position !== undefined ? { position: command.position } : {}) };
      if (target.parentId) {
        if (command.title && command.title.length > 150) invalid("Las subtareas compartidas admiten hasta 150 caracteres.");
        await tx.seriesStepDefinition.updateMany({ where: { userId, segmentId: { in: segments.map(segment => segment.id) }, stepKeyId: stepKeyId! }, data: changes });
        if (matchingChildren.length) await tx.activity.updateMany({ where: { userId, id: { in: matchingChildren.map(child => child.id) }, lifecycle: "active" }, data: changes });
        matchingChildren.forEach(child => affected.add(child.id));
      } else {
        if (command.position !== undefined) invalid("El orden no es una propiedad de una serie principal.");
        await tx.seriesSegment.updateMany({ where: { userId, id: { in: segments.map(segment => segment.id) } }, data: changes });
        await tx.activity.updateMany({ where: { userId, id: { in: rootIds }, lifecycle: "active" }, data: changes });
      }
    } else if (command.action === "addSubtasks") {
      if (target.parentId) invalid("Solo se permite un nivel de subtareas.");
      if (command.children.some(child => child.title.length > 150)) invalid("Las subtareas compartidas admiten hasta 150 caracteres.");
      const existing = await tx.seriesStepDefinition.findMany({ where: { userId, segmentId: { in: segments.map(segment => segment.id) } }, select: { position: true } });
      const positions = [...existing.map(step => step.position), ...roots.flatMap(parent => parent.children.map(child => child.position))];
      const firstPosition = positions.reduce((max, position) => Math.max(max, position), -1) + 1;
      await tx.seriesStepKey.createMany({ data: command.children.map(child => ({ id: child.id, userId, seriesId })) });
      const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
      const createdSequence = owner.dataRevision + BigInt(1);
      const definitions = segments.flatMap(segment => command.children.map((child, index) => ({ userId, segmentId: segment.id, stepKeyId: child.id, title: child.title, description: null, position: firstPosition + index, createdSequence })));
      if (definitions.length) await tx.seriesStepDefinition.createMany({ data: definitions });
      const children = roots.flatMap(parent => command.children.map((child, index) => ({ id: parent.id === root.id ? child.id : stepActivityId(seriesId, Number(parent.occurrence!.ordinal), child.id), userId, parentId: parent.id, stepKeyId: child.id, title: child.title, description: null, position: firstPosition + index })));
      if (children.length) await tx.activity.createMany({ data: children });
      children.forEach(child => affected.add(child.id));
      // Every newly added child is pending, so each completed principal reopens.
      // Do this once for the whole batch, instead of querying every parent/step.
      if (rootIds.length) await tx.activity.updateMany({ where: { userId, id: { in: rootIds }, lifecycle: "active", completedAt: { not: null } }, data: { completedAt: null } });
    } else if (command.action === "createTask") {
      if (target.parentId) invalid("Solo se permite un nivel de subtareas.");
      if (command.title.length > 150 || command.schedule) invalid("Una subtarea compartida admite 150 caracteres y se programa individualmente después.");
      const keyId = command.id;
      await tx.seriesStepKey.create({ data: { id: keyId, userId, seriesId } });
      const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
      const createdSequence = owner.dataRevision + BigInt(1);
      for (const segment of segments) await tx.seriesStepDefinition.create({ data: { userId, segmentId: segment.id, stepKeyId: keyId, title: command.title, description: command.description, position: command.position, createdSequence } });
      for (const parent of roots) {
        const childId = parent.id === root.id ? command.id : stepActivityId(seriesId, Number(parent.occurrence!.ordinal), keyId);
        await tx.activity.create({ data: { id: childId, userId, parentId: parent.id, stepKeyId: keyId, title: command.title, description: command.description, position: command.position } });
        affected.add(childId); await reconcile(parent.id);
      }
    } else if (command.action === "deleteTask" && target.parentId) {
      // Removing the final child preserves the root's preceding state. Store
      // bounded progress ranges rather than materializing future instances.
      const definitions = await tx.seriesStepDefinition.findMany({ where: { userId, segmentId: { in: segments.map(segment => segment.id) } } });
      const rules = await tx.seriesProgressRule.findMany({ where: { userId, seriesId } });
      const lastStepSegments = segments.filter(segment => {
        const steps = definitions.filter(step => step.segmentId === segment.id);
        return steps.length === 1 && steps[0].stepKeyId === stepKeyId;
      });
      if (lastStepSegments.length) {
        const rows = await tx.$queryRaw<{ sequence: bigint }[]>`SELECT public.miagenda_touch_owner(${userId}::uuid) AS sequence`;
        for (const segment of lastStepSegments) {
          const end = segmentEnd(segment);
          const boundaries = [...new Set([segment.fromOrdinal, end, ...rules.flatMap(rule => [rule.fromOrdinal, ...(rule.toOrdinal === null ? [] : [rule.toOrdinal])]).filter(value => value > segment.fromOrdinal && value < end)])].sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
          for (let index = 0; index < boundaries.length - 1; index++) {
            const state = projectedProgress(definitions.filter(step => step.segmentId === segment.id), rules, Number(boundaries[index]));
            await tx.seriesProgressRule.create({ data: { userId, seriesId, fromOrdinal: boundaries[index], toOrdinal: boundaries[index + 1], completed: !!state.completedAt, appliedAt: state.completedAt ?? now, sequence: rows[0].sequence, commandId: command.commandId } });
          }
        }
      }
      await tx.seriesStepDefinition.deleteMany({ where: { userId, segmentId: { in: segments.map(segment => segment.id) }, stepKeyId: stepKeyId! } });
      removedIds.push(...matchingChildren.map(child => child.id)); await retire(tx, userId, removedIds);
      for (const parentId of rootIds) await reconcile(parentId);
    } else if (command.action === "scheduleTask") {
      if (target.parentId) invalid("El horario de las subtareas se cambia solo en esa instancia.");
      const schedule = command.schedule;
      if (!await tx.calendar.findFirst({ where: { id: schedule.calendarId, userId } })) throw new CoreError("NOT_FOUND", "El calendario no está disponible.");
      const local = schedule.mode === "timed" ? localParts(schedule.startsAt, schedule.timeZone) : null;
      const durationMinutes = schedule.mode === "timed" ? (Date.parse(schedule.endsAt) - Date.parse(schedule.startsAt)) / 60000 : null;
      const durationDays = schedule.mode === "allDay" ? (Date.parse(schedule.endDate) - Date.parse(schedule.startDate)) / 86400000 : null;
      if (durationMinutes !== null && (!Number.isInteger(durationMinutes) || durationMinutes % 15 || durationMinutes > 2147483647 || Number(local!.time.slice(3)) % 15)) invalid("Usa intervalos de 15 minutos.");
      if (schedule.mode === "timed" && (new Date(schedule.startsAt).getUTCSeconds() || new Date(schedule.startsAt).getUTCMilliseconds())) invalid("El inicio debe coincidir con un intervalo de 15 minutos.");
      for (const segment of segments) await tx.seriesSegment.update({ where: { id: segment.id }, data: { calendarId: schedule.calendarId, mode: schedule.mode, timeZone: schedule.timeZone, durationMinutes, durationDays, anchorLocal: segment.anchorLocal.slice(0, 10) + (local ? `T${local.time}` : "") } });
      for (const parent of roots) {
        // Keep a moved exception's current local date; unscheduled exceptions
        // regain their original date when scheduling the selected family scope.
        const date = parent.schedule?.mode === "timed" ? localParts(parent.schedule.startsAt!, parent.schedule.timeZone).date : parent.schedule?.startDate?.toISOString().slice(0, 10) ?? parent.occurrence!.originalLocal.slice(0, 10);
        const startsAt = local ? localInstant(date, local.time, schedule.timeZone) : null;
        const next: ScheduleInput = startsAt ? { mode: "timed", calendarId: schedule.calendarId, timeZone: schedule.timeZone, startsAt, endsAt: new Date(Date.parse(startsAt) + durationMinutes! * 60000).toISOString() } : { mode: "allDay", calendarId: schedule.calendarId, timeZone: schedule.timeZone, startDate: date, endDate: shiftDate(date, durationDays!) };
        await tx.activitySchedule.upsert({ where: { activityId_userId: { activityId: parent.id, userId } }, create: { activityId: parent.id, userId, ...scheduleData(next) }, update: scheduleData(next) });
        parent.children.forEach(child => affected.add(child.id));
      }
    } else invalid("Esta operación no admite cambios en toda la serie.");
    await tx.recurrenceSeries.update({ where: { id: seriesId }, data: { revision: { increment: 1 } } });
  }
  return { affectedIds: [...affected], removedIds };
}
