"use client";
import { coreFetch, localMode, refreshLocalCopy } from "../core/local-data";
import { useContext, useEffect, useRef, useState } from "react";
import type { IngredientView, PantrySnapshot } from "../../../reconstruction/core/src/pantry";
import type { IngredientImpact } from "../../../reconstruction/core/src/ingredient-retirement";
import type { PantryMutate } from "../core/use-pantry-feed";
import { CoreDialog, CoreFeedback } from "../core/schedule-editor";
import { IngredientEditor } from "./core-pantry-view";
import { normalizedIngredientName, quantityString, quantityThousandths } from "../../../reconstruction/core/src/ingredient-input";

export function IngredientRetirementDialog({ item, data, disabled, mutate, close, refreshCatalog }: { item: IngredientView; data: PantrySnapshot; disabled: boolean; mutate: PantryMutate; close: () => void; refreshCatalog: () => void }) {
  const feedback = useContext(CoreFeedback);
  const [impact, setImpact] = useState<IngredientImpact | null>(null), [error, setError] = useState<string | null>(null), [reading, setReading] = useState(true);
  const [mode, setMode] = useState<"replace" | "remove">("replace"), [replacementId, setReplacementId] = useState(""), [updatePending, setUpdatePending] = useState(false), [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setReading(true); setImpact(null); setError(null);
    void coreFetch(`/api/core?${new URLSearchParams({ view: "ingredientImpact", id: item.id })}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "No pudimos revisar este ingrediente."); if (!controller.signal.aborted) setImpact(result); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos revisar este ingrediente."); })
      .finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [item.id, data.dataRevision, refresh]);
  const target = data.ingredients.find(candidate => candidate.id === replacementId);
  const stale = !!impact && impact.dataRevision !== data.dataRevision;
  const matches = data.ingredients.filter(candidate => candidate.id !== item.id && candidate.unit === item.unit && normalizedIngredientName(candidate.name).includes(normalizedIngredientName(search))).sort((a,b) => a.name.localeCompare(b.name, "es"));
  const removalBlocked = mode === "remove" && (!!impact && Number(impact.quantity) > 0 || updatePending && impact?.pendingRemovalBlocked);
  if (creating) return <IngredientEditor fixedUnit={item.unit} catalog={data.ingredients} disabled={disabled} mutate={mutate} close={() => setCreating(false)} choose={candidate => { if (candidate.id !== item.id && candidate.unit === item.unit) setReplacementId(candidate.id); else setError("Elige otro ingrediente con la misma unidad."); setCreating(false); }} created={id => { setReplacementId(id); setCreating(false); }} />;
  return <CoreDialog title={`Eliminar ${item.name}`} close={close}><div className="core-edit-form">
    <p>Este cambio solo afecta tus ingredientes y referencias. El historial de compras y comidas completadas permanece intacto.</p>
    {reading && <p role="status">Revisando recetas y comidas…</p>}
    {impact && <>
      <p>Tienes <strong>{impact.quantity} {item.unit === "piece" ? "piezas" : item.unit}</strong>. Se modificarán <strong>{impact.recipes.length} recetas</strong> del recetario.</p>
      {!!impact.recipes.length && <details><summary>Ver recetas afectadas</summary><ul>{impact.recipes.map(recipe => <li key={recipe.id}>{recipe.name}</li>)}</ul></details>}
      <label className="form-field">Qué hacer<select disabled={disabled} value={mode} onChange={event => { const next = event.target.value as typeof mode; setMode(next); if (next === "remove" && impact.pendingRemovalBlocked) setUpdatePending(false); setError(null); }}><option value="replace">Reemplazar por otro ingrediente</option><option value="remove">Eliminar de mis recetas sin reemplazar</option></select></label>
      {mode === "replace" && <>
        <label className="form-field">Buscar sustituto ({item.unit === "piece" ? "piezas" : item.unit})<input type="search" value={search} disabled={disabled} onChange={event => setSearch(event.target.value)} /></label>
        <label className="form-field">Ingrediente existente<select value={replacementId} disabled={disabled} onChange={event => setReplacementId(event.target.value)}><option value="">Elige un ingrediente</option>{matches.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}{target && !matches.some(candidate => candidate.id === target.id) && <option value={target.id}>{target.name}</option>}</select></label>
        <button type="button" className="core-text-button" disabled={disabled} onClick={() => setCreating(true)}>＋ Crear un sustituto</button>
        <p className="core-muted">Solo se suman cantidades de la misma unidad. Para cambiar de gramos a piezas u otra unidad, convierte y ajusta primero las cantidades explícitamente.</p>
        {target && <p>Las existencias de {item.name} se sumarán a {target.name}: <strong>{quantityString(quantityThousandths(impact.quantity) + quantityThousandths(target.quantity))} {target.unit === "piece" ? "piezas" : target.unit}</strong>.</p>}
      </>}
      {mode === "remove" && <p>Se conservará el texto de los pasos. Las recetas que queden sin ingredientes pasarán a borrador.</p>}
      {mode === "remove" && Number(impact.quantity) > 0 && <p className="pantry-error">Primero ajusta las existencias a cero en Alacena o elige un sustituto. No eliminaremos cantidades a escondidas.</p>}
      {!!impact.meals.length && <section><label className="core-check"><input type="checkbox" checked={updatePending} disabled={disabled || mode === "remove" && impact.pendingRemovalBlocked} onChange={event => setUpdatePending(event.target.checked)} />Aplicar también a estas {impact.meals.length} comidas pendientes</label>
        <details><summary>Ver comidas pendientes</summary><ul>{impact.meals.map(meal => <li key={meal.id}>{meal.name}{meal.startsAt ? ` · ${new Date(meal.startsAt).toLocaleString("es-MX")}` : ""}</li>)}</ul></details>
        <p className="core-muted">Solo cambia este ingrediente; se conservan las porciones, horarios, pasos realizados y los demás datos de cada versión planificada.</p>
        {!updatePending && <p className="core-muted">Sin seleccionar esta opción, esas comidas y sus compras seguirán mostrando el ingrediente original. Tendrás que editar sus recetas planificadas antes de comprar o cocinar con el sustituto.</p>}
        {mode === "remove" && impact.pendingRemovalBlocked && <p className="core-muted">Una comida quedaría sin ingredientes. Para cambiarla, usa un sustituto o edítala/elimina su plan primero.</p>}
      </section>}
      <p className="core-muted">Al deshacer un consumo anterior, sus ingredientes se devolverán al sustituto. Si lo eliminaste sin sustituto, volverá a aparecer cuando se le devuelvan existencias.</p>
      {stale && <p className="pantry-error">Alacena cambió desde que la abriste. <button className="core-text-button" disabled={disabled} onClick={refreshCatalog}>Actualizar cantidades</button></p>}
      <button className="pantry-add-button" disabled={disabled || reading || stale || !!removalBlocked || mode === "replace" && (!target || target.unit !== item.unit)} onClick={() => void mutate({ action: "retireIngredient", id: item.id, expectedDataRevision: impact.dataRevision, replacementId: mode === "replace" ? replacementId : null, updatePending: updatePending && !(mode === "remove" && impact.pendingRemovalBlocked) }, close)}>Confirmar {mode === "replace" ? "reemplazo" : "eliminación"}</button>
    </>}
    {(error || feedback.error) && <p className="pantry-error" role="alert">{error || feedback.error}</p>}
    {feedback.retry ? <button className="core-text-button" disabled={feedback.busy} onClick={feedback.reattempt}>Reintentar el mismo cambio</button> : <button className="core-text-button" disabled={disabled || reading} onClick={() => setRefresh(value => value + 1)}>Revisar de nuevo</button>}
    <button className="core-text-button" disabled={feedback.busy} onClick={close}>Cancelar</button>
  </div></CoreDialog>;
}

export function RemovedIngredients({ dataRevision, disabled, mutate }: { dataRevision: string; disabled: boolean; mutate: PantryMutate }) {
  const [open, setOpen] = useState(false), [items, setItems] = useState<IngredientView[]>([]), [nextId, setNextId] = useState<string | null>(null), [reading, setReading] = useState(false), [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  async function load(afterId?: string) {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; setReading(true); setError(null);
    try {
      const params = new URLSearchParams({ view: "removedIngredients" }); if (afterId) params.set("afterId", afterId);
      const response = await coreFetch(`/api/core?${params}`, { cache: "no-store", signal: abort.signal }); const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos cargar los ingredientes eliminados.");
      if (!abort.signal.aborted) { setItems(current => afterId ? [...current, ...result.items.filter((item: IngredientView) => !current.some(old => old.id === item.id))] : result.items); setNextId(result.nextId); }
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos cargar los ingredientes eliminados."); }
    finally { if (controller.current === abort) { controller.current = null; setReading(false); } }
  }
  useEffect(() => { if (open) void load(); return () => controller.current?.abort(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open, dataRevision]);
  return <details className="inbox-completed" onToggle={event => setOpen(event.currentTarget.open)}><summary>Ingredientes eliminados</summary>
    <p className="core-muted">Puedes recuperar los eliminados sin sustituto. Esto no restaura ingredientes en recetas ni modifica planes o existencias. Los unificados se usan a través de su sustituto.</p>
    {reading && <p role="status">Cargando…</p>}{error && <p className="pantry-error" role="alert">{error}</p>}
    <ul className="core-hidden-ingredients">{items.map(item => <li key={item.id}><span>{item.name}</span><button className="core-text-button" disabled={disabled || reading} onClick={() => void mutate({ action: "setIngredientHidden", id: item.id, expectedPreferenceRevision: item.preferenceRevision, hidden: false })}>Recuperar</button></li>)}</ul>
    {!reading && !error && !items.length && <p className="core-muted">No hay ingredientes eliminados sin sustituto.</p>}
    {nextId && <button className="core-text-button" disabled={disabled || reading} onClick={() => void load(nextId)}>Cargar más</button>}
    {error && <button className="core-text-button" disabled={disabled || reading} onClick={() => void load()}>Actualizar</button>}
  </details>;
}
