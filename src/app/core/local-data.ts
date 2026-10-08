"use client";

import { useSyncExternalStore } from "react";
import { signOut as authSignOut } from "next-auth/react";
import type { LocalCopy } from "./local-contract";
import { atTime, plusDays } from "./dates";
import { localMutation } from "./local-mutation";
import type { CommandResult } from "../../../reconstruction/core/src/views";

const DB = "miagenda-local-v1", STORE = "account";
export const localEvent = "miagenda:local-copy";
let copy: LocalCopy | null = null;
let sync: Promise<LocalCopy> | null = null;
let epoch = 0, writes = 0, dirty = false;
let extra = new Map<string, unknown>();
let state = { online: true, busy: false, message: "", newer: false, ready: false, range: "", shellReady: false };
const listeners = new Set<() => void>();
function publish(update: Partial<typeof state>) { state = { ...state, ...update }; listeners.forEach(fn => fn()); }
export function useLocalStatus() { return useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state, () => state); }
export function currentCopy() { return copy; }
export function localMode() { return typeof window !== "undefined" && isLocalPath(window.location.pathname); }
export function isLocalPath(path: string) { return ["/", "/local", "/inbox", "/agenda", "/hoy", "/cocina", "/cocina/inicio", "/cocina/recetas", "/cocina/planificar", "/cocina/compras"].includes(path); }
export function setLocalOnline(online: boolean) { publish({ online }); }
export function setShellReady(shellReady: boolean) { publish({ shellReady }); }

async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("No pudimos abrir el almacenamiento del dispositivo."));
  });
}
async function record(value?: { copy: LocalCopy; extra: [string, unknown][] } | null) {
  const db = await database();
  try {
    return await new Promise<{ copy: LocalCopy; extra: [string, unknown][] } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, value === undefined ? "readonly" : "readwrite"), store = tx.objectStore(STORE);
      let result: { copy: LocalCopy; extra: [string, unknown][] } | undefined;
      if (value === undefined) { const request = store.get("active"); request.onsuccess = () => { result = request.result; }; }
      else if (value === null) store.clear();
      else store.put(value, "active"); // Single active account: account switches cannot reveal another copy.
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
  if (saved?.copy.format === 1) { copy = saved.copy; extra = new Map(saved.extra ?? []); publish({ ready: true }); }
  return copy;
}
export async function clearLocalCopy() {
  epoch++; copy = null; extra.clear(); dirty = false;
  publish({ ready: false, newer: false, range: "", message: "" });
  await record(null);
  window.dispatchEvent(new Event(localEvent));
}
export async function signOut(options: Parameters<typeof authSignOut>[0]) {
  if (!navigator.onLine) { publish({ message: "Conéctate para cerrar también tu sesión en el servidor." }); return; }
  await clearLocalCopy();
  // Other tabs discard the account as well. No credentials go into local storage.
  localStorage.setItem("miagenda:logout", String(Date.now()));
  await authSignOut(options);
}

export async function refreshLocalCopy(remount = true): Promise<LocalCopy> {
  if (sync) return sync;
  if (!navigator.onLine) throw new Error("Sin conexión. Puedes consultar lo descargado; actualizar necesita internet.");
  if (remount && writes) throw new Error("Espera a que termine el guardado antes de actualizar.");
  const version = epoch;
  publish({ busy: true, message: "" });
  const pending = (async () => {
    // Local reads never purge. Explicit updates may ask the server for one short
    // retention batch; the production cron is responsible for unattended work.
    if (remount) await fetch("/api/core/retention", { method: "POST" }).catch(() => null);
    const response = await fetch("/api/core/local", { cache: "no-store" });
    const result = await response.json();
    if (response.status === 401) { await clearLocalCopy(); window.location.assign("/login"); }
    if (!response.ok) throw new Error(result.message ?? "No pudimos actualizar la copia.");
    const next = result as LocalCopy;
    if (next.format !== 1 || !next.ownerId || !next.inbox || !next.planners) throw new Error("La copia recibida no es válida.");
    if (version !== epoch) throw new Error("La sesión cambió. Vuelve a entrar.");
    if (copy && next.ownerId !== copy.ownerId) { await clearLocalCopy(); window.location.assign("/login"); throw new Error("La cuenta cambió. Vuelve a entrar."); }
    // Commit to IndexedDB before claiming offline readiness. Keep old copy on failure.
    await record({ copy: next, extra: [] });
    if (version !== epoch) { await record(null); throw new Error("La sesión cambió."); }
    copy = next; extra.clear(); dirty = false;
    publish({ ready: true, newer: false, range: "" });
    window.dispatchEvent(new CustomEvent(localEvent, { detail: { remount } }));
    return next;
  })();
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
    if (response.status === 401) { await clearLocalCopy(); window.location.assign("/login"); return; }
    if (!response.ok) throw new Error("No pudimos comprobar si hay novedades. Puedes seguir con la copia local.");
    if (result.ownerId !== copy?.ownerId) { await clearLocalCopy(); await refreshLocalCopy(); return; }
    publish({ newer: result.dataRevision !== copy?.dataRevision || dirty });
  } catch (cause) { publish({ message: cause instanceof Error ? cause.message : "No pudimos comprobar novedades." }); }
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
  const exact = extra.get(key(params)); if (exact) return exact;
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
    if (highlighted ? start < `${year}-01-01` || end > `${Number(year) + 1}-01-01` : start < copy.start || end > copy.end) return undefined;
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
    if (dirty) return Response.json({ message: "El cambio está guardado en el servidor, pero falta actualizar la copia local. Pulsa Actualizar copia." }, { status: 409 });
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
  if (!navigator.onLine) return Response.json({ message: "En este bloque solo puedes consultar sin conexión. Conéctate para guardar cambios." }, { status: 400 });
  writes++;
  try {
    const headers = new Headers(init?.headers); headers.set("X-MiAgenda-Owner", copy.ownerId);
    const response = await fetch(input, { ...init, headers });
    if (response.status === 401 || response.status === 409 && response.headers.get("X-MiAgenda-Account-Changed") === "1") {
      await clearLocalCopy(); window.location.assign("/login"); return response;
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
          copy = delta; extra.clear(); dirty = false;
          publish({ ready: true });
          window.dispatchEvent(new CustomEvent(localEvent, { detail: { remount: false } }));
          return response;
        } catch { /* A server-confirmed change still succeeds if local storage fails. */ }
      }
      // A successful mutation may affect several modules. Refresh once before
      // their next reads; do not turn a cache failure into an uncertain write.
      try { await refreshLocalCopy(false); }
      catch { publish({ message: "Cambio guardado. No pudimos actualizar la copia local; pulsa Actualizar copia antes de seguir." }); }
    }
    return response;
  } finally { writes--; }
}

export async function downloadRequestedDates() {
  if (!copy || !state.range || !navigator.onLine || writes) return;
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
    await record({ copy, extra: [...updated] }); extra = updated;
    publish({ range: "", message: "Fechas descargadas." });
    window.dispatchEvent(new Event("miagenda:local-range"));
  } catch (cause) { publish({ message: cause instanceof Error ? cause.message : "No pudimos descargar." }); }
  finally { publish({ busy: false }); }
}
