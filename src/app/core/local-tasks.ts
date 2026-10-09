import type { ActivityView, CommandResult } from "../../../reconstruction/core/src/views";
import { parseSchedule, type CoreCommand, type ScheduleInput } from "../../../reconstruction/core/src/contracts";
import type { LocalGuard, LocalOperation } from "../../../reconstruction/core/src/local-task-contract";
import type { LocalCopy } from "./local-contract";
import { atTime } from "./dates";

export function taskRows(copy: LocalCopy) {
  const rows = new Map<string, ActivityView>();
  for (const item of [...copy.inbox.items, ...copy.agenda.items, ...copy.highlighted.items]) {
    rows.set(item.id, item);
    for (const child of item.children) rows.set(child.id, { ...child, children: [] });
  }
  return rows;
}
export function taskGuard(copy: LocalCopy, id: string): LocalGuard {
  const row = taskRows(copy).get(id);
  return { id, revision: row?.revision ?? null, children: row?.children.map(c => ({ id: c.id, revision: c.revision })) ?? [], ...(row?.recurrence?.virtual ? { occurrence: { seriesId: row.recurrence.seriesId, ordinal: row.recurrence.ordinal, seriesRevision: row.recurrence.seriesRevision }, ...(row.recurrence.originalDate ? {date:row.recurrence.originalDate} : {}) } : {}) };
}
export function mergeTaskRows(copy: LocalCopy, updates: ActivityView[], removed: string[] = []): LocalCopy {
  const rows = taskRows(copy);
  for (const item of updates) {
    const previous = rows.get(item.id);
    if (!item.parentId && previous) for (const child of previous.children) rows.delete(child.id);
    rows.set(item.id, item);
    for (const child of item.children) rows.set(child.id, { ...child, children: [] });
  }
  removed.forEach(id => rows.delete(id));
  const items = [...rows.values()];
  const overlaps = (item: ActivityView, start: string, end: string) => item.schedule && (item.schedule.mode === "allDay" ? item.schedule.startDate! < end && item.schedule.endDate! > start : item.schedule.startsAt! < atTime(end) && item.schedule.endsAt! > atTime(start));
  const year = copy.today.slice(0, 4);
  return { ...copy,
    inbox: { ...copy.inbox, items: items.filter(i => i.kind === "task" && !i.parentId && !i.schedule).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) },
    agenda: { ...copy.agenda, items: items.filter(i => !!i.schedule).sort((a,b) => a.id.localeCompare(b.id)) },
    highlighted: { ...copy.highlighted, items: items.filter(i => i.highlighted && overlaps(i, `${year}-01-01`, `${Number(year)+1}-01-01`)).sort((a,b) => a.id.localeCompare(b.id)) } };
}
function newTask(id: string, title: string, parentId: string | null, at: string, position = 0): ActivityView {
  return { id, title, parentId, kind: "task", description: null, position, revision: 1, stepKeyId: null, completedAt: null, keep: false, highlighted: false, createdAt: at, updatedAt: at, schedule: null, recurrence: null, parentCalendarId: undefined, children: [] };
}
function setTaskSchedule(copy: LocalCopy, root: ActivityView, selected: ActivityView | ActivityView["children"][number], value: ScheduleInput | null) {
  if (!value) { selected.schedule = null; selected.keep = false; selected.highlighted = false; }
  else {
    const schedule = parseSchedule(value);
    const calendarId = selected.parentId && root.schedule ? root.schedule.calendarId : schedule.calendarId;
    if (!copy.calendars.some(calendar => calendar.id === calendarId)) throw new Error("Elige un calendario descargado en este dispositivo.");
    selected.schedule = { calendarId, mode: schedule.mode, timeZone: schedule.timeZone,
      startsAt: schedule.mode === "timed" ? schedule.startsAt : null, endsAt: schedule.mode === "timed" ? schedule.endsAt : null,
      startDate: schedule.mode === "allDay" ? schedule.startDate : null, endDate: schedule.mode === "allDay" ? schedule.endDate : null };
  }
  for (const child of root.children) {
    child.parentCalendarId = root.schedule?.calendarId;
    if (root.schedule && child.schedule) child.schedule = { ...child.schedule, calendarId: root.schedule.calendarId };
  }
}

