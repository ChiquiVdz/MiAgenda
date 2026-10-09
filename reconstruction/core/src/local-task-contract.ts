import { parseCommand, uuid, type CoreCommand } from "./contracts.ts";
import { invalid } from "./errors.ts";

export type LocalOperation = { command: CoreCommand; rootId: string; at: string };
export type LocalGuard = { id: string; revision: number | null; children: { id: string; revision: number }[]; date?: string; occurrence?: { seriesId: string; ordinal: number; seriesRevision: number } };
export type LocalBatch = { commandId: string; operations: LocalOperation[]; guards: LocalGuard[] };

/** A deliberately narrow allowlist, shared by the durable queue and its API. */
export function localTaskCommand(command: CoreCommand) {
  if (command.scope && command.scope !== "this") return false;
  switch (command.action) {
    case "saveTask": return command.frequency === undefined;
    case "createTask": case "scheduleTask": case "unscheduleTask":
    case "editTask": case "addSubtasks": case "setCompleted": case "deleteTask": return true;
    default: return false;
  }
}
export function parseLocalBatch(raw: unknown): LocalBatch {
  if (!raw || typeof raw !== "object") invalid("Falta el lote local.");
  const value = raw as LocalBatch;
  uuid(value.commandId, "Lote");
  if (!Array.isArray(value.operations) || !value.operations.length || value.operations.length > 30 || !Array.isArray(value.guards) || value.guards.length > 30) invalid("Envía entre 1 y 30 cambios por lote.");
  const operations = value.operations.map(op => {
    const command = parseCommand(op.command);
    if (!localTaskCommand(command) || command.action === "setCompleted" && command.optionalStepIds !== undefined) invalid("Esta acción necesita conexión directa.");
    if (typeof op.at !== "string" || !Number.isFinite(Date.parse(op.at)) || new Date(op.at).toISOString() !== op.at) invalid("Fecha local inválida.");
    return { command, rootId: uuid(op.rootId, "Principal"), at: op.at };
  });
  const guards = value.guards.map(guard => {
    uuid(guard.id, "Principal");
    if (guard.revision !== null && (!Number.isSafeInteger(guard.revision) || guard.revision < 0) || !Array.isArray(guard.children) || guard.children.length > 500) invalid("Revisión local inválida.");
    for (const child of guard.children) { uuid(child.id, "Subtarea"); if (!Number.isSafeInteger(child.revision) || child.revision < 0) invalid("Revisión de subtarea inválida."); }
    const ref = guard.occurrence;
    if (guard.date !== undefined && (typeof guard.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(guard.date) || !Number.isFinite(Date.parse(guard.date)))) invalid("Fecha de instancia inválida.");
    if (ref) { uuid(ref.seriesId, "Serie"); if (!Number.isSafeInteger(ref.ordinal) || ref.ordinal < 0 || !Number.isSafeInteger(ref.seriesRevision) || ref.seriesRevision < 1 || guard.revision !== 0) invalid("Instancia local inválida."); }
    return { id: guard.id, revision: guard.revision, children: guard.children.map(child => ({ id: child.id, revision: child.revision })), ...(ref ? { occurrence: ref } : {}), ...(guard.date ? { date: guard.date } : {}) };
  });
  if (new Set(guards.map(g => g.id)).size !== guards.length || operations.some(op => !guards.some(g => g.id === op.rootId)) || guards.some(g => !operations.some(op => op.rootId === g.id))) invalid("Falta la revisión de una principal.");
  return { commandId: value.commandId, operations, guards };
}
