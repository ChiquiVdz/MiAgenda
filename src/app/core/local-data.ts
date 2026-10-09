"use client";

import { useSyncExternalStore } from "react";
import { signOut as authSignOut } from "next-auth/react";
import type { LocalCopy } from "./local-contract";
import { atTime, plusDays } from "./dates";
import { localMutation } from "./local-mutation";
import type { CommandResult } from "../../../reconstruction/core/src/views";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import { parseCommand, parseSchedule, type CoreCommand, type ScheduleInput } from "../../../reconstruction/core/src/contracts";
import { localTaskCommand, type LocalOperation, type LocalBatch } from "../../../reconstruction/core/src/local-task-contract";
import { mergeTaskRows, projectTask, projectTasks, rootFor, taskGuard, taskRows } from "./local-tasks";

const DB = "miagenda-local-v1", STORE = "account";
export const localEvent = "miagenda:local-copy";
let copy: LocalCopy | null = null;
let sync: Promise<LocalCopy> | null = null;
let epoch = 0, writes = 0, dirty = false;
let extra = new Map<string, unknown>();
let base: LocalCopy | null = null, outbox: LocalOperation[] = [], batch: LocalBatch | null = null;
type Conflict = { rootId: string; item: ActivityView | null; missingCalendarId?: string };
type LocalDraft = CoreCommand extends infer C ? C extends { commandId: string } ? Omit<C, "commandId"> : never : never;
let state = { online: true, busy: false, message: "", newer: false, ready: false, range: "", shellReady: false, pending: 0, pendingIds: [] as string[], conflict: null as Conflict | null, accountBlocked: false, reauth: false };
const listeners = new Set<() => void>();
function publish(update: Partial<typeof state>) { state = { ...state, ...update }; listeners.forEach(fn => fn()); }
export function useLocalStatus() { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state, () => state); }
export function currentCopy() { return copy; }
export function localMode() { return typeof window !== "undefined" && isLocalPath(window.location.pathname); }
export function isLocalPath(path: string) { return ["/", "/local", "/inbox", "/agenda", "/hoy", "/cocina", "/cocina/inicio", "/cocina/recetas", "/cocina/planificar", "/cocina/compras"].includes(path); }
export function setLocalOnline(online: boolean) { publish({ online }); }
export function setShellReady(shellReady: boolean) { publish({ shellReady }); }
export function pendingTask(id: string) { return state.pendingIds.includes(id); }
function pendingState() { publish({ pending: outbox.length, pendingIds: [...new Set(outbox.flatMap(op => [op.rootId, op.command.id, ...(op.command.action === "addSubtasks" ? op.command.children.map(child => child.id) : [])]))] }); }
type SavedRecord = { copy: LocalCopy; extra: [string, unknown][]; base?: LocalCopy; outbox?: LocalOperation[]; batch?: LocalBatch | null; conflict?: Conflict | null };

