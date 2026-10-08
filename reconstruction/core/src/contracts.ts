import { invalid } from "./errors.ts";
import { parseRecurrence, type RecurrenceRule } from "./recurrence.ts";
import { localParts } from "./local-time.ts";
export type OccurrenceRef = { seriesId: string; ordinal: number; seriesRevision: number };

export type ScheduleInput = {
  calendarId: string; timeZone: string;
} & ({ mode: "timed"; startsAt: string; endsAt: string } |
  { mode: "allDay"; startDate: string; endDate: string });

type Target = { id: string; expectedRevision: number };
export type SeriesScope = "this" | "following" | "all";
export type CoreCommand = { commandId: string; occurrence?: OccurrenceRef; scope?: SeriesScope; expectedSeriesRevision?: number } & (
  { action: "createRecurringTask"; id: string; title: string; description: string | null; schedule: ScheduleInput; rule: RecurrenceRule } |
  { action: "createTask"; id: string; title: string; description: string | null;
    position: number; parentId: string | null; expectedParentRevision: number | null; schedule?: ScheduleInput } |
  ({ action: "editTask"; title?: string; description?: string | null; position?: number } & Target) |
  ({ action: "addSubtasks"; children: { id: string; title: string }[] } & Target) |
  ({ action: "saveTask"; title?: string; schedule?: ScheduleInput | null; frequency?: { seriesId: string; ordinal: number; rule: RecurrenceRule; expectedDataRevision: string } } & Target) |
  ({ action: "changeRecurrence"; seriesId: string; ordinal: number; rule: RecurrenceRule; expectedDataRevision: string } & Target) |
  ({ action: "setCompleted"; completed: boolean; optionalStepIds?: string[] } & Target) |
  ({ action: "setFlags"; keep?: boolean; highlighted?: boolean } & Target) |
  ({ action: "scheduleTask"; schedule: ScheduleInput } & Target) |
  ({ action: "unscheduleTask" } & Target) |
  ({ action: "deleteTask" } & Target) |
  { action: "createCalendar"; id: string; name: string; color: string } |
  ({ action: "editCalendar"; name: string; color: string } & Target) |
  ({ action: "deleteCalendar"; expectedDataRevision: string; destinationId: string | null } & Target) |
  ({ action: "setCalendarVisible"; visible: boolean } & Target)
);

