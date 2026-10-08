import { Prisma, type PrismaClient } from "../generated/client.ts";
import { dateOnly, instant, uuid, revision, parseCommand } from "./contracts.ts";
import { CoreError, invalid } from "./errors.ts";
import { calendarImpact } from "./calendar-impact.ts";
import { virtualAgenda } from "./series-runtime.ts";
import { recurrenceInfo, previewFrequency } from "./series-frequency.ts";
import { readActivities } from "./activity-reads.ts";

function pageSize(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 100) invalid("El tamaño de página debe estar entre 1 y 100.");
  return value;
}

export class ActivityQueries {
  private readonly db: PrismaClient;
  constructor(db: PrismaClient) { this.db = db; }

  async recurrence(authenticatedUserId: string, seriesId: string, ordinal: number) {
    const owner = uuid(authenticatedUserId), series = uuid(seriesId), index = revision(ordinal);
    return this.db.$transaction(tx => recurrenceInfo(tx, owner, series, index), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }
  async recurrencePreview(authenticatedUserId: string, raw: unknown) {
    const owner = uuid(authenticatedUserId), command = parseCommand(raw);
    if (command.action !== "changeRecurrence") invalid("Se esperaba un cambio de repetición.");
    return this.db.$transaction(tx => previewFrequency(tx, owner, command), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }

  async calendarImpact(authenticatedUserId: string, calendarId: string) {
    const userId = uuid(authenticatedUserId), id = uuid(calendarId);
    return this.db.$transaction(async tx => {
      const impact = await calendarImpact(tx, userId, id);
      return { dataRevision: impact.dataRevision, revision: impact.calendar.revision,
        scheduledStepCount: impact.scheduledStepCount, scheduledCount: impact.scheduledCount, deleteCount: impact.deleteCount,
        dependentCount: impact.dependentCount, outsideParents: impact.affectedParents.length, seriesCount: impact.seriesIds.length };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }

  private async owner(tx: Prisma.TransactionClient, userId: string) {
    const owner = await tx.user.findUnique({ where: { id: userId }, select: { dataRevision: true } });
    if (!owner) throw new CoreError("UNAUTHENTICATED", "La sesión no pertenece al núcleo actual.");
    return owner.dataRevision.toString();
  }

  async inbox(authenticatedUserId: string, options: { limit?: number; afterId?: string } = {}) {
    const userId = uuid(authenticatedUserId), limit = pageSize(options.limit ?? 50);
    const afterId = options.afterId ? uuid(options.afterId) : null;
    return this.db.$transaction(async tx => {
      const dataRevision = await this.owner(tx, userId);
      const anchor = afterId ? await tx.activity.findFirst({ where: { id: afterId, userId }, select: { createdAt: true, id: true } }) : null;
      if (afterId && !anchor) throw new CoreError("NOT_FOUND", "La referencia de página ya no existe. Actualiza Inbox.");
      const items = await readActivities(tx, userId, {
        where: { userId, kind: "task", lifecycle: "active", parentId: null, schedule: { is: null },
          ...(anchor ? { OR: [{ createdAt: { lt: anchor.createdAt } }, { createdAt: anchor.createdAt, id: { lt: anchor.id } }] } : {}) },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1,
      });
      return { dataRevision, items: items.slice(0, limit),
        nextAfterId: items.length > limit ? items[limit - 1].id : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }

  async detail(authenticatedUserId: string, id: string) {
    const userId = uuid(authenticatedUserId), activityId = uuid(id);
    return this.db.$transaction(async tx => {
      const dataRevision = await this.owner(tx, userId);
      const [item] = await readActivities(tx, userId, { where: { id: activityId, lifecycle: "active" }, take: 1 });
      if (!item) throw new CoreError("NOT_FOUND", "La actividad no está disponible.");
      const parent = item.parentId ? await tx.activity.findFirst({ where: { id: item.parentId, userId, lifecycle: "active" }, select: { id: true, title: true, revision: true } }) : null;
      return { dataRevision, item, parent };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }

  async calendars(authenticatedUserId: string) {
    const userId = uuid(authenticatedUserId);
    return this.db.$transaction(async tx => {
      const dataRevision = await this.owner(tx, userId);
      const items = await tx.calendar.findMany({ where: { userId },
        orderBy: [{ name: "asc" }, { id: "asc" }], include: { preference: true } });
      return { dataRevision, items: items.map(item => ({
        id: item.id, name: item.name, color: item.color, revision: item.revision,
        moduleKey: item.moduleKey, visible: item.preference?.visible ?? true,
        position: item.preference?.position ?? 0,
      })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }

  async agenda(authenticatedUserId: string, input: {
    startsAt: string; endsAt: string; startDate: string; endDate: string;
    calendarIds?: string[]; highlightedOnly?: boolean; limit?: number; afterId?: string;
  }) {
    const userId = uuid(authenticatedUserId);
    const startsAt = new Date(instant(input.startsAt)), endsAt = new Date(instant(input.endsAt));
    const startDate = new Date(`${dateOnly(input.startDate)}T00:00:00Z`);
    const endDate = new Date(`${dateOnly(input.endDate)}T00:00:00Z`);
    if (startsAt >= endsAt || startDate >= endDate || endsAt.getTime() - startsAt.getTime() > 370 * 86400000 ||
      endDate.getTime() - startDate.getTime() > 370 * 86400000) invalid("El rango debe ser positivo y de hasta un año.");
    const calendarIds = input.calendarIds?.map(id => uuid(id));
    if (calendarIds && calendarIds.length > 100) invalid("Demasiados calendarios en la consulta.");
    if (input.highlightedOnly !== undefined && typeof input.highlightedOnly !== "boolean") invalid("Filtro de destacados inválido.");
    const limit = pageSize(input.limit ?? 100), afterId = input.afterId ? uuid(input.afterId) : null;
    return this.db.$transaction(async tx => {
      const dataRevision = await this.owner(tx, userId);
      const calendars = await tx.calendar.findMany({ where: { userId,
        ...(calendarIds ? { id: { in: calendarIds } } : { OR: [{ preference: { is: null } }, { preference: { is: { visible: true } } }] }) },
        select: { id: true } });
      const rows = await readActivities(tx, userId, { where: { userId, lifecycle: "active",
        ...(afterId ? { id: { gt: afterId } } : {}),
        ...(input.highlightedOnly ? { highlighted: true } : {}),
        schedule: { is: { userId, calendarId: { in: calendars.map(calendar => calendar.id) },
          OR: [{ mode: "timed", startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
            { mode: "allDay", startDate: { lt: endDate }, endDate: { gt: startDate } }] } } },
        orderBy: { id: "asc" }, take: limit + 1 });
      const projected = input.highlightedOnly ? [] : await virtualAgenda(tx, userId, calendars.map(calendar => calendar.id), input.startDate, input.endDate);
      const items = [...rows, ...projected.filter(item => (!afterId || item.id > afterId) && item.schedule &&
        (item.schedule.mode === "allDay" ? item.schedule.startDate! < input.endDate && item.schedule.endDate! > input.startDate : item.schedule.startsAt! < endsAt.toISOString() && item.schedule.endsAt! > startsAt.toISOString()))]
        .sort((a, b) => a.id.localeCompare(b.id));
      return { dataRevision, items: items.slice(0, limit),
        nextAfterId: items.length > limit ? items[limit - 1].id : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }
}