// Coordinate durable writes across tabs as well as within this page.
async function exclusive<T>(work: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error("Este navegador no permite guardar cambios seguros sin conexión. Actualízalo antes de continuar.");
  return navigator.locks.request("miagenda:private-copy", work);
}
function changed() { window.dispatchEvent(new CustomEvent(localEvent, { detail: { remount: false } })); window.dispatchEvent(new Event("miagenda:local-range")); }
async function commitTasks(nextBase: LocalCopy, nextOps: LocalOperation[], nextBatch: LocalBatch | null, nextConflict: Conflict | null = state.conflict) {
  const next = projectTasks(nextBase, nextOps);
  await record({ copy: next, base: nextBase, extra: [...extra], outbox: nextOps, batch: nextBatch, conflict: nextConflict });
  base = nextBase; copy = next; outbox = nextOps; batch = nextBatch;
  publish({ conflict: nextConflict }); pendingState(); changed();
  return next;
}

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    // Version fence: old read-only clients must not overwrite a durable outbox.
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(new Error("No pudimos abrir el almacenamiento del dispositivo."));
  });
}
async function record(value?: SavedRecord | null) {
  const db = await database();
  try {
    return await new Promise<SavedRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, value === undefined ? "readonly" : "readwrite"), store = tx.objectStore(STORE);
      let result: SavedRecord | undefined;
      if (value === undefined) { const request = store.get("active"); request.onsuccess = () => { result = request.result; }; }
      else if (value === null) store.clear();
      else store.put({ base: outbox.length ? base : value.copy, outbox, batch, conflict: state.conflict, ...value }, "active");
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => reject(new Error("No pudimos guardar la copia local. Revisa el espacio disponible."));
    });
  } finally { db.close(); }
}
export async function restoreLocalCopy() {
  const version = epoch;
  let saved;
  try { saved = await record(); }
  catch (cause) { publish({ message: "No pudimos abrir el almacenamiento local. Revisa que este navegador permita guardar datos del sitio." }); throw cause; }
  if (version !== epoch) return copy;
  if (saved?.copy.format === 1) {
    copy = saved.copy; base = saved.base ?? saved.copy; outbox = saved.outbox ?? []; batch = saved.batch ?? null; extra = new Map(saved.extra ?? []);
    if (!saved.base) for (const value of extra.values()) if (value && typeof value === "object" && "items" in value && Array.isArray(value.items)) base = mergeTaskRows(base, value.items);
    if (!saved.base) copy = base;
    publish({ ready: true, conflict: saved.conflict ?? null }); pendingState();
  }
  return copy;
}
export async function clearLocalCopy() {
  return exclusive(clearLocalRecord);
}
export async function prepareLocalSignIn() {
  return exclusive(async () => {
    await restoreLocalCopy();
    if (outbox.length) return false; // Re-authenticate the SAME owner without erasing unsent work.
    await clearLocalRecord();
    return true;
  });
}
async function clearLocalRecord() {
  await restoreLocalCopy();
  if (outbox.length) throw new Error("Hay cambios sin enviar. Sincronízalos o descártalos expresamente antes de cerrar sesión.");
  epoch++; copy = null; base = null; batch = null; extra.clear(); dirty = false;
  publish({ ready: false, newer: false, range: "", message: "", pending: 0, pendingIds: [], conflict: null });
  await record(null);
  window.dispatchEvent(new Event(localEvent));
}
export async function signOut(options: Parameters<typeof authSignOut>[0]) {
  if (outbox.length) { publish({ message: "Hay cambios sin enviar. Pulsa Actualizar antes de cerrar sesión, o usa Descartar cambios locales en Info." }); return; }
  if (!navigator.onLine) { publish({ message: "Conéctate para cerrar también tu sesión en el servidor." }); return; }
  try { await clearLocalCopy(); }
  catch (cause) { publish({ message: cause instanceof Error ? cause.message : "No pudimos cerrar sesión." }); return; }
  // Other tabs discard the account as well. No credentials go into local storage.
  localStorage.setItem("miagenda:logout", String(Date.now()));
  await authSignOut(options);
}

export async function refreshLocalCopy(remount = true, lockHeld = false): Promise<LocalCopy> {
  if (outbox.length) await synchronizeLocalTasks();
  if (sync) return sync;
  if (!navigator.onLine) throw new Error("Sin conexión. Puedes consultar lo descargado; actualizar necesita internet.");
  if (remount && writes) throw new Error("Espera a que termine el guardado antes de actualizar.");
  const version = epoch;
  publish({ busy: true, message: "" });
  const download = async () => {
    await restoreLocalCopy();
    if (outbox.length) throw new Error("Hay cambios pendientes de otra pestaña. Pulsa Actualizar de nuevo para enviarlos.");
    // Local reads never purge. Explicit updates may ask the server for one short
    // retention batch; the production cron is responsible for unattended work.
    if (remount) await fetch("/api/core/retention", { method: "POST" }).catch(() => null);
    const response = await fetch("/api/core/local", { cache: "no-store" });
    const result = await response.json();
    if (response.status === 401) { await clearLocalRecord(); window.location.assign("/login"); }
    if (!response.ok) throw new Error(result.message ?? "No pudimos actualizar la copia.");
    const next = result as LocalCopy;
    if (next.format !== 1 || !next.ownerId || !next.inbox || !next.planners) throw new Error("La copia recibida no es válida.");
    if (version !== epoch) throw new Error("La sesión cambió. Vuelve a entrar.");
    if (copy && next.ownerId !== copy.ownerId) { await clearLocalRecord(); window.location.assign("/login"); throw new Error("La cuenta cambió. Vuelve a entrar."); }
    // Commit to IndexedDB before claiming offline readiness. Keep old copy on failure.
    await record({ copy: next, extra: [] });
    if (version !== epoch) { await record(null); throw new Error("La sesión cambió."); }
    copy = next; base = next; extra.clear(); dirty = false;
    publish({ ready: true, newer: false, range: "" });
    window.dispatchEvent(new CustomEvent(localEvent, { detail: { remount } }));
    return next;
  };
  const pending = lockHeld ? download() : exclusive(download);
  sync = pending;
  try { return await pending; }
  catch (cause) { publish({ message: cause instanceof Error ? cause.message : "No pudimos actualizar. La copia anterior se conserva." }); throw cause; }
  finally { if (sync === pending) sync = null; publish({ busy: false }); }
}

