"use client";
import { coreFetch, localMode, refreshLocalCopy, useLocalStatus } from "./local-data";
import { useEffect, useRef, useState } from "react";
import type { RecipeSnapshot, RecipeView } from "../../../reconstruction/core/src/recipes";
type Draft = { action: string; id: string; expectedRevision?: number; recipe?: unknown };
type Attempt = { command: Draft & { commandId: string }; success?: () => void };
export function useRecipeFeed(initial: RecipeSnapshot) {
  const localStatus=useLocalStatus();
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [reading, setReading] = useState(false), [retry, setRetry] = useState(false), [error, setError] = useState<string | null>(null);
  const attempt = useRef<Attempt | null>(null), writing = useRef(false), controller = useRef<AbortController | null>(null), generation = useRef(0), revision = useRef(initial.dataRevision), pending = useRef(false);
  async function load(afterId?: string) {
    if (writing.current || attempt.current) { pending.current = true; return; }
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const version = ++generation.current; setReading(true);
    try {
      const params = new URLSearchParams({ view: "recipes" }); if (afterId) params.set("afterId", afterId);
      const response = await coreFetch(`/api/core?${params}`, { cache: "no-store", signal: abort.signal }), result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos actualizar el recetario.");
      if (generation.current !== version || BigInt(result.dataRevision) < BigInt(revision.current)) return;
      if (afterId && result.dataRevision !== revision.current) { void load(); return; }
      revision.current = result.dataRevision;
      setData(current => afterId ? { ...result, items: [...current.items, ...result.items.filter((item: RecipeView) => !current.items.some(old => old.id === item.id))] } : result);
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos actualizar."); }
    finally { if (controller.current === abort) { controller.current = null; setReading(false); } }
  }
  async function send(value: Attempt) {
    if (writing.current) return; writing.current = true; attempt.current = value; ++generation.current; controller.current?.abort(); controller.current = null; setReading(false); setBusy(true); setError(null);
    try {
      const response = await coreFetch("/api/core", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value.command) }), result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) { attempt.current = null; pending.current = true; setRetry(false); }
        throw new Error(result?.message ?? "No pudimos confirmar el cambio. Reintenta el mismo comando.");
      }
      if (!result || typeof result.dataRevision !== "string" || (!result.item && !result.removedId)) throw new Error("Respuesta incierta. Reintenta; no se guardará dos veces.");
      attempt.current = null; setRetry(false);
      if (result.replayed || BigInt(result.dataRevision) < BigInt(revision.current)) pending.current = true;
      else { revision.current = result.dataRevision; setData(current => ({ ...current, dataRevision: result.dataRevision, items: result.item ? [...current.items.filter(item => item.id !== result.item.id), result.item] : current.items.filter(item => item.id !== result.removedId) })); }
      value.success?.();
    } catch (cause) { setRetry(!!attempt.current); setError(cause instanceof Error ? cause.message : "No pudimos guardar."); }
    finally { writing.current = false; setBusy(false); if (pending.current && !attempt.current) { pending.current = false; void load(); } }
  }
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { if (localMode()) return; if (document.visibilityState === "visible") { clearTimeout(timer); timer = setTimeout(() => void load(), 150); } };
    const localRefresh=()=>{void load();}; window.addEventListener("miagenda:local-range",localRefresh);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("miagenda:local-range",localRefresh); clearTimeout(timer); controller.current?.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, busy, reading, retry, error, locked: localStatus.busy || busy || retry, load,
    mutate: async (command: Draft, success?: () => void) => { if (!writing.current && !attempt.current) await send({ command: { ...command, commandId: crypto.randomUUID() }, success }); },
    reattempt: () => { if (attempt.current) void send(attempt.current); } };
}
