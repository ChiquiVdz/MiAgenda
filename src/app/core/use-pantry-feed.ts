"use client";
import { coreFetch, localMode, refreshLocalCopy } from "./local-data";
import { useEffect, useRef, useState } from "react";
import type { PantryCommand } from "../../../reconstruction/core/src/pantry-contracts";
import type { PantryResult, PantrySnapshot } from "../../../reconstruction/core/src/pantry";
export type PantryDraft = PantryCommand extends infer C ? C extends { commandId: string } ? Omit<C, "commandId"> : never : never;
export type PantryMutate = (command: PantryDraft, success?: () => void) => Promise<void>;
type Attempt = { command: PantryCommand; success?: () => void };
export function usePantryFeed(initial: PantrySnapshot) {
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null), [retry, setRetry] = useState(false);
  const writing = useRef(false), attempt = useRef<Attempt | null>(null), controller = useRef<AbortController | null>(null), generation = useRef(0), revision = useRef(initial.dataRevision);
  const pendingRead = useRef(false);
  async function load(page?: "catalog" | "pantry", afterId?: string) {
    if (writing.current || attempt.current) { pendingRead.current = true; return; }
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const version = ++generation.current; setReading(true);
    try {
      const params = new URLSearchParams({ view: "pantry" }); if (page && afterId) params.set(page === "catalog" ? "catalogAfterId" : "pantryAfterId", afterId);
      const response = await coreFetch(`/api/core?${params}`, { cache: "no-store", signal: abort.signal });
      const result: PantrySnapshot & { message?: string } = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos actualizar Alacena.");
      if (generation.current !== version || BigInt(result.dataRevision) < BigInt(revision.current)) return;
      if (page && result.dataRevision !== revision.current) { void load(); return; }
      revision.current = result.dataRevision;
      setData(current => page === "catalog" ? { ...current, ingredients: [...current.ingredients, ...result.ingredients.filter(item => !current.ingredients.some(old => old.id === item.id))], nextCatalogId: result.nextCatalogId }
        : page === "pantry" ? { ...current, items: [...current.items, ...result.items.filter(item => !current.items.some(old => old.ingredient.id === item.ingredient.id))], nextPantryId: result.nextPantryId } : result);
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos actualizar Alacena."); }
    finally { if (controller.current === abort) { controller.current = null; setReading(false); } }
  }
  async function send(value: Attempt) {
    if (writing.current) return;
    writing.current = true; setBusy(true); setError(null); setNotice(null); ++generation.current; controller.current?.abort(); controller.current = null; setReading(false); attempt.current = value;
    try {
      const response = await coreFetch("/api/core", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value.command) });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status < 500 && response.status !== 429) { attempt.current = null; setRetry(false); pendingRead.current = true; }
        throw new Error(result?.message ?? "No pudimos confirmar el cambio. Reintenta el mismo comando.");
      }
      if (!Array.isArray(result?.ingredients) || !Array.isArray(result?.items) || !Array.isArray(result?.removedItemIds) || typeof result?.dataRevision !== "string") throw new Error("Respuesta incierta. Reintenta; el ajuste no se duplicará.");
      const saved = result as PantryResult & { replayed: boolean };
      attempt.current = null; setRetry(false);
      if (saved.replayed || BigInt(saved.dataRevision) < BigInt(revision.current)) pendingRead.current = true;
      else {
        revision.current = saved.dataRevision;
        setData(current => {
          const ingredients = new Map(current.ingredients.map(item => [item.id, item])); saved.ingredients.forEach(item => ingredients.set(item.id, item));
          saved.removedIngredientIds?.forEach(id => ingredients.delete(id));
          const items = new Map(current.items.map(item => [item.ingredient.id, item])); saved.removedItemIds.forEach(id => items.delete(id)); saved.items.forEach(item => items.set(item.ingredient.id, item));
          return { ...current, ingredients: [...ingredients.values()], items: [...items.values()], dataRevision: saved.dataRevision };
        });
      }
      value.success?.(); setNotice("Cambio guardado.");
    } catch (cause) { setRetry(!!attempt.current); setError(cause instanceof Error ? cause.message : "No pudimos guardar el cambio."); }
    finally { writing.current = false; setBusy(false); if (pendingRead.current && !attempt.current) { pendingRead.current = false; void load(); } }
  }
  const mutate: PantryMutate = async (command, success) => { if (!writing.current && !attempt.current) await send({ command: { ...command, commandId: crypto.randomUUID() } as PantryCommand, success }); };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => { if (localMode()) return; if (document.visibilityState === "visible") { clearTimeout(timer); timer = setTimeout(() => void load(), 150); } };
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(timer); controller.current?.abort(); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); document.removeEventListener("visibilitychange", refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { data, busy, reading, error, retry, notice, locked: busy || retry, mutate, load, reattempt: () => { if (attempt.current) void send(attempt.current); } };
}