/** One check on entry; no polling, focus reads or background reconnection downloads. */
export async function checkLocalChanges() {
  if (!navigator.onLine || !copy || sync || writes) return;
  const version = epoch;
  try {
    const response = await fetch("/api/core/local?check=1", { cache: "no-store" });
    const result = await response.json();
    if (version !== epoch) return;
    if (response.status === 401 && outbox.length) { publish({ reauth: true, message: "Inicia sesión con la misma cuenta para enviar los cambios. Se conservan en este dispositivo." }); return; }
    if (response.status === 401) { await clearLocalCopy(); window.location.assign("/login"); return; }
    if (!response.ok) throw new Error("No pudimos comprobar si hay novedades. Puedes seguir con la copia local.");
    if (result.ownerId !== copy?.ownerId && outbox.length) { publish({ accountBlocked: true, message: "La sesión pertenece a otra cuenta. Entra con la cuenta original para conservar y enviar tus cambios." }); return; }
    if (result.ownerId !== copy?.ownerId) { await clearLocalCopy(); await refreshLocalCopy(); return; }
    publish({ accountBlocked: false, reauth: false, newer: result.dataRevision !== copy?.dataRevision || dirty });
  } catch (cause) { publish({ message: cause instanceof Error ? cause.message : "No pudimos comprobar novedades." }); }
}

async function enqueueTask(raw: unknown): Promise<Response> {
  return exclusive(async () => {
    await restoreLocalCopy(); // A different tab may have appended or acknowledged changes.
    if (!copy || !base) throw new Error("Primero descarga tu copia.");
    if (state.accountBlocked) throw new Error("Entra con la cuenta original antes de modificar esta copia.");
    if (dirty) throw new Error("Primero actualiza la copia para recuperar el último cambio confirmado.");
    if (state.busy || sync || writes) throw new Error("Espera a que termine la operación actual.");
    const command = parseCommand(raw);
    const previous = outbox.find(op => op.command.commandId === command.commandId);
    if (previous) {
      if (JSON.stringify(previous.command) !== JSON.stringify(command)) throw new Error("Este intento ya contiene otro cambio.");
      const root = taskRows(copy).get(previous.rootId);
      return Response.json({ activities: root ? [root, ...root.children.map(c => ({ ...c, children: [] }))] : [], removedIds: command.action === "deleteTask" ? [command.id] : [], calendars: [], dataRevision: copy.dataRevision, localPending: true });
    }
    if (outbox.length >= 500) throw new Error("Tienes 500 cambios pendientes. Sincroniza antes de agregar más.");
    const operation: LocalOperation = { command, rootId: rootFor(copy, command), at: new Date().toISOString() };
    const projected = projectTask(copy, operation);
    if ((taskRows(projected.copy).get(operation.rootId)?.children.length ?? 0) > 500) throw new Error("Esta tarea tiene demasiadas subtareas para editarla sin conexión.");
    await commitTasks(base, [...outbox, operation], batch);
    return Response.json({ ...projected.result, localPending: true });
  });
}

