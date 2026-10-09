"use client";
import { coreFetch, localMode, refreshLocalCopy, useLocalStatus } from "./local-data";
import { useEffect, useRef, useState } from "react";
import type { ShoppingSnapshot } from "../../../reconstruction/core/src/shopping";
export type ShoppingDraft = Record<string, unknown> & { action: string };
type Attempt = { command: ShoppingDraft & { commandId: string }; success?: () => void };

export function useShoppingFeed(initial: ShoppingSnapshot) {
  const localStatus=useLocalStatus();
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null), [retry, setRetry] = useState(false);
  const writing = useRef(false), attempt = useRef<Attempt | null>(null), controller = useRef<AbortController | null>(null);
  const generation = useRef(0), pending = useRef(false), revision = useRef(initial.dataRevision);
  async function load(afterId?: string) {
    if (writing.current || attempt.current) { pending.current = true; return; }
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const version = ++generation.current; setReading(true);
    try {
      const params = new URLSearchParams({ view: "shopping" }); if (afterId) params.set("afterId", afterId);
      const response = await coreFetch(`/api/core?${params}`, { cache: "no-store", signal: abort.signal });
      const result: ShoppingSnapshot & { message?: string } = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos actualizar Compras.");
      if (generation.current !== version || BigInt(result.dataRevision) < BigInt(revision.current)) return;
      if (afterId && result.dataRevision !== revision.current) { void load(); return; }
      revision.current = result.dataRevision;
      setData(current => afterId ? { ...result, purchased: [...current.purchased, ...result.purchased.filter(row => !current.purchased.some(old => old.id === row.id))] } : result);
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos actualizar."); }
    finally { if (controller.current === abort) { controller.current = null; setReading(false); } }
  }
  async function send(value: Attempt) {
    if (writing.current) return;
    writing.current = true; attempt.current = value; ++generation.current; controller.current?.abort(); controller.current = null;
    setReading(false); setBusy(true); setError(null);
    try {
      const response = await coreFetch("/api/core", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value.command) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) { attempt.current = null; setRetry(false); pending.current = true; }
        throw new Error(result?.message ?? "No pudimos confirmar el cambio. Reintenta el mismo comando.");
      }
      if (typeof result?.dataRevision !== "string" || result.changed !== true) throw new Error("Respuesta incierta. Reintenta; la compra no se duplicará.");
      revision.current = BigInt(result.dataRevision) > BigInt(revision.current) ? result.dataRevision : revision.current;
      attempt.current = null; setRetry(false); pending.current = true; value.success?.();
    } catch (cause) { setRetry(!!attempt.current); setError(cause instanceof Error ? cause.message : "No pudimos guardar."); }
    finally { writing.current = false; setBusy(false); if (pending.current && !attempt.current) { pending.current = false; void load(); } }
  }
  async function mutate(command: ShoppingDraft, success?: () => void) {
    if (!writing.current && !attempt.current) await send({ command: { ...command, commandId: crypto.randomUUID() }, success });
  }
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => { if (localMode()) return; if (document.visibilityState === "visible") { clearTimeout(timer); timer = setTimeout(() => void load(), 150); } };
    const localRefresh=()=>{void load();}; window.addEventListener("miagenda:local-range",localRefresh);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("miagenda:local-range",localRefresh); clearTimeout(timer); controller.current?.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, busy, reading, error, retry, locked: localStatus.busy || busy || reading || retry, load, mutate, reattempt: () => { if (attempt.current) void send(attempt.current); } };
}
