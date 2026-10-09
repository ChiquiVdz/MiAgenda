"use client";
import { coreFetch, localMode, refreshLocalCopy, useLocalStatus } from "./local-data";

import { useEffect, useRef, useState } from "react";
import type { CoreCommand } from "../../../reconstruction/core/src/contracts";
import type { ActivityView, CommandResult } from "../../../reconstruction/core/src/views";

export type Draft = CoreCommand extends infer C ? C extends { commandId: string } ? Omit<C, "commandId"> : never : never;
export type Feed = { items: ActivityView[]; dataRevision: string; nextAfterId: string | null };
export type Mutate = (command: Draft, success?: () => void) => Promise<void>;
type Attempt = { command: CoreCommand; success?: () => void };

/** One in-flight write, stable retries, and range reads fenced against stale responses. */
export function useCoreFeed(initial: Feed, query: string, accepts: (item: ActivityView) => boolean, afterWrite?: (action?: string, result?: CommandResult) => void) {
  const local = useLocalStatus();
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const write = useRef(false), attempt = useRef<Attempt | null>(null), controller = useRef<AbortController | null>(null);
  const generation = useRef(0), revision = useRef(initial.dataRevision), pendingRead = useRef(false);
  const latest = useRef({ query, accepts, afterWrite }); latest.current = { query, accepts, afterWrite };
  const maintenanceRunning = useRef(false), maintenanceAttemptAt = useRef(0);

  async function maintain() {
    if (localMode() || write.current || maintenanceRunning.current || Date.now() - maintenanceAttemptAt.current < 3600000) return;
    maintenanceRunning.current = true; maintenanceAttemptAt.current = Date.now();
    let changed = false;
    try {
      // A few short batches on entry, never a polling timer. Remaining work
      // resumes on a later visit/focus or the protected daily cron.
      for (let batch = 0; batch < 3; batch++) {
        const response = await coreFetch("/api/core/retention", { method: "POST" });
        if (!response.ok) { maintenanceAttemptAt.current = 0; break; }
        const result = await response.json(); changed ||= result.changed === true;
        if (!result.hasMore || write.current) break;
      }
    } catch { maintenanceAttemptAt.current = 0; /* Maintenance never blocks editing. */ }
    finally {
      maintenanceRunning.current = false;
      if (changed) { void load(); latest.current.afterWrite?.(); }
    }
  }

  async function load(afterId?: string, preserveError = false) {
    if (write.current || attempt.current) { pendingRead.current = true; return; }
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    const version = ++generation.current; setReading(true);
    try {
      const params = new URLSearchParams(latest.current.query);
      if (afterId) params.set("afterId", afterId);
      const response = await coreFetch(`/api/core?${params}`, { cache: "no-store", signal: abort.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos actualizar las actividades.");
      if (version !== generation.current || BigInt(result.dataRevision) < BigInt(revision.current)) return;
      // A cursor belongs to its snapshot. Never append a newer page to stale rows.
      if (afterId && result.dataRevision !== revision.current) { void load(); return; }
      revision.current = result.dataRevision; if (!preserveError) setError(null);
      setData(current => ({ ...result, items: afterId
        ? [...current.items, ...result.items.filter((item: ActivityView) => !current.items.some(old => old.id === item.id))]
        : result.items }));
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos actualizar."); }
    finally { if (controller.current === abort) { controller.current = null; setReading(false); } }
  }
  async function send(value: Attempt) {
    if (write.current) return;
    write.current = true; setBusy(true); setError(null); setNotice(null);
    ++generation.current; if (controller.current) pendingRead.current = true;
    controller.current?.abort(); controller.current = null; setReading(false); attempt.current = value;
    try {
      const response = await coreFetch("/api/core", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value.command) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) { attempt.current = null; setRetry(false); pendingRead.current = true; }
        throw new Error(result?.message ?? "No pudimos confirmar el cambio. Reintenta el mismo comando.");
      }
      if (!Array.isArray(result?.activities) || !Array.isArray(result?.removedIds) || typeof result?.dataRevision !== "string") throw new Error("Respuesta incierta. Reintenta; no se duplicará el cambio.");
      const saved = result as CommandResult & { replayed: boolean };
      attempt.current = null; setRetry(false);
      if (saved.replayed || BigInt(saved.dataRevision) < BigInt(revision.current)) pendingRead.current = true;
      else {
        revision.current = saved.dataRevision;
        setData(current => {
          const updates = new Map(saved.activities.map(item => [item.id, item]));
          const removed = new Set(saved.removedIds);
          const items = current.items.filter(item => !removed.has(item.id)).map(item => updates.get(item.id) ?? item);
          for (const item of updates.values()) if (!items.some(old => old.id === item.id)) items.push(item);
          return { ...current, dataRevision: saved.dataRevision, items: items.filter(latest.current.accepts) };
        });
      }
      if (["setCalendarVisible", "deleteCalendar", "createRecurringTask", "saveTask", "addSubtasks"].includes(value.command.action) || (value.command.scope && value.command.scope !== "this")) pendingRead.current = true;
      latest.current.afterWrite?.(value.command.action, saved.replayed ? undefined : saved); value.success?.(); setNotice(result.localPending ? "Guardado en este dispositivo · Sin enviar" : "Cambio guardado.");
    } catch (cause) { setRetry(Boolean(attempt.current)); setError(cause instanceof Error ? cause.message : "No pudimos guardar."); }
    finally {
      write.current = false; setBusy(false);
      if (pendingRead.current && !attempt.current) { pendingRead.current = false; void load(undefined, true); }
    }
  }
  const mutate: Mutate = async (command, success) => {
    if (write.current || attempt.current) return;
    const targetId = command.action === "createTask" ? command.parentId : command.id;
    const target = data.items.flatMap(item => [item, ...item.children]).find(item => item.id === targetId);
    const occurrence = command.occurrence ?? (target?.recurrence?.virtual ? { seriesId: target.recurrence.seriesId, ordinal: target.recurrence.ordinal, seriesRevision: target.recurrence.seriesRevision } : undefined);
    await send({ command: { ...command, ...(occurrence ? { occurrence } : {}), commandId: crypto.randomUUID() } as CoreCommand, success });
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const captured = () => {
      // Only Inbox needs a new read; unscheduled captures do not affect Agenda.
      if (new URLSearchParams(latest.current.query).get("view") === "inbox") void load();
    };
    const localRange = () => { void load(); }; const refresh = () => { if (localMode()) return; if (document.visibilityState === "visible") { clearTimeout(timer); timer = setTimeout(() => { void load(); void maintain(); latest.current.afterWrite?.(); }, 150); } };
    void maintain();
    window.addEventListener("miagenda:inbox-captured", captured);
    window.addEventListener("miagenda:local-range", localRange); window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(timer); controller.current?.abort(); window.removeEventListener("miagenda:inbox-captured", captured); window.removeEventListener("miagenda:local-range", localRange); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
    // Initial server data is used without a duplicate request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const previousQuery = useRef(query);
  useEffect(() => {
    if (previousQuery.current !== query) { previousQuery.current = query; setData(current => ({ ...current, items: [], nextAfterId: null })); void load(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  return { data, busy, reading, error, retry, notice, locked: busy || retry || local.busy, mutate, load,
    reattempt: () => { if (attempt.current) void send(attempt.current); } };
}