/** The frozen payload is persisted BEFORE sending. Unknown outcomes retry it byte-for-byte. */
export async function synchronizeLocalTasks() {
  return exclusive(async () => {
    await restoreLocalCopy();
    if (!copy || !base || !outbox.length) return;
    if (!navigator.onLine) throw new Error("Conéctate para enviar los cambios. Siguen guardados aquí.");
    if (sync || writes) throw new Error("Espera a que termine la operación actual.");
    if (state.conflict) throw new Error("Primero elige qué hacer con la tarea en conflicto.");
    publish({ busy: true, message: "" });
    try {
      while (outbox.length) {
        if (!batch) {
          const operations = outbox.slice(0, 30), commandId = crypto.randomUUID();
          let draft: LocalBatch;
          do {
            draft = { commandId, operations: [...operations], guards: [...new Set(operations.map(op => op.rootId))].map(id => taskGuard(base!, id)) };
            if (new TextEncoder().encode(JSON.stringify(draft)).byteLength <= 60000) break;
            operations.pop();
          } while (operations.length);
          if (!operations.length) throw new Error("Un cambio supera el tamaño permitido. Conservamos la cola; revisa el contenido antes de enviarlo.");
          await commitTasks(base, outbox, draft);
        }
        const sent = batch!;
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 55000);
        let response: Response;
        try { response = await fetch("/api/core/local/sync", { method: "POST", headers: { "Content-Type": "application/json", "X-MiAgenda-Owner": copy.ownerId }, body: JSON.stringify(sent), signal: controller.signal }); }
        finally { clearTimeout(timer); }
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 401) publish({ reauth: true });
          if (result.error === "ACCOUNT_CHANGED") publish({ accountBlocked: true });
          if (response.status === 409 && result.error === "LOCAL_CONFLICT") await commitTasks(base, outbox, null, { rootId: result.rootId, item: result.item, missingCalendarId: result.missingCalendarId });
          else if (response.status === 400) await commitTasks(base, outbox, null); // Definitively rejected before a commit; safe to discard later.
          throw new Error(result.message ?? "No pudimos confirmar el envío. Reintenta Actualizar.");
        }
        if (!Array.isArray(result.activities) || !Array.isArray(result.removedIds) || typeof result.dataRevision !== "string") throw new Error("Respuesta incierta. Reintenta Actualizar con el mismo lote.");
        const ids = new Set(sent.operations.map(op => op.command.commandId));
        const nextBase = mergeTaskRows(base, result.activities, result.removedIds);
        // Other-device changes are NOT downloaded implicitly. Keep the snapshot's revision
        // unless the server confirmed we started with exactly this complete snapshot.
        if (result.baseDataRevision === base.dataRevision) {
          nextBase.dataRevision = result.dataRevision;
          nextBase.inbox = { ...nextBase.inbox, dataRevision: result.dataRevision };
          nextBase.agenda = { ...nextBase.agenda, dataRevision: result.dataRevision };
          nextBase.highlighted = { ...nextBase.highlighted, dataRevision: result.dataRevision };
          nextBase.pantry = { ...nextBase.pantry, dataRevision: result.dataRevision };
          nextBase.recipes = { ...nextBase.recipes, dataRevision: result.dataRevision };
          nextBase.shopping = { ...nextBase.shopping, dataRevision: result.dataRevision };
          nextBase.planners = nextBase.planners.map(item => ({ ...item, dataRevision: result.dataRevision }));
        } else publish({ newer: true });
        await commitTasks(nextBase, outbox.filter(op => !ids.has(op.command.commandId)), null, null);
      }
      publish({ reauth: false, message: "Cambios enviados. Preparando la actualización de tu copia." });
    } catch (cause) {
      publish({ message: cause instanceof Error ? cause.message : "No pudimos enviar. Conservamos los cambios en este dispositivo." });
      throw cause;
    } finally { publish({ busy: false }); }
  });
}

export async function discardLocalTasks() {
  if (!window.confirm("¿Descartar todos los cambios sin enviar de este dispositivo? Esta acción no se puede deshacer.")) return;
  await exclusive(async () => {
    await restoreLocalCopy();
    if (batch) throw new Error("Hay un envío sin confirmar. Reintenta Actualizar antes de descartar, para saber qué recibió el servidor.");
    if (base) await commitTasks(base, [], null, null);
  });
}

