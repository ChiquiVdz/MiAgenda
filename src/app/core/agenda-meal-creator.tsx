"use client";
import { coreFetch, localMode, refreshLocalCopy } from "./local-data";
import Link from "./local-link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MealView, PlannerSnapshot } from "../../../reconstruction/core/src/planner";
import { MealEditor } from "./meal-editor";
import { usePlannerFeed } from "./use-planner-feed";
import { monday, plusDays } from "./dates";

type Entry = { date: string; slotId: string; time?: string; meal?: MealView };
function suggestedSlot(snapshot: PlannerSnapshot, time: string) {
  const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  return [...snapshot.slots].sort((a,b) => Math.abs(a.startMinute-minute)-Math.abs(b.startMinute-minute) || a.position-b.position || a.id.localeCompare(b.id))[0];
}

/** Loads kitchen data only when Comida is selected. Both surfaces use MealEditor/saveMeal. */
export function AgendaMealCreator({ date, time, close, saved, onLockedChange }: {
  date: string; time: string; close: () => void; saved: (date: string) => void; onLockedChange: (locked: boolean) => void;
}) {
  const [context, setContext] = useState<{ initial: PlannerSnapshot; entry: Entry | null; key: number } | null>(null);
  const [reading, setReading] = useState(true), [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null), generation = useRef(0);
  async function load(targetDate: string, mealId?: string) {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort; const key = ++generation.current;
    setReading(true); setError(null);
    try {
      const response = await coreFetch(`/api/core?${new URLSearchParams({ view: "planner", start: monday(targetDate), days: "7" })}`, { cache: "no-store", signal: abort.signal });
      const result: PlannerSnapshot & { message?: string } = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos cargar el formulario de comida.");
      if (abort.signal.aborted || key !== generation.current) return;
      const meal = mealId ? result.meals.find(item => item.id === mealId) : undefined;
      if (mealId && !meal) throw new Error("La comida ya no está disponible. Revisa de nuevo antes de abrirla.");
      if (meal?.completedAt) throw new Error("La comida ya fue completada. Deshazla desde Planificar antes de añadir recetas.");
      const slot = suggestedSlot(result, time);
      setContext({ initial: result, key, entry: meal ? { date: meal.date, slotId: meal.slotId, meal } : { date: targetDate, slotId: slot?.id ?? "", time } });
    } catch (cause) { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos cargar Cocina."); }
    finally { if (controller.current === abort) { controller.current = null; setReading(false); } }
  }
  useEffect(() => { void load(date); return () => { controller.current?.abort(); onLockedChange(false); }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [date]);
  return <>
    {reading && <p role="status">Cargando recetas y disponibilidad…</p>}
    {error && <p className="pantry-error" role="alert">{error}</p>}
    {!reading && context && <LoadedMealCreator key={context.key} initial={context.initial} entry={context.entry} time={time} close={close} saved={saved} onLockedChange={onLockedChange} reload={(targetDate,mealId) => void load(targetDate,mealId)} />}
    {error && !reading && <button className="core-text-button" onClick={() => void load(date)}>Reintentar carga</button>}
  </>;
}

function LoadedMealCreator({ initial, entry, time, close, saved, onLockedChange, reload }: {
  initial: PlannerSnapshot; entry: Entry | null; time: string; close: () => void; saved: (date: string) => void;
  onLockedChange: (locked: boolean) => void; reload: (date: string, mealId?: string) => void;
}) {
  const feed = usePlannerFeed(initial, initial.start, initial.days, false);
  const slot = suggestedSlot(feed.data, time);
  const value = entry?.slotId ? entry : (slot ? { date: entry?.date ?? initial.start, slotId: slot.id, time } : null);
  const [destination, setDestination] = useState({ date: entry?.date ?? initial.start, slotId: entry?.slotId ?? "" });
  const [outsideCell, setOutsideCell] = useState<MealView | null>(null), [checking, setChecking] = useState(false), [cellError, setCellError] = useState<string | null>(null), [review, setReview] = useState(0);
  const onDestinationChange = useCallback((date: string, slotId: string) => setDestination(current => current.date === date && current.slotId === slotId ? current : { date, slotId }), []);
  useEffect(() => { onLockedChange(feed.busy || feed.retry); return () => onLockedChange(false); }, [feed.busy, feed.retry, onLockedChange]);
  const inRange = destination.date >= feed.data.start && destination.date < plusDays(feed.data.start, feed.data.days);
  const occupied = (inRange ? feed.data.meals.find(meal => meal.date === destination.date && meal.slotId === destination.slotId) : outsideCell) ?? null;
  const collision = occupied && occupied.id !== value?.meal?.id ? occupied : null;
  useEffect(() => {
    setOutsideCell(null); setCellError(null);
    if (inRange || !destination.slotId || !/^\d{4}-\d{2}-\d{2}$/.test(destination.date)) { setChecking(false); return; }
    const abort = new AbortController(); setChecking(true);
    const timer = setTimeout(() => {
      void coreFetch(`/api/core?${new URLSearchParams({ view: "mealCell", date: destination.date, slotId: destination.slotId })}`, { cache: "no-store", signal: abort.signal })
        .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "No pudimos revisar esta celda."); if (!abort.signal.aborted) setOutsideCell(result.meal); })
        .catch(cause => { if (!abort.signal.aborted) setCellError(cause instanceof Error ? cause.message : "No pudimos revisar esta celda."); })
        .finally(() => { if (!abort.signal.aborted) setChecking(false); });
    }, 150);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [inRange, destination.date, destination.slotId, feed.data.dataRevision, review]);
  if (!feed.data.initialized) return <p role="status">Preparando Cocina…</p>;
  if (!value) return <p>No tienes filas de comidas. <Link prefetch={false} href="/cocina/planificar">Agrega un tipo de comida en Planificar</Link> y vuelve a Agenda.</p>;
  return <>
    <p className="core-muted">{value.meal ? `Editando la comida existente: ${value.meal.title}. Puedes añadir recetas conservando sus datos.` : "Se guardará en el calendario Cocina y en Planificar. La fila sugerida es editable y se mantiene la hora elegida en Agenda."}</p>
    {collision && <section className="pantry-message" role="status"><p>Ya hay una comida en {feed.data.slots.find(slot => slot.id === destination.slotId)?.name} el {destination.date}: <strong>{collision.title}</strong>.</p>
      {collision.completedAt ? <p>Está completada. <Link prefetch={false} href={`/cocina/planificar?${new URLSearchParams({meal:collision.id})}`}>Verla en Planificar</Link>; deshazla antes de añadir recetas.</p>
        : <><p>Puedes abrirla para añadir recetas. Se conservarán su horario, porciones y pasos; lo escrito en este formulario se descartará.</p><button type="button" className="core-text-button" disabled={feed.locked} onClick={() => reload(destination.date, collision.id)}>Abrir comida existente</button></>}
    </section>}
    {checking && <p role="status">Revisando si esa celda está ocupada…</p>}
    {cellError && <p className="pantry-error" role="alert">{cellError} <button type="button" className="core-text-button" disabled={feed.locked} onClick={() => setReview(current => current+1)}>Revisar de nuevo</button></p>}
    <MealEditor value={value} feed={feed} embedded onDestinationChange={onDestinationChange} blocked={checking || !!cellError || !!collision}
      beforeSave={() => !checking && !cellError && !collision} close={() => { if (!feed.busy && !feed.retry) close(); }} saved={() => saved(destination.date)}
      reload={() => { if (value.meal && window.confirm("¿Descartar los cambios y cargar la comida actual?")) reload(value.meal.date,value.meal.id); }} />
  </>;
}
