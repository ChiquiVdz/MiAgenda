"use client";
import { coreFetch, localMode, refreshLocalCopy } from "../../core/local-data";
import { useEffect, useRef, useState } from "react";
import type { MealWeekPreview } from "../../../../reconstruction/core/src/meal-weeks";
import type { usePlannerFeed } from "../../core/use-planner-feed";
import { CoreDialog } from "../../core/schedule-editor";
import { atTime, dateParts, labelDate, plusDays } from "../../core/dates";
import { TimePicker } from "../../components/time-picker";

type Feed = ReturnType<typeof usePlannerFeed>;
type Choice = { enabled: boolean; date: string; time: string; duration: number; manual: boolean };
export function MealWeekActions({ start, feed, disabled }: { start: string; feed: Feed; disabled: boolean }) {
  const end = plusDays(start, 7), meals = feed.data.meals.filter(meal => meal.date >= start && meal.date < end);
  const [mode, setMode] = useState<"copy" | "delete" | null>(null), [preview, setPreview] = useState<MealWeekPreview | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({}), [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  const keyOf = (item: MealWeekPreview["reminders"][number]) => `${item.mealRecipeId}:${item.stepKey}`;
  async function review(next: "copy" | "delete") {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setMode(next); setPreview(null); setChoices({}); setError(null); setMessage(null); setLoading(true);
    try {
      const response = await coreFetch(`/api/core?${new URLSearchParams({ view: "mealWeekPreview", start, mode: next })}`,
        { cache: "no-store", signal: abort.signal });
      const result: MealWeekPreview & { message?: string } = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos revisar esta semana.");
      if (abort.signal.aborted) return;
      if (result.dataRevision !== feed.data.dataRevision) void feed.load();
      if (next === "copy" && !result.destinationCount && !result.copyCount) {
        setMode(null); setMessage("La semana anterior no tiene comidas para copiar."); return;
      }
      if (next === "delete" && !result.destinationCount) {
        setMode(null); setMessage("Esta semana ya está vacía."); return;
      }
      setPreview(result);
      setChoices(Object.fromEntries(result.reminders.map(item => {
        // A reminder is suggested before the requested lead time, on the 15-minute grid.
        const local = dateParts(new Date(Math.floor(Date.parse(item.startsAt) / 900000) * 900000), item.timeZone);
        return [keyOf(item), { enabled: false, ...local, duration: 5, manual: false }];
      })));
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos revisar esta semana."); }
    finally { if (controller.current === abort) { controller.current = null; setLoading(false); } }
  }
  function close() { if (feed.busy) return; controller.current?.abort(); controller.current = null; setLoading(false); setMode(null); }
  function change(key: string, fields: Partial<Choice>) {
    setError(null);
    setChoices(current => ({ ...current, [key]: { ...current[key], ...fields, ...(Object.keys(fields).some(field => field !== "enabled") ? { manual: true } : {}) } }));
  }
  const stale = !!preview && preview.dataRevision !== feed.data.dataRevision;
  const blocked = disabled || loading || !preview || stale || (mode === "copy" && preview.destinationCount > 0);
  function confirm() {
    if (blocked || !preview || !mode) return;
    try {
      const reminders = preview.reminders.flatMap(item => {
        const choice = choices[keyOf(item)]; if (!choice?.enabled) return [];
        if (!Number.isInteger(choice.duration) || choice.duration < 1 || choice.duration > 1440) throw new Error("Usa una duración de 1 a 1440 minutos para cada preparación.");
        const startsAt = atTime(choice.date, choice.time, item.timeZone);
        return [{ mealRecipeId: item.mealRecipeId, stepKey: item.stepKey, startsAt,
          endsAt: new Date(Date.parse(startsAt) + choice.duration * 60000).toISOString(), manual: choice.manual }];
      });
      const count = mode === "copy" ? preview.copyCount : preview.destinationCount;
      void feed.mutate({ action: mode === "copy" ? "copyPreviousMealWeek" : "deleteMealWeek", start,
        expectedDataRevision: preview.dataRevision, ...(mode === "copy" ? { reminders } : {}) }, () => {
        setMode(null); setMessage(mode === "copy" ? `Se copiaron ${count} comidas, todas pendientes.` : `Se retiraron ${count} comidas. Los consumos registrados se conservan.`);
      });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Revisa las fechas de las preparaciones."); }
  }
  return <section className="meal-week-actions" aria-label={`Acciones de la semana del ${labelDate(start)}`}>
    <div className="recipe-actions"><strong>{labelDate(start, { day: "numeric", month: "short" })} – {labelDate(plusDays(start,6), { day: "numeric", month: "short" })}</strong>
      {!meals.length && <button type="button" className="core-text-button" disabled={disabled || loading} onClick={() => void review("copy")} aria-label="Copiar semana anterior" title="Copiar semana anterior"><span className="week-action-full">Copiar semana anterior</span><span className="week-action-short">Copiar anterior</span></button>}
      <button type="button" className="core-text-button" disabled={disabled || loading || !meals.length} onClick={() => void review("delete")} aria-label="Borrar comidas de esta semana" title="Borrar comidas de esta semana"><span className="week-action-full">Borrar comidas de esta semana</span><span className="week-action-short">Borrar semana</span></button>
    </div>{message && <p className="core-muted" role="status">{message}</p>}
    {mode && <CoreDialog title={mode === "copy" ? "Copiar semana anterior" : "Borrar comidas de la semana"} close={close}>
      <p>{labelDate(start)} – {labelDate(plusDays(start,6))}</p>
      {loading && <p role="status">Revisando automáticamente…</p>}
      {error && <p className="pantry-error" role="alert">{error}</p>}
      {feed.error && <p className="pantry-error" role="alert">{feed.error}{feed.retry && <button type="button" className="core-text-button" disabled={feed.busy} onClick={feed.reattempt}>Reintentar cambio</button>}</p>}
      {stale && <p className="pantry-error" role="alert">La información cambió. Actualiza esta revisión antes de confirmar.</p>}
      {preview && mode === "copy" && (preview.destinationCount ? <p className="pantry-error">La semana ya tiene comidas. Solo se puede copiar a una semana vacía.</p> : <>
        <p>Se copiarán {preview.copyCount} comidas desde {labelDate(plusDays(start,-7))} – {labelDate(plusDays(start,-1))}, con sus versiones, porciones, horarios y fases. Todas quedarán pendientes.</p>
        <ul>{preview.recipes.map(recipe => <li key={recipe.id}><strong>{recipe.name}</strong> · {recipe.count} {recipe.count === 1 ? "vez" : "veces"} <small>(v{recipe.versions.join(", v")})</small></li>)}</ul>
        <p className="core-muted">Se recalcularán ingredientes, compras y sobras. Copiar no cocina ni descuenta ingredientes.</p>
        <p className="core-muted">Se copian las comidas que siguen en la semana de origen; las ya eliminadas o retiradas por retención no se recuperan.</p>
        {!!preview.reminders.length && <details><summary>Preparaciones previas disponibles ({preview.reminders.length})</summary><p className="core-muted">Elige las que quieres agendar para esta nueva semana. Empiezan sin seleccionar.</p>
          {preview.reminders.map(item => { const key = keyOf(item), choice = choices[key]; if (!choice) return null;
            return <fieldset key={key} className="planner-core-dish" disabled={disabled}><label className="core-check"><input type="checkbox" checked={choice.enabled} onChange={event => change(key, { enabled: event.target.checked })}/>{item.title}</label><small>{item.recipeName} · comida del {labelDate(item.mealDate)}</small>
              {choice.enabled && <div className="planner-meal-compact-row"><label className="form-field">Fecha<input required type="date" value={choice.date} onChange={event => change(key,{date:event.target.value})}/></label><TimePicker label="Hora de preparación" value={choice.time} disabled={disabled} onChange={time => change(key,{time})}/><label className="form-field">Minutos<input required type="number" min={1} max={1440} value={choice.duration} onChange={event => change(key,{duration:Number(event.target.value)})}/></label></div>}
            </fieldset>; })}</details>}
      </>)}
      {preview && mode === "delete" && <><p>Se retirarán {preview.destinationCount} comidas de esta semana y sus pasos/preparaciones, también de Agenda.</p><p>{preview.completedCount} completadas y {preview.destinationCount - preview.completedCount} pendientes.</p><p>Las comidas completadas conservan sus consumos y el origen de sus sobras. Borrar no devuelve ingredientes ni deshace lo que ya comiste.</p><p className="core-muted">Los planes pendientes de otras semanas recalcularán su disponibilidad. Las filas y recetas del recetario permanecen.</p></>}
      {(error || stale || !!preview?.destinationCount && mode === "copy") && <button type="button" className="core-text-button" disabled={feed.locked || loading} onClick={() => void review(mode)}>Actualizar revisión</button>}
      <div className="recipe-actions"><button type="button" className="core-text-button" disabled={feed.busy} onClick={close}>Cancelar</button><button type="button" className="primary-button" disabled={blocked || !!error} onClick={confirm}>{feed.busy ? "Guardando…" : mode === "copy" ? "Copiar comidas" : "Borrar comidas"}</button></div>
    </CoreDialog>}
  </section>;
}