/** Only the user's explicit conflict choice can replace the old aggregate fence. */
export async function resolveLocalConflict(choice: "mine" | "server", replacementCalendarId?: string) {
  return exclusive(async () => {
    await restoreLocalCopy();
    const conflict = state.conflict;
    if (!base || !copy || !conflict) return;
    const desired = taskRows(copy).get(conflict.rootId);
    const schedulingIds = new Set(outbox.filter(op => op.rootId === conflict.rootId && (op.command.action === "scheduleTask" || op.command.action === "unscheduleTask" || "schedule" in op.command && op.command.schedule !== undefined)).map(op => op.command.id));
    if (choice === "mine" && conflict.missingCalendarId && (!replacementCalendarId || replacementCalendarId === conflict.missingCalendarId || !base.calendars.some(c=>c.id===replacementCalendarId))) throw new Error("Elige otro calendario descargado para conservar tu horario.");
    const old = taskRows(base).get(conflict.rootId);
    const nextBase = mergeTaskRows(base, conflict.item ? [conflict.item] : [], conflict.item ? [] : [conflict.rootId, ...(old?.children.map(c => c.id) ?? [])]);
    // Other roots may still reference this stale calendar in their queued commands.
    // Keep it in the base until download; resolve each affected root explicitly.
    let remaining = outbox.filter(op => op.rootId !== conflict.rootId);
    if (choice === "mine" && desired) {
      const server = conflict.item, rootId = server?.id ?? crypto.randomUUID(), now = new Date().toISOString();
      const additions: LocalOperation[] = [];
      const append = (command: LocalDraft, at = now) => additions.push({ command: { ...command, commandId: crypto.randomUUID() } as CoreCommand, rootId, at });
      const restoreSchedule = (item: ActivityView | ActivityView["children"][number], id: string, revision: number) => {
        if (!schedulingIds.has(item.id)) return;
        let schedule: ScheduleInput | null = item.schedule ? parseSchedule(item.schedule.mode === "timed" ? {calendarId:item.schedule.calendarId,timeZone:item.schedule.timeZone,mode:"timed",startsAt:item.schedule.startsAt,endsAt:item.schedule.endsAt} : {calendarId:item.schedule.calendarId,timeZone:item.schedule.timeZone,mode:"allDay",startDate:item.schedule.startDate,endDate:item.schedule.endDate}) : null;
        if (schedule && schedule.calendarId === conflict.missingCalendarId) schedule = {...schedule,calendarId:replacementCalendarId!};
        append(schedule ? {action:"scheduleTask",id,expectedRevision:revision,schedule} : {action:"unscheduleTask",id,expectedRevision:revision});
      };
      if (!server) append({ action: "createTask", id: rootId, title: desired.title, description: desired.description, position: desired.position, parentId: null, expectedParentRevision: null });
      else append({ action: "editTask", id: rootId, expectedRevision: server.revision, title: desired.title, description: desired.description });
      if (server || conflict.missingCalendarId) restoreSchedule(desired,rootId,server?.revision??1);
      for (const child of desired.children) {
        const match = server?.children.find(item => item.id === child.id), id = match?.id ?? crypto.randomUUID();
        if (!match) append({ action: "createTask", id, title: child.title, description: child.description, position: child.position, parentId: rootId, expectedParentRevision: server?.revision ?? 1 });
        else append({ action: "editTask", id, expectedRevision: match.revision, title: child.title, description: child.description, position: child.position });
        if (server || conflict.missingCalendarId) restoreSchedule(child,id,match?.revision??1);
        append({ action: "setCompleted", id, expectedRevision: match?.revision ?? 1, completed: !!child.completedAt }, child.completedAt ?? now);
      }
      for (const child of server?.children ?? []) if (!desired.children.some(item => item.id === child.id)) append({ action: "deleteTask", id: child.id, expectedRevision: child.revision });
      if (!desired.children.length || desired.completedAt) append({ action: "setCompleted", id: rootId, expectedRevision: server?.revision ?? 1, completed: !!desired.completedAt }, desired.completedAt ?? now);
      remaining = [...remaining, ...additions];
    }
    await commitTasks(nextBase, remaining, null, null);
    publish({ newer: true, message: choice === "server" ? "Usamos la versión del servidor para esta tarea." : conflict.item ? "Conservamos tus cambios. Pulsa Actualizar para enviarlos." : "Recuperamos tu tarea en Inbox. Pulsa Actualizar para guardarla en el servidor." });
  });
}