/** Local task projections share schedule inheritance; inventory and series rules stay server-only. */
export function projectTask(copy: LocalCopy, op: LocalOperation): { copy: LocalCopy; result: CommandResult } {
  const c = op.command, rows = taskRows(copy);
  let root = rows.get(op.rootId);
  const target = "id" in c ? rows.get(c.id) : undefined;
  if (c.action === "createTask" && !c.parentId) {
    if (root) throw new Error("Esa tarea ya existe.");
    root = { ...newTask(c.id, c.title, null, op.at, c.position), description: c.description };
    if (c.schedule) setTaskSchedule(copy, root, root, c.schedule);
  } else {
    if (!root || root.parentId || root.kind !== "task" || root.mealRole) throw new Error("La tarea principal no está descargada o necesita conexión.");
    root = structuredClone(root);
    if (c.action !== "createTask" && (!target || target.kind !== "task" || target.mealRole)) throw new Error("La tarea no está disponible en esta copia.");
    const selected = c.action === "createTask" ? root : c.id === root.id ? root : root.children.find(child => child.id === c.id);
    if (!selected) throw new Error("La subtarea ya no está disponible.");
    if (c.action === "deleteTask" && !selected.parentId) throw new Error("Borrar una principal requiere conexión.");
    if (c.action === "createTask") {
      if (c.parentId !== root.id) throw new Error("Solo se admite un nivel de subtareas.");
      const child = { ...newTask(c.id, c.title, root.id, op.at, c.position), description: c.description, parentCalendarId: root.schedule?.calendarId };
      root.children.push(child);
      if (c.schedule) setTaskSchedule(copy, root, child, c.schedule);
    } else if (c.action === "addSubtasks") {
      if (selected.parentId) throw new Error("Solo se admite un nivel de subtareas.");
      const position = Math.max(-1, ...root.children.map(child => child.position)) + 1;
      root.children.push(...c.children.map((child, index) => ({...newTask(child.id, child.title, root!.id, op.at, position + index), parentCalendarId: root!.schedule?.calendarId})));
    } else if (c.action === "editTask" || c.action === "saveTask") {
      if (c.title !== undefined) selected.title = c.title;
      if (c.action === "editTask") { if (c.description !== undefined) selected.description = c.description; if (c.position !== undefined) selected.position = c.position; }
      if (c.action === "saveTask" && c.schedule !== undefined) setTaskSchedule(copy, root, selected, c.schedule);
      selected.updatedAt = op.at;
    } else if (c.action === "scheduleTask" || c.action === "unscheduleTask") {
      setTaskSchedule(copy, root, selected, c.action === "scheduleTask" ? c.schedule : null);
      selected.updatedAt = op.at;
    } else if (c.action === "setCompleted") {
      const mark = (item: typeof selected) => { if (!!item.completedAt !== c.completed) item.completedAt = c.completed ? op.at : null; };
      mark(selected); if (!selected.parentId) root.children.forEach(mark);
    } else if (c.action === "deleteTask") root.children = root.children.filter(child => child.id !== c.id);
    else throw new Error("Esta acción requiere conexión.");
    if (root.children.length) {
      if (root.children.some(child => !child.completedAt)) root.completedAt = null;
      else if (!root.completedAt) root.completedAt = op.at;
    }
  }
  const removedIds = c.action === "deleteTask" ? [c.id] : [];
  const activities: ActivityView[] = [root, ...root.children.map(child => ({ ...child, children: [] }))];
  return { copy: mergeTaskRows(copy, [root], removedIds), result: { activities, removedIds, calendars: [], dataRevision: copy.dataRevision } };
}
export function projectTasks(base: LocalCopy, operations: LocalOperation[]) {
  return operations.reduce((value, op) => projectTask(value, op).copy, base);
}
export function rootFor(copy: LocalCopy, command: CoreCommand) {
  const id = command.action === "createTask" ? command.parentId ?? command.id : command.id;
  const row = taskRows(copy).get(id);
  return row?.parentId ?? id;
}
