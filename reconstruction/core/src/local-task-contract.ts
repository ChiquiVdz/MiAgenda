import { dateOnly, parseCommand, uuid, type CoreCommand } from "./contracts.ts";
import { invalid } from "./errors.ts";

export type SeriesDeletion = { seriesId: string; fingerprint: string; fromDate: string | null };
export type SeriesChange = SeriesDeletion & { stepKeyId: string | null; anchorDate?: string; childIds?: Record<string, Record<string, string>> };
export type LocalOperation = { command: CoreCommand; rootId: string; at: string; seriesDeletion?: SeriesDeletion; seriesChange?: SeriesChange };
export type LocalGuard = { id: string; revision: number | null; children: { id: string; revision: number }[]; date?: string; occurrence?: { seriesId: string; ordinal: number; seriesRevision: number } };
export type LocalBatch = { commandId: string; operations: LocalOperation[]; guards: LocalGuard[] };

/** A deliberately narrow allowlist, shared by the durable queue and its API. */
export function localTaskCommand(command: CoreCommand) {
  if (command.scope && command.scope !== "this") return command.action === "stopRecurrence" || command.action === "setCompleted" && command.optionalStepIds === undefined || command.action === "deleteTask" || command.action === "addSubtasks" || command.action === "scheduleTask" || command.action === "unscheduleTask" || command.action === "editTask" && command.title !== undefined && command.description === undefined && command.position === undefined || command.action === "saveTask" && command.frequency === undefined || command.action === "createTask" && !!command.parentId && !command.schedule;
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
    const rootId = uuid(op.rootId, "Principal");
    let seriesDeletion: SeriesDeletion | undefined;
    let seriesChange: SeriesChange | undefined;
    if (op.seriesDeletion) {
      const ref = op.seriesDeletion;
      if (command.action !== "deleteTask" || command.id !== rootId || !command.scope || command.scope === "this" || typeof ref.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(ref.fingerprint)) invalid("Borrado de serie inválido.");
      if (command.scope === "all" ? ref.fromDate !== null : ref.fromDate === null) invalid("Falta el inicio del alcance.");
      seriesDeletion = { seriesId: uuid(ref.seriesId, "Serie"), fingerprint: ref.fingerprint, fromDate: ref.fromDate === null ? null : dateOnly(ref.fromDate) };
    }
    if(op.seriesChange){
      const ref=op.seriesChange;
      if(seriesDeletion || !command.scope || command.scope==="this" || typeof ref.fingerprint!=="string" || !/^[a-f0-9]{64}$/.test(ref.fingerprint))invalid("Cambio de serie inválido.");
      if(command.scope==="all" ? ref.fromDate!==null : ref.fromDate===null)invalid("Falta el inicio del alcance.");
      const stepKeyId=ref.stepKeyId===null?null:uuid(ref.stepKeyId,"Clave de subtarea");
      if(command.action==="stopRecurrence"&&command.seriesId!==ref.seriesId)invalid("La confirmación corresponde a otra serie.");
      if(command.action==="deleteTask"&&!stepKeyId || command.action==="addSubtasks"&&stepKeyId || command.action==="stopRecurrence"&&(stepKeyId||ref.fromDate!==command.effectiveDate) || command.action==="createTask"&&(stepKeyId||command.parentId!==rootId) || !["deleteTask","addSubtasks","createTask","editTask","saveTask","scheduleTask","unscheduleTask","setCompleted","stopRecurrence"].includes(command.action))invalid("Contenido de serie inválido.");
      if(command.action!=="createTask"&&command.action!=="addSubtasks"&&(stepKeyId===null)!==(command.id===rootId))invalid("Relación de subtarea inválida.");
      const scheduling=command.action==="scheduleTask"||command.action==="unscheduleTask"||command.action==="saveTask"&&command.schedule!==undefined;
      if(scheduling&&!ref.anchorDate)invalid("Falta la fecha base del horario recurrente.");
      const childIds:Record<string,Record<string,string>>={};
      const additions=command.action==="addSubtasks"?command.children:command.action==="createTask"?[command]:[];
      if(ref.childIds){
        if(Object.keys(ref.childIds).length>5000)invalid("Demasiadas instancias en el cambio local.");
        for(const [parent,children] of Object.entries(ref.childIds)){
          uuid(parent,"Principal");if(!children||typeof children!=="object"||Object.keys(children).length!==additions.length)invalid("Identidades de subtareas inválidas.");
          childIds[parent]={};
          for(const child of additions)childIds[parent][child.id]=uuid(children[child.id],"Subtarea");
        }
      }
      seriesChange={seriesId:uuid(ref.seriesId,"Serie"),fingerprint:ref.fingerprint,fromDate:ref.fromDate===null?null:dateOnly(ref.fromDate),stepKeyId,...(ref.anchorDate?{anchorDate:dateOnly(ref.anchorDate)}:{}),...(additions.length?{childIds}:{})};
    }
    if (command.scope && command.scope !== "this" && !seriesDeletion && !seriesChange) invalid("Falta la revisión completa de la serie.");
    return { command, rootId, at: op.at, ...(seriesDeletion ? { seriesDeletion } : {}),...(seriesChange?{seriesChange}:{}) };
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
  if (operations.some(op => op.seriesDeletion||op.seriesChange) && operations.length !== 1) invalid("Envía cada cambio de serie en su propio lote.");
  return { commandId: value.commandId, operations, guards };
}