function key(params: URLSearchParams) { const sorted = new URLSearchParams(params); sorted.sort(); return sorted.toString(); }
export function plannerCopy(start: string, days: number) {
  if (!copy || start < copy.start || plusDays(start, days) > copy.end) return null;
  const base = copy.planners[0];
  const meals = copy.planners.flatMap(item => item.meals).filter(item => item.date >= start && item.date < plusDays(start, days));
  return { ...base, start, days, meals };
}
function cached(params: URLSearchParams): unknown | undefined {
  if (!copy) return undefined;
  const exact = extra.get(key(params));
  if (exact && params.get("view") !== "agenda" && typeof exact === "object" && "items" in exact && Array.isArray(exact.items)) {
    const rows = taskRows(copy);
    return { ...exact, dataRevision: copy.dataRevision, items: (exact.items as ActivityView[]).filter(item => rows.has(item.id)).map(item => rows.get(item.id)!).filter(item => !outbox.some(op => op.command.action === "deleteTask" && op.command.id === item.id)) };
  }
  if (exact && params.get("view") !== "agenda") return exact;
  const view = params.get("view");
  if (view === "inbox") return copy.inbox;
  if (view === "calendars") return { items: copy.calendars, dataRevision: copy.dataRevision };
  if (view === "pantry") return copy.pantry;
  if (view === "recipes") return copy.recipes;
  if (view === "shopping") return copy.shopping;
  if (view === "planner") return plannerCopy(params.get("start") ?? "", Number(params.get("days") ?? 7)) ?? undefined;
  if (view === "detail") {
    const all = [...copy.inbox.items, ...copy.agenda.items, ...copy.highlighted.items].flatMap(item => [item, ...item.children]);
    const item = all.find(item => item.id === params.get("id"));
    if (item) return { item, parent: all.find(parent => parent.id === item.parentId) ?? null, dataRevision: copy.dataRevision };
  }
  if (view === "mealCell") {
    const date = params.get("date") ?? "";
    if (date >= copy.start && date < copy.end) return { meal: copy.planners.flatMap(item => item.meals).find(item => item.date === date && item.slotId === params.get("slotId")) ?? null };
  }
  if (view === "agenda") {
    const start = params.get("startDate") ?? "", end = params.get("endDate") ?? "", highlighted = params.get("highlightedOnly") === "true";
    const year = copy.today.slice(0, 4);
    if (!exact && (highlighted ? start < `${year}-01-01` || end > `${Number(year) + 1}-01-01` : start < copy.start || end > copy.end)) return undefined;
    const ids = params.has("calendarIds") ? params.get("calendarIds")!.split(",") : copy.calendars.filter(item => item.visible).map(item => item.id);
    const startsAt = params.get("startsAt") ?? atTime(start), endsAt = params.get("endsAt") ?? atTime(end);
    return { dataRevision: copy.dataRevision, nextAfterId: null, items: (highlighted ? copy.highlighted : copy.agenda).items.filter(item => item.schedule && ids.includes(item.schedule.calendarId) &&
      (item.schedule.mode === "allDay" ? item.schedule.startDate! < end && item.schedule.endDate! > start : item.schedule.startsAt! < endsAt && item.schedule.endsAt! > startsAt)) };
  }
}

