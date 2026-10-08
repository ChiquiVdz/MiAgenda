"use client";
import { coreFetch, localMode, refreshLocalCopy } from "./local-data";
import { useContext, useState } from "react";
import { CoreDialog, CoreFeedback, type CalendarView } from "./schedule-editor";
import type { Mutate } from "./use-core-feed";
type Impact = { dataRevision: string; revision: number; scheduledCount: number; scheduledStepCount: number; deleteCount: number; dependentCount: number; outsideParents: number; seriesCount: number };
export function CalendarEditor({ calendar, calendars, disabled, mutate, close }: { calendar: CalendarView; calendars: CalendarView[]; disabled: boolean; mutate: Mutate; close: () => void }) {
  const [name, setName] = useState(calendar.name), [color, setColor] = useState(calendar.color);
  const [impact, setImpact] = useState<Impact | null>(null), [destination, setDestination] = useState("");
  const [error, setError] = useState<string | null>(null), [loading, setLoading] = useState(false), [confirmed, setConfirmed] = useState(false);
  const feedback = useContext(CoreFeedback);
  async function review() {
    setLoading(true); setImpact(null); setConfirmed(false); setError(null);
    try {
      const response = await coreFetch(`/api/core?view=calendarImpact&id=${calendar.id}`, { cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "No pudimos revisar el alcance."); setImpact(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos revisar el alcance."); }
    finally { setLoading(false); }
  }
  const locked = disabled || loading;
  return <CoreDialog title={`Calendario: ${calendar.name}`} close={() => { if (!locked) close(); }}>
    {feedback.error && <p role="alert" className="pantry-error">{feedback.error} {feedback.retry && <button disabled={feedback.busy} className="core-text-button" onClick={feedback.reattempt}>Reintentar cambio</button>}</p>}
    {error && <p role="alert" className="pantry-error">{error}</p>}
    <form className="core-edit-form" onSubmit={event => { event.preventDefault(); void mutate({ action: "editCalendar", id: calendar.id, expectedRevision: calendar.revision, name: name.trim(), color }, close); }}>
      <label className="form-field">Nombre<input required maxLength={120} disabled={locked} value={name} onChange={event => setName(event.target.value)} /></label>
      <label className="form-field">Color<input type="color" disabled={locked} value={color} onChange={event => setColor(event.target.value)} /></label>
      <button className="pantry-add-button" disabled={locked || !name.trim() || (name.trim() === calendar.name && color === calendar.color)}>Guardar cambios</button>
    </form>
    {calendar.moduleKey ? <p>La estructura está protegida porque pertenece a un módulo.</p> : <div className="core-edit-form">
      <button type="button" className="core-text-button" disabled={locked} onClick={() => void review()}>{loading ? "Revisando…" : impact ? "Actualizar alcance de borrado" : "Eliminar calendario…"}</button>
      {impact && <>
        <p>En todas las fechas hay {impact.scheduledCount} actividades guardadas y {impact.seriesCount} series recurrentes en este calendario. Las series incluyen sus repeticiones futuras. Hay además {impact.scheduledStepCount} subtareas con horario recurrente en este calendario.</p>
        {(impact.scheduledCount > 0 || impact.seriesCount > 0 || impact.scheduledStepCount > 0) && <label className="form-field">Contenido<select disabled={locked} value={destination} onChange={event => { setDestination(event.target.value); setConfirmed(false); }}><option value="">Borrar contenido</option>{calendars.filter(item => item.id !== calendar.id).map(item => <option key={item.id} value={item.id}>Trasladar a {item.name}</option>)}</select></label>}
        {destination ? <p>Trasladar {impact.scheduledCount} actividades y {impact.seriesCount} series conservando horarios, progreso y relaciones. Los hijos de otros calendarios permanecen allí.</p> : <p>Cancelar {impact.seriesCount} series y borrar {impact.deleteCount} actividades, incluidas {impact.dependentCount} actividades dependientes fuera de este calendario o sin horario. Se conservan {impact.outsideParents} principales externas y se recalcula su progreso. Se retiran también las definiciones de las subtareas programadas en este calendario para sus futuras repeticiones. No se puede deshacer.</p>}
        <label className="core-check"><input type="checkbox" disabled={locked} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />Confirmo el alcance y eliminar el calendario</label>
        <button type="button" className="pantry-add-button" disabled={locked || !confirmed} onClick={() => void mutate({ action: "deleteCalendar", id: calendar.id, expectedRevision: impact.revision, expectedDataRevision: impact.dataRevision, destinationId: destination || null }, close)}>{destination ? "Trasladar y eliminar" : "Eliminar calendario y contenido"}</button>
      </>}
    </div>}
  </CoreDialog>;
}
