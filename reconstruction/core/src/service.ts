import { createHash } from "node:crypto";
import { Prisma, type PrismaClient, type Activity } from "../generated/client.ts";
import { parseCommand, uuid, type CoreCommand, type ScheduleInput } from "./contracts.ts";
import { CoreError } from "./errors.ts";
import { type CommandResult } from "./views.ts";
import { readActivities } from "./activity-reads.ts";
import { moveStepCalendar } from "./series-step-schedule.ts";
import { calendarImpact } from "./calendar-impact.ts";
import { createSeries, materialize } from "./series-runtime.ts";
import { applySeriesScope } from "./series-scopes.ts";
import { changeFrequency, previewFrequency } from "./series-frequency.ts";
import { moveMeal, retireMeal } from "./planner.ts";
import { completeMeal, undoMeal, setMealStep } from "./meal-consumption.ts";

type Tx = Prisma.TransactionClient;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Only construct the owner argument from a VERIFIED server session. */
export class ActivityService {
  private readonly db: PrismaClient;
  constructor(db: PrismaClient) { this.db = db; }

  async execute(authenticatedUserId: string, raw: unknown): Promise<CommandResult & { replayed: boolean }> {
    const userId = uuid(authenticatedUserId, "Usuario autenticado");
    const command = parseCommand(raw);
    const payloadHash = createHash("sha256").update(canonical(command)).digest("hex");
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(async tx => {
          // Always acquire this lock BEFORE querying receipts, revisions or children.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`;
          const owners = await tx.$queryRaw<{ id: string; dataRevision: bigint }[]>`SELECT id, "dataRevision" FROM public.users WHERE id = ${userId}::uuid FOR UPDATE`;
          if (!owners.length) throw new CoreError("UNAUTHENTICATED", "La sesión no pertenece al núcleo actual.");
          const receipt = await tx.commandReceipt.findUnique({ where: { userId_commandId: { userId, commandId: command.commandId } } });
          if (receipt) {
            if (receipt.action !== command.action || receipt.payloadHash !== payloadHash) {
              throw new CoreError("IDEMPOTENCY_CONFLICT", "Este comando ya se usó con otro contenido.");
            }
            return { ...(receipt.result as unknown as CommandResult), replayed: true };
          }
          let applied = command;
          if (command.action === "saveTask" && command.frequency) {
            // Validate the exact preview BEFORE our own writes bump revisions.
            await previewFrequency(tx, userId, { ...command, ...command.frequency, action: "changeRecurrence" });
          }
          if (command.occurrence && command.action !== "changeRecurrence" && !(command.action === "saveTask" && command.frequency && command.title === undefined && command.schedule === undefined)) {
            const targetId = command.action === "createTask" ? command.parentId : command.id;
            if (!targetId || (command.action === "createTask" ? command.expectedParentRevision : "expectedRevision" in command ? command.expectedRevision : -1) !== 0) {
              throw new CoreError("INVALID_INPUT", "Referencia virtual inválida.");
            }
            const row = await materialize(tx, userId, command.occurrence, targetId);
            applied = command.action === "createTask" ? { ...command, expectedParentRevision: row.revision } : { ...command, expectedRevision: row.revision } as CoreCommand;
          }
          const result = { ...await this.apply(tx, userId, applied), baseDataRevision: owners[0].dataRevision.toString() };
          // Commit the effect AND its receipt together. Do not expire receipts yet.
          await tx.commandReceipt.create({ data: {
            userId, commandId: command.commandId, action: command.action, payloadHash,
            result: result as unknown as Prisma.InputJsonValue,
          } });
          return { ...result, replayed: false };
        }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout: 15000 });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          const sqlCode = String(error.meta?.code ?? "");
          if (attempt < 2 && (error.code === "P2034" || ["40001", "40P01"].includes(sqlCode))) continue;
          if (error.code === "P2002") throw new CoreError("CONFLICT", "Ese identificador ya existe. Actualiza y reintenta.");
          if (["P2003", "P2025"].includes(error.code)) throw new CoreError("DEPENDENCY", "Una referencia cambió o ya no está disponible.");
        }
        throw error;
      }
    }
  }

  private async target(tx: Tx, userId: string, id: string, expectedRevision: number): Promise<Activity> {
    const row = await tx.activity.findFirst({ where: { id, userId, lifecycle: "active" } });
    if (!row) throw new CoreError("NOT_FOUND", "La tarea no está disponible.");
    if (row.revision !== expectedRevision) throw new CoreError("CONFLICT", "La tarea cambió desde que la abriste. Actualiza antes de guardar.");
    return row;
  }

  /** Recompute only this parent, not every activity owned by the user. */
  private async reconcileParent(tx: Tx, userId: string, parentId: string, now: Date) {
    if (await tx.activity.findFirst({ where: { id: parentId, userId, kind: "meal", lifecycle: "active" }, select: { id: true } })) return;
    const parent = await tx.activity.findFirst({ where: { id: parentId, userId, lifecycle: "active", kind: "task", parentId: null } });
    if (!parent) throw new CoreError("DEPENDENCY", "La tarea principal ya no está disponible.");
    const counts = await tx.activity.groupBy({ by: ["completedAt"], where: { userId, parentId, lifecycle: "active" }, _count: true });
    if (!counts.length) return; // A list without children never completes itself.
    const pending = counts.some(group => group.completedAt === null);
    if (pending && parent.completedAt) {
      await tx.activity.updateMany({ where: { id: parentId, userId, lifecycle: "active" }, data: { completedAt: null } });
    } else if (!pending && !parent.completedAt) {
      await tx.activity.updateMany({ where: { id: parentId, userId, lifecycle: "active" }, data: { completedAt: now } });
    }
  }

  private async apply(tx: Tx, userId: string, command: CoreCommand): Promise<CommandResult> {
    const affected = new Set<string>();
    const removedIds: string[] = [];
    const calendars: CommandResult["calendars"] = [];
    const now = new Date();
    if (command.action === "addSubtasks") {
      const parent = await this.target(tx, userId, command.id, command.expectedRevision);
      if (parent.kind !== "task" || parent.parentId) throw new CoreError("DEPENDENCY", "Solo una tarea principal admite nuevas subtareas; los pasos de cocina se editan desde sus recetas.");
      const root = await tx.activity.findFirstOrThrow({ where: { id: parent.id, userId }, include: { occurrence: true } });
      if (command.scope && command.scope !== "this") {
        const family = root.occurrence ? await tx.recurrenceSeries.findFirst({ where: { id: root.occurrence.seriesId, userId, retiredAt: null } }) : null;
        if (!family || family.revision !== command.expectedSeriesRevision) throw new CoreError("CONFLICT", "La serie cambió. Actualiza antes de agregar subtareas.");
        if (command.children.some(child => child.title.length > 150)) throw new CoreError("INVALID_INPUT", "Las subtareas compartidas admiten hasta 150 caracteres.");
      }
      const last = await tx.activity.aggregate({ where: { userId, parentId: parent.id, lifecycle: "active" }, _max: { position: true } });
      const firstPosition = (last._max.position ?? -1) + 1;
      if (!command.scope || command.scope === "this") {
        if (root.occurrence) await tx.seriesStepKey.createMany({ data: command.children.map(child => ({ id: child.id, userId, seriesId: root.occurrence!.seriesId })) });
        await tx.activity.createMany({ data: command.children.map((child, index) => ({ id: child.id, userId, parentId: parent.id, title: child.title, description: null, position: firstPosition + index, stepKeyId: root.occurrence ? child.id : null })) });
        affected.add(parent.id); command.children.forEach(child => affected.add(child.id));
        await this.reconcileParent(tx, userId, parent.id, now);
      } else {
        const result = await applySeriesScope(tx, userId, command, parentId => this.reconcileParent(tx, userId, parentId, now));
        result.affectedIds.forEach(id => affected.add(id));
      }
    } else if (command.action === "saveTask") {
      const frequencyOnly = command.frequency && command.title === undefined && command.schedule === undefined;
      if (!frequencyOnly) {
        const row = await this.target(tx, userId, command.id, command.expectedRevision);
        if (row.kind !== "task") throw new CoreError("DEPENDENCY", "Edita esta comida desde Planificar.");
        if (command.scope && command.scope !== "this") {
          const root = await tx.activity.findFirstOrThrow({ where: { id: row.parentId ?? row.id, userId }, include: { occurrence: true } });
          const family = root.occurrence ? await tx.recurrenceSeries.findFirst({ where: { id: root.occurrence.seriesId, userId, retiredAt: null } }) : null;
          if (!family || family.revision !== command.expectedSeriesRevision) throw new CoreError("CONFLICT", "La serie cambió. Actualiza antes de guardar.");
        }
        if (command.frequency && row.parentId) throw new CoreError("DEPENDENCY", "La frecuencia pertenece a la principal.");
        if (command.schedule === null && !row.parentId && command.scope && command.scope !== "this") throw new CoreError("INVALID_INPUT", "Quita el horario solo de esta instancia.");
        const applyPart = async (part: Extract<CoreCommand, { action: "editTask" | "scheduleTask" | "unscheduleTask" }>) => {
          const current = await tx.activity.findFirstOrThrow({ where: { id: row.id, userId, lifecycle: "active" } });
          const root = current.parentId ? await tx.activity.findFirstOrThrow({ where: { id: current.parentId, userId }, include: { occurrence: true } }) : await tx.activity.findFirstOrThrow({ where: { id: current.id, userId }, include: { occurrence: true } });
          const family = root.occurrence ? await tx.recurrenceSeries.findFirstOrThrow({ where: { id: root.occurrence.seriesId, userId, retiredAt: null } }) : null;
          const result = await this.apply(tx, userId, { ...part, expectedRevision: current.revision, scope: command.scope, ...(command.scope && command.scope !== "this" ? { expectedSeriesRevision: family?.revision } : {}) });
          result.activities.forEach(item => affected.add(item.id)); result.removedIds.forEach(id => removedIds.push(id));
        };
        if (command.title !== undefined) await applyPart({ action: "editTask", commandId: command.commandId, id: row.id, expectedRevision: row.revision, title: command.title });
        if (command.schedule !== undefined) await applyPart(command.schedule === null ? { action: "unscheduleTask", commandId: command.commandId, id: row.id, expectedRevision: row.revision } : { action: "scheduleTask", commandId: command.commandId, id: row.id, expectedRevision: row.revision, schedule: command.schedule });
      }
      if (command.frequency) {
        const family = await tx.recurrenceSeries.findFirstOrThrow({ where: { id: command.frequency.seriesId, userId, retiredAt: null } });
        const target = await tx.activity.findFirst({ where: { id: command.id, userId, lifecycle: "active" } });
        const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
        await changeFrequency(tx, userId, { ...command, ...command.frequency, action: "changeRecurrence", expectedRevision: target?.revision ?? 0, expectedSeriesRevision: family.revision, expectedDataRevision: owner.dataRevision.toString() });
      }
    } else if (command.action === "changeRecurrence") {
      await changeFrequency(tx, userId, command);
    } else if (command.scope && command.scope !== "this") {
      const result = await applySeriesScope(tx, userId, command, parentId => this.reconcileParent(tx, userId, parentId, now));
      result.affectedIds.forEach(id => affected.add(id)); removedIds.push(...result.removedIds);
    } else if (command.action === "createRecurringTask") {
      await createSeries(tx, userId, command);
    } else if (command.action === "createCalendar") {
      const calendar = await tx.calendar.create({ data: {
        id: command.id, userId, name: command.name, color: command.color,
        preference: { create: { visible: true } },
      } });
      calendars.push({ id: calendar.id, name: calendar.name, color: calendar.color, revision: calendar.revision });
    } else if (command.action === "editCalendar" || command.action === "deleteCalendar") {
      const impact = await calendarImpact(tx, userId, command.id);
      if (impact.calendar.revision !== command.expectedRevision) throw new CoreError("CONFLICT", "El calendario cambió. Actualiza antes de guardar.");
      if (command.action === "editCalendar") {
        const updated = await tx.calendar.update({ where: { id: command.id }, data: { name: command.name, color: command.color } });
        calendars.push({ id: updated.id, name: updated.name, color: updated.color, revision: updated.revision });
      } else {
        if (impact.calendar.moduleKey) throw new CoreError("DEPENDENCY", "Este calendario pertenece a un módulo y su estructura está protegida.");
        if (impact.dataRevision !== command.expectedDataRevision) throw new CoreError("CONFLICT", "Los datos cambiaron. Actualiza el alcance antes de confirmar el borrado.");
        if (command.destinationId) {
          if (command.destinationId === command.id || !await tx.calendar.findFirst({ where: { id: command.destinationId, userId } })) {
            throw new CoreError("DEPENDENCY", "Elige otro calendario disponible.");
          }
          await moveStepCalendar(tx,userId,command.id,command.destinationId);
          await tx.activitySchedule.updateMany({ where: { userId, calendarId: command.id }, data: { calendarId: command.destinationId } });
          await tx.seriesSegment.updateMany({ where: { userId, calendarId: command.id }, data: { calendarId: command.destinationId } });
        } else {
          await moveStepCalendar(tx,userId,command.id,null);
          await tx.activitySchedule.deleteMany({ where: { userId, activityId: { in: impact.ids } } });
          await tx.activity.updateMany({ where: { userId, id: { in: impact.ids } }, data: {
            lifecycle: "retired", title: "", description: null, keep: false, highlighted: false, position: 0,
          } });
          removedIds.push(...impact.ids);
          await tx.recurrenceSeries.updateMany({ where: { userId, id: { in: impact.seriesIds } }, data: { retiredAt: now } });
          await tx.seriesSegment.deleteMany({ where: { userId, seriesId: { in: impact.seriesIds } } });
          for (const parentId of impact.affectedParents) {
            await this.reconcileParent(tx, userId, parentId, now); affected.add(parentId);
          }
        }
        await tx.seriesSegment.deleteMany({ where: { userId, calendarId: command.id, series: { is: { retiredAt: { not: null } } } } });
        await tx.calendar.delete({ where: { id: command.id } });
      }
    } else if (command.action === "setCalendarVisible") {
      const calendar = await tx.calendar.findFirst({ where: { id: command.id, userId } });
      if (!calendar) throw new CoreError("NOT_FOUND", "El calendario no está disponible.");
      if (calendar.revision !== command.expectedRevision) throw new CoreError("CONFLICT", "El calendario cambió. Actualiza antes de guardar.");
      await tx.calendarPreference.upsert({ where: { calendarId: calendar.id },
        create: { calendarId: calendar.id, userId, visible: command.visible }, update: { visible: command.visible } });
      const updated = await tx.calendar.update({ where: { id: calendar.id }, data: { revision: { increment: 1 } } });
      calendars.push({ id: updated.id, name: updated.name, color: updated.color, revision: updated.revision });
    } else if (command.action === "createTask") {
      let stepKeyId: string | null = null;
      if (command.parentId) {
        const parent = await this.target(tx, userId, command.parentId, command.expectedParentRevision!);
        if (parent.kind === "meal") throw new CoreError("DEPENDENCY", "Edita las recetas y pasos de esta comida desde Planificar.");
        if (parent.parentId) throw new CoreError("DEPENDENCY", "Solo se permite un nivel de subtareas.");
        if (parent.occurrenceId) {
          const occurrence = await tx.occurrenceOverride.findFirstOrThrow({ where: { id: parent.occurrenceId, userId } });
          stepKeyId = command.id;
          await tx.seriesStepKey.create({ data: { id: stepKeyId, userId, seriesId: occurrence.seriesId } });
        }
        affected.add(parent.id);
      }
      await tx.activity.create({ data: {
        id: command.id, userId, title: command.title, description: command.description,
        position: command.position, parentId: command.parentId, stepKeyId,
      } });
      affected.add(command.id);
      if (command.schedule) await this.saveSchedule(tx, userId, command.id, command.schedule);
      if (command.parentId) await this.reconcileParent(tx, userId, command.parentId, now);
    } else {
      const row = await this.target(tx, userId, command.id, command.expectedRevision);
      affected.add(row.id);
      if (row.parentId) affected.add(row.parentId);
      const mealStep = await tx.mealStepData.findFirst({ where: { activityId: row.id, userId }, select: { role: true, sourceStepKey: true, mealRecipe: { select: { recipeRevision: { select: { steps: { select: { stepKey: true, priorGroup: true } } } } } } } });
      const isPriorGroup = !!mealStep?.mealRecipe.recipeRevision.steps.some(step=>step.stepKey===mealStep.sourceStepKey && step.priorGroup);
      if (row.kind === "meal") {
        if (command.action === "setCompleted") { if(command.completed)await completeMeal(tx,userId,row.id,command.commandId,command.optionalStepIds);else await undoMeal(tx,userId,row.id,command.commandId); }
        else if (command.action === "scheduleTask") { await moveMeal(tx, userId, row, command.schedule); }
        else if (command.action === "deleteTask") { removedIds.push(...await retireMeal(tx, userId, row.id)); }
        else if (command.action !== "setFlags") throw new CoreError("DEPENDENCY", "Edita esta comida desde Planificar; su horario es obligatorio.");
        if (command.action !== "setFlags") {
          const children = await tx.activity.findMany({where:{userId,parentId:row.id,lifecycle:"active"},select:{id:true}});
          children.forEach(child=>affected.add(child.id));
          const activities = await readActivities(tx, userId, { where: { id: { in: [...affected] }, lifecycle: "active" } });
          const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
          return { activities, removedIds, calendars, dataRevision: owner.dataRevision.toString() };
        }
      }
      if (command.action === "setCompleted" && command.optionalStepIds !== undefined && row.kind !== "meal") throw new CoreError("INVALID_INPUT", "La selección de opcionales solo corresponde al círculo de una comida.");
      if (mealStep?.role === "preparation" && command.action === "setCompleted") {
        const changedSteps = await setMealStep(tx,userId,row.id,command.completed,command.commandId);
        changedSteps.forEach(id=>affected.add(id));
        const activities=await readActivities(tx,userId,{where:{id:{in:[...affected]},lifecycle:"active"}}),owner=await tx.user.findUniqueOrThrow({where:{id:userId},select:{dataRevision:true}});
        return {activities,removedIds,calendars,dataRevision:owner.dataRevision.toString()};
      }
      if (mealStep?.role === "preparation" && command.action !== "setFlags" && !(isPriorGroup && ["scheduleTask","unscheduleTask"].includes(command.action))) throw new CoreError("DEPENDENCY", "Edita los pasos de cocina desde Planificar.");
      switch (command.action) {
        case "editTask":
          await tx.activity.updateMany({ where: { id: row.id, userId, revision: command.expectedRevision }, data: {
            ...(command.title !== undefined ? { title: command.title } : {}),
            ...(command.description !== undefined ? { description: command.description } : {}),
            ...(command.position !== undefined ? { position: command.position } : {}),
          } });
          break;
        case "setCompleted": {
          if (!row.parentId) {
            const children = await tx.activity.findMany({ where: { userId, parentId: row.id, lifecycle: "active" }, select: { id: true } });
            children.forEach(child => affected.add(child.id));
            await tx.activity.updateMany({ where: { userId, parentId: row.id, lifecycle: "active",
              completedAt: command.completed ? null : { not: null } }, data: { completedAt: command.completed ? now : null } });
          }
          if (command.completed !== !!row.completedAt) {
            // Children can have bumped the parent's revision. Its ORIGINAL revision
            // was validated under the owner lock; use the locked aggregate here.
            await tx.activity.updateMany({ where: { id: row.id, userId, lifecycle: "active" },
              data: { completedAt: command.completed ? now : null } });
          }
          if (row.parentId) await this.reconcileParent(tx, userId, row.parentId, now);
          break;
        }
        case "setFlags": {
          const keep = command.highlighted === true && !row.highlighted ? true : (command.keep ?? row.keep);
          const highlighted = command.highlighted ?? row.highlighted;
          if ((keep || highlighted) && !await tx.activitySchedule.findFirst({ where: { activityId: row.id, userId } })) {
            throw new CoreError("DEPENDENCY", "Conservar y Destacar requieren una fecha programada.");
          }
          await tx.activity.updateMany({ where: { id: row.id, userId, revision: command.expectedRevision }, data: { keep, highlighted } });
          break;
        }
        case "scheduleTask": {
          if ((mealStep?.role === "priorReminder" || isPriorGroup) && command.schedule.mode !== "timed") throw new CoreError("DEPENDENCY", "Una preparación previa necesita hora y duración; puedes quitar su horario conservando la casilla.");
          await this.saveSchedule(tx, userId, row.id, command.schedule);
          if(!row.parentId){const children=await tx.activity.findMany({where:{userId,parentId:row.id,lifecycle:"active",schedule:{isNot:null}},select:{id:true}});children.forEach(child=>affected.add(child.id));}
          if (mealStep) await tx.mealStepData.update({ where: { activityId: row.id }, data: { scheduleManuallyAdjusted: true } });
          break;
        }
        case "unscheduleTask":
          await tx.activity.updateMany({ where: { id: row.id, userId, revision: command.expectedRevision }, data: { keep: false, highlighted: false } });
          await tx.activitySchedule.deleteMany({ where: { activityId: row.id, userId } });
          break;
        case "deleteTask": {
          const children = await tx.activity.findMany({ where: { userId, parentId: row.id, lifecycle: "active" }, select: { id: true } });
          const ids = [row.id, ...children.map(child => child.id)];
          await tx.activitySchedule.deleteMany({ where: { userId, activityId: { in: ids } } });
          // Minimal identities prevent a delayed offline creation from resurrecting
          // a retired item. No titles/descriptions/flags survive in the tombstone.
          await tx.activity.updateMany({ where: { userId, id: { in: ids } }, data: {
            lifecycle: "retired", title: "", description: null, keep: false, highlighted: false, position: 0,
          } });
          removedIds.push(...ids);
          if (row.parentId) await this.reconcileParent(tx, userId, row.parentId, now);
          break;
        }
      }
    }
    const activities = await readActivities(tx, userId, { where: { id: { in: [...affected] }, lifecycle: "active" }, orderBy: { id: "asc" } });
    const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
    return { activities, removedIds, calendars, dataRevision: owner.dataRevision.toString() };
  }

  private async saveSchedule(tx: Tx, userId: string, id: string, schedule: ScheduleInput) {
    const parent=await tx.activity.findFirst({where:{userId,id},select:{parent:{select:{schedule:{select:{calendarId:true}}}}}});
    if(parent?.parent?.schedule) schedule={...schedule,calendarId:parent.parent.schedule.calendarId};
    if (!await tx.calendar.findFirst({ where: { id: schedule.calendarId, userId } })) {
      throw new CoreError("NOT_FOUND", "El calendario no está disponible.");
    }
    const data = { calendarId: schedule.calendarId, mode: schedule.mode, timeZone: schedule.timeZone,
      startsAt: schedule.mode === "timed" ? new Date(schedule.startsAt) : null,
      endsAt: schedule.mode === "timed" ? new Date(schedule.endsAt) : null,
      startDate: schedule.mode === "allDay" ? new Date(`${schedule.startDate}T00:00:00Z`) : null,
      endDate: schedule.mode === "allDay" ? new Date(`${schedule.endDate}T00:00:00Z`) : null };
    await tx.activitySchedule.upsert({ where: { activityId_userId: { activityId: id, userId } },
      create: { activityId: id, userId, ...data }, update: data });
  }
}