export function uuid(value: unknown, label = "id"): string {
  if (typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    invalid(`${label} debe ser un UUID válido.`);
  }
  return value.toLowerCase();
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Se esperaba un objeto.");
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid("Hay campos no admitidos.");
}
function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    invalid(`${label} es obligatorio y admite hasta ${max} caracteres.`);
  }
  return value.trim();
}
function description(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 10000) invalid("Descripción inválida (máximo 10000 caracteres).");
  return value.trim() || null;
}
export function revision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2147483647) {
    invalid("La revisión debe ser un entero no negativo.");
  }
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") invalid("Se esperaba verdadero o falso.");
  return value;
}
export function dateOnly(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < "0001-01-01" || value > "9999-12-31") invalid("Fecha inválida; usa AAAA-MM-DD.");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid("La fecha no existe.");
  return value;
}
export function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value)) {
    invalid("El horario debe incluir fecha, hora y zona/offset explícito.");
  }
  dateOnly(value.slice(0, 10));
  if (+value.slice(11, 13) > 23 || +value.slice(14, 16) > 59 || +value.slice(17, 19) > 59) {
    invalid("La hora no existe.");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid("Horario inválido.");
  const normalized = parsed.toISOString();
  if (!/^\d{4}-/.test(normalized) || normalized.startsWith("0000-")) invalid("El horario UTC está fuera del rango permitido.");
  return normalized;
}
export function timeZone(value: unknown): string {
  const zone = text(value, 64, "Zona horaria");
  if (!/^(UTC|GMT|[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+)$/.test(zone)) invalid("Usa una zona IANA, como America/Mexico_City.");
  try { new Intl.DateTimeFormat("es", { timeZone: zone }); } catch { invalid("Zona horaria inválida."); }
  return zone;
}
export function parseSchedule(value: unknown): ScheduleInput {
  const input = object(value);
  const common = { calendarId: uuid(input.calendarId, "calendarId"), timeZone: timeZone(input.timeZone) };
  if (input.mode === "timed") {
    fields(input, ["calendarId", "timeZone", "mode", "startsAt", "endsAt"]);
    const startsAt = instant(input.startsAt), endsAt = instant(input.endsAt);
    if (startsAt >= endsAt) invalid("El fin debe ser posterior al inicio.");
    return { ...common, mode: "timed", startsAt, endsAt };
  }
  if (input.mode === "allDay") {
    fields(input, ["calendarId", "timeZone", "mode", "startDate", "endDate"]);
    const startDate = dateOnly(input.startDate), endDate = dateOnly(input.endDate);
    if (startDate >= endDate) invalid("El fin exclusivo debe ser posterior al inicio.");
    return { ...common, mode: "allDay", startDate, endDate };
  }
  return invalid("Modo de programación desconocido.");
}

/** Normalize BEFORE hashing. The owner never comes from this payload. */
export function parseCommand(value: unknown): CoreCommand {
  const input = object(value), { occurrence, scope, expectedSeriesRevision, ...rest } = input;
  let command = parseCommandBody(rest);
  if(command.action === "setCompleted" && command.optionalStepIds !== undefined && (occurrence !== undefined || scope !== undefined)) invalid("Los opcionales de comida no admiten alcances recurrentes.");
  if (scope !== undefined) {
    if (!["this", "following", "all"].includes(String(scope)) || !["createTask", "addSubtasks", "editTask", "saveTask", "setCompleted", "deleteTask", "scheduleTask", "unscheduleTask", "changeRecurrence"].includes(command.action)) invalid("Alcance no admitido para esta acción.");
    command = { ...command, scope: scope as SeriesScope };
  }
  if (scope && scope !== "this") command = { ...command, expectedSeriesRevision: revision(expectedSeriesRevision) };
  else if (expectedSeriesRevision !== undefined) invalid("La revisión de serie solo corresponde a un alcance de serie.");
  if (command.action === "changeRecurrence" && scope !== "following" && scope !== "all") invalid("Cambiar frecuencia requiere esta y siguientes o toda la serie.");
  if (command.action === "saveTask" && command.frequency && scope !== "following" && scope !== "all") invalid("Cambiar frecuencia requiere esta y siguientes o toda la serie.");
  if (occurrence === undefined) return command;
  if (!["editTask", "addSubtasks", "saveTask", "setCompleted", "setFlags", "scheduleTask", "unscheduleTask", "deleteTask", "createTask", "changeRecurrence"].includes(command.action)) invalid("No se admite referencia de ocurrencia en este comando.");
  const ref = object(occurrence); fields(ref, ["seriesId", "ordinal", "seriesRevision"]);
  return { ...command, occurrence: { seriesId: uuid(ref.seriesId), ordinal: revision(ref.ordinal), seriesRevision: revision(ref.seriesRevision) } };
}
function parseCommandBody(value: unknown): CoreCommand {
  const input = object(value);
  const commandId = uuid(input.commandId, "commandId");
  const action = input.action;
  const base = ["commandId", "action", "id"];
  if (action === "createRecurringTask") {
    fields(input, [...base, "title", "description", "schedule", "rule"]);
    const schedule = parseSchedule(input.schedule);
    const anchor = schedule.mode === "allDay" ? schedule.startDate : localParts(schedule.startsAt, schedule.timeZone).date;
    return { commandId, action, id: uuid(input.id), title: text(input.title, 250, "Nombre"), description: description(input.description), schedule, rule: parseRecurrence(input.rule, anchor) };
  }
  if (action === "createTask") {
    fields(input, [...base, "title", "description", "position", "parentId", "expectedParentRevision", "schedule"]);
    const parentId = input.parentId == null ? null : uuid(input.parentId, "parentId");
    if (!parentId && input.expectedParentRevision != null) invalid("Sin padre no se admite su revisión.");
    return { commandId, action, id: uuid(input.id), title: text(input.title, 250, "Nombre"),
      description: description(input.description), position: revision(input.position ?? 0), parentId,
      expectedParentRevision: parentId ? revision(input.expectedParentRevision) : null,
      ...("schedule" in input ? { schedule: parseSchedule(input.schedule) } : {}) };
  }
  if (action === "createCalendar") {
    fields(input, [...base, "name", "color"]);
    if (typeof input.color !== "string" || !/^#[0-9a-f]{6}$/i.test(input.color)) invalid("Color inválido.");
    return { commandId, action, id: uuid(input.id), name: text(input.name, 120, "Nombre"), color: input.color.toLowerCase() };
  }
  const target = { commandId, id: uuid(input.id), expectedRevision: revision(input.expectedRevision) };
  switch (action) {
    case "addSubtasks": {
      fields(input, [...base, "expectedRevision", "children"]);
      if (!Array.isArray(input.children) || !input.children.length || input.children.length > 50) invalid("Agrega entre 1 y 50 subtareas por guardado.");
      const children = input.children.map(raw => { const child = object(raw); fields(child, ["id", "title"]); return { id: uuid(child.id), title: text(child.title, 250, "Subtarea") }; });
      if (new Set(children.map(child => child.id)).size !== children.length) invalid("Las subtareas deben tener identificadores distintos.");
      return { ...target, action, children };
    }
    case "saveTask": {
      fields(input, [...base, "expectedRevision", "title", "schedule", "frequency"]);
      if (!["title", "schedule", "frequency"].some(key => key in input)) invalid("No hay cambios.");
      let frequency;
      if (input.frequency !== undefined) {
        const value = object(input.frequency); fields(value, ["seriesId", "ordinal", "rule", "expectedDataRevision"]);
        if (typeof value.expectedDataRevision !== "string" || !/^\d{1,20}$/.test(value.expectedDataRevision)) invalid("Revisión de datos inválida.");
        frequency = { seriesId: uuid(value.seriesId), ordinal: revision(value.ordinal), rule: parseRecurrence(value.rule, "0001-01-01"), expectedDataRevision: value.expectedDataRevision };
      }
      if (input.schedule === null && frequency) invalid("Una serie necesita horario.");
      return { ...target, action, ...("title" in input ? { title: text(input.title, 250, "Nombre") } : {}), ...("schedule" in input ? { schedule: input.schedule === null ? null : parseSchedule(input.schedule) } : {}), ...(frequency ? { frequency } : {}) };
    }
    case "changeRecurrence":
      fields(input, [...base, "expectedRevision", "seriesId", "ordinal", "rule", "expectedDataRevision"]);
      if (typeof input.expectedDataRevision !== "string" || !/^\d{1,20}$/.test(input.expectedDataRevision)) invalid("Revisión de datos inválida.");
      // The authoritative anchor is validated again inside the transaction.
      return { ...target, action, seriesId: uuid(input.seriesId), ordinal: revision(input.ordinal), rule: parseRecurrence(input.rule, "0001-01-01"), expectedDataRevision: input.expectedDataRevision };
    case "editCalendar":
      fields(input, [...base, "expectedRevision", "name", "color"]);
      if (typeof input.color !== "string" || !/^#[0-9a-f]{6}$/i.test(input.color)) invalid("Color inválido.");
      return { ...target, action, name: text(input.name, 120, "Nombre"), color: input.color.toLowerCase() };
    case "deleteCalendar":
      fields(input, [...base, "expectedRevision", "expectedDataRevision", "destinationId"]);
      if (typeof input.expectedDataRevision !== "string" || !/^\d{1,20}$/.test(input.expectedDataRevision)) invalid("Revisión de datos inválida.");
      return { ...target, action, expectedDataRevision: input.expectedDataRevision,
        destinationId: input.destinationId == null ? null : uuid(input.destinationId, "destinationId") };
    case "setCalendarVisible":
      fields(input, [...base, "expectedRevision", "visible"]);
      return { ...target, action, visible: bool(input.visible) };
    case "editTask": {
      fields(input, [...base, "expectedRevision", "title", "description", "position"]);
      if (!["title", "description", "position"].some(key => key in input)) invalid("No hay cambios.");
      return { ...target, action,
        ...("title" in input ? { title: text(input.title, 250, "Nombre") } : {}),
        ...("description" in input ? { description: description(input.description) } : {}),
        ...("position" in input ? { position: revision(input.position) } : {}) };
    }
    case "setCompleted":
      fields(input, [...base, "expectedRevision", "completed", "optionalStepIds"]);
      if (input.optionalStepIds !== undefined && (!Array.isArray(input.optionalStepIds) || input.optionalStepIds.length > 600)) invalid("Opcionales inválidos.");
      return { ...target, action, completed: bool(input.completed), ...(input.optionalStepIds !== undefined ? { optionalStepIds: [...new Set((input.optionalStepIds as unknown[]).map(id => uuid(id)))].sort() } : {}) };
    case "setFlags":
      fields(input, [...base, "expectedRevision", "keep", "highlighted"]);
      if (!("keep" in input) && !("highlighted" in input)) invalid("No hay cambios.");
      return { ...target, action,
        ...("keep" in input ? { keep: bool(input.keep) } : {}),
        ...("highlighted" in input ? { highlighted: bool(input.highlighted) } : {}) };
    case "scheduleTask":
      fields(input, [...base, "expectedRevision", "schedule"]);
      return { ...target, action, schedule: parseSchedule(input.schedule) };
    case "unscheduleTask":
    case "deleteTask":
      fields(input, [...base, "expectedRevision"]);
      return { ...target, action };
    default: return invalid("Comando desconocido.");
  }
}