/** Scoped adapter: auth and unrelated requests never use the private local cache. */
export async function coreFetch(input: string, init?: RequestInit): Promise<Response> {
  if (!localMode() || !copy) return fetch(input, init);
  if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const url = new URL(input, window.location.origin), method = init?.method ?? "GET";
  if (method === "GET") {
    if (sync) await sync;
    if (dirty) return Response.json({ message: "El cambio está guardado en el servidor, pero falta actualizar la copia local. Pulsa Actualizar." }, { status: 409 });
    const result = cached(url.searchParams);
    if (result !== undefined) return Response.json(result);
    if (["agenda", "planner"].includes(url.searchParams.get("view") ?? "")) {
      publish({ range: key(url.searchParams) });
      return Response.json({ message: "Estas fechas no están descargadas. Puedes descargarlas con el botón de arriba cuando tengas conexión." }, { status: 409 });
    }
    if (!navigator.onLine) return Response.json({ message: "Esta información no está descargada. Necesitas conexión para consultarla." }, { status: 503 });
    // Explicit editing/impact dialogs may request information beyond the read copy.
    return fetch(input, init);
  }
  if (url.pathname === "/api/core" && typeof init?.body === "string") {
    try {
      const raw = JSON.parse(init.body);
      const command = ["createTask", "saveTask", "editTask", "addSubtasks", "setCompleted", "deleteTask", "scheduleTask", "unscheduleTask"].includes(raw?.action) ? parseCommand(raw) : null;
      if (command && localTaskCommand(command)) {
        const row = taskRows(copy).get(command.action === "createTask" ? command.parentId ?? command.id : command.id);
        if ((command.action === "createTask" && !command.parentId || row?.kind === "task" && !row.mealRole) && (command.action !== "deleteTask" || row?.parentId)) return await enqueueTask(command);
      }
    } catch (cause) { return Response.json({ message: cause instanceof Error ? cause.message : "No pudimos guardar en el dispositivo." }, { status: 400 }); }
  }
  if (outbox.length) return Response.json({ message: "Esta acción necesita conexión directa. Primero pulsa Actualizar para enviar los cambios pendientes." }, { status: 409 });
  if (!navigator.onLine) return Response.json({ message: "Esta acción necesita conexión. Puedes anotar, editar y completar tareas normales sin internet." }, { status: 400 });
  return exclusive(async () => {
  await restoreLocalCopy();
  if (!copy || outbox.length) return Response.json({ message: "Hay cambios pendientes en otra pestaña. Sincroniza antes de continuar." }, { status: 409 });
  writes++;
  try {
    const headers = new Headers(init?.headers); headers.set("X-MiAgenda-Owner", copy.ownerId);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401 || response.status === 409 && response.headers.get("X-MiAgenda-Account-Changed") === "1") {
      await clearLocalRecord(); window.location.assign("/login"); return response;
    }
    if (response.ok) {
      dirty = true;
      const result = await response.clone().json().catch(() => null);
      const command = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const delta = copy && command && result ? localMutation(copy, command, result as CommandResult) : null;
      if (delta) {
        try {
          const version = epoch;
          await record({ copy: delta, extra: [] });
          if (version !== epoch) return response;
          copy = delta; base = delta; extra.clear(); dirty = false;
          publish({ ready: true });
          window.dispatchEvent(new CustomEvent(localEvent, { detail: { remount: false } }));
          return response;
        } catch { /* A server-confirmed change still succeeds if local storage fails. */ }
      }
      // A successful mutation may affect several modules. Refresh once before
      // their next reads; do not turn a cache failure into an uncertain write.
      try { await refreshLocalCopy(false, true); }
      catch { publish({ message: "Cambio guardado. No pudimos actualizar la copia local; pulsa Actualizar antes de seguir." }); }
    }
    return response;
  } finally { writes--; }
  });
}

export async function downloadRequestedDates() {
  return exclusive(async () => {
  await restoreLocalCopy();
  if (!copy || !state.range || !navigator.onLine || writes) return;
  if (outbox.length) { publish({ message: "Sincroniza los cambios pendientes antes de descargar otras fechas." }); return; }
  const query = state.range, ownerId = copy.ownerId, version = epoch;
  publish({ busy: true });
  try {
    const response = await fetch(`/api/core?${query}`, { cache: "no-store" }), result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "No pudimos descargar las fechas.");
    if (version !== epoch || ownerId !== copy?.ownerId) return;
    if (result.dataRevision !== copy.dataRevision) { publish({ newer: true }); throw new Error("Hay cambios nuevos. Actualiza la copia antes de descargar otras fechas."); }
    if (result.nextAfterId) throw new Error("Hay más actividades de las que caben en esta descarga. Consulta un intervalo menor.");
    const updated = new Map(extra); updated.set(query, result);
    while (updated.size > 8) updated.delete(updated.keys().next().value!);
    while (new TextEncoder().encode(JSON.stringify([...updated])).byteLength > 4 * 1024 * 1024) {
      if (updated.size === 1) throw new Error("Estas fechas ocupan demasiado espacio. Descarga un intervalo menor.");
      updated.delete(updated.keys().next().value!);
    }
    if (outbox.length) throw new Error("Sincroniza los cambios pendientes antes de descargar otras fechas.");
    const nextBase = Array.isArray(result.items) ? mergeTaskRows(base ?? copy, result.items) : base ?? copy;
    await record({ copy: nextBase, base: nextBase, extra: [...updated] }); extra = updated; base = nextBase; copy = nextBase;
    publish({ range: "", message: "Fechas descargadas." });
    window.dispatchEvent(new Event("miagenda:local-range"));
  } catch (cause) { publish({ message: cause instanceof Error ? cause.message : "No pudimos descargar." }); }
  finally { publish({ busy: false }); }
  });
}
