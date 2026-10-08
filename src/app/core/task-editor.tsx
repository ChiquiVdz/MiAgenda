"use client";
import { coreFetch, localMode, refreshLocalCopy } from "./local-data";
import { useContext, useEffect, useState } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import { parseSchedule, type ScheduleInput, type SeriesScope } from "../../../reconstruction/core/src/contracts";
import { parseRecurrence, type RecurrenceRule } from "../../../reconstruction/core/src/recurrence";
import { dateParts, atTime, plusDays, ZONE } from "./dates";
import { TimePicker } from "../components/time-picker";
import { RecurrenceFields } from "./recurrence-fields";
import { CoreFeedback, type CalendarView } from "./schedule-editor";
import type { Draft, Mutate } from "./use-core-feed";

type Info = { rule: RecurrenceRule; originalDate: string; anchorDate: string; seriesRevision: number; dataRevision: string };
type Summary = { added: number; removed: number; preserved: number; effectiveDate: string };
export function TaskEditor({ item: liveItem, calendars, disabled, mutate, close, scopeControls, applyCompleted }: { item: ActivityView; calendars: CalendarView[]; disabled: boolean; mutate: Mutate; close: () => void; scopeControls: boolean; applyCompleted: () => void }) {
  // Keep all fields paired with the revision opened by the user.
  const [item] = useState(liveItem);
  const feedback = useContext(CoreFeedback);
  const zone = item.schedule?.timeZone ?? ZONE;
  const [initialStart] = useState(() => item.schedule?.startsAt ? dateParts(item.schedule.startsAt, zone) : { ...dateParts(new Date(Math.ceil(Date.now() / 900000) * 900000), zone), ...(item.schedule?.startDate ? { date: item.schedule.startDate } : item.recurrence?.originalDate ? {date:item.recurrence.originalDate} : {}) });
  const [initialEnd] = useState(() => item.schedule?.endsAt ? dateParts(item.schedule.endsAt, zone) : dateParts(new Date(Date.parse(atTime(initialStart.date, initialStart.time, zone)) + 3600000), zone));
  const [name, setName] = useState(item.title), [scheduled, setScheduled] = useState(!!item.schedule);
  const [calendar, setCalendar] = useState(item.parentCalendarId ?? item.schedule?.calendarId ?? calendars[0]?.id ?? ""), [allDay, setAllDay] = useState(item.schedule?.mode === "allDay");
  const [startDate, setStartDate] = useState(initialStart.date), [startTime, setStartTime] = useState(initialStart.time);
  const [endDate, setEndDate] = useState(item.schedule?.endDate ? plusDays(item.schedule.endDate, -1) : initialEnd.date), [endTime, setEndTime] = useState(initialEnd.time);
  const [scope, setScope] = useState<SeriesScope>("this"), [info, setInfo] = useState<Info | null>(null), [rule, setRule] = useState<RecurrenceRule | null>(null);
  const [reading, setReading] = useState(false), [error, setError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<{ summary: Summary; command: Draft } | null>(null);
  const recurrence = item.recurrence;
  useEffect(() => {
    if (!recurrence || item.parentId) return;
    const controller = new AbortController(); setReading(true);
    const query = new URLSearchParams({ view: "recurrence", seriesId: recurrence.seriesId, ordinal: String(recurrence.ordinal) });
    void coreFetch(`/api/core?${query}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const value = await response.json(); if (!response.ok) throw new Error(value.message ?? "No pudimos leer la repetición.");
      if (!controller.signal.aborted) { setInfo(value); setRule(value.rule); setPreview(null); setError(null); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos leer la repetición."); }).finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [recurrence, item.parentId, refresh]);
  function changeStart(date: string, time: string) {
    try {
      const duration = Math.max(900000, Date.parse(atTime(endDate, endTime, zone)) - Date.parse(atTime(startDate, startTime, zone)));
      const end = dateParts(new Date(Date.parse(atTime(date, time, zone)) + duration), zone);
      setStartDate(date); setStartTime(time); setEndDate(allDay ? date : end.date); setEndTime(end.time);
    } catch { setError("Revisa el inicio."); }
  }
  async function save() {
    if (disabled || reading) return;
    setError(null);
    try {
      if (preview) { await mutate(preview.command, close); return; }
      const title = name.trim(); if (!title) throw new Error("Escribe el nombre.");
      let schedule: ScheduleInput | null = null;
      if (scheduled) {
        if (!allDay && (+startTime.slice(3) % 15 || +endTime.slice(3) % 15)) throw new Error("Usa horarios en intervalos de 15 minutos.");
        schedule = parseSchedule(allDay ? { mode: "allDay", calendarId: item.parentCalendarId ?? calendar, timeZone: zone, startDate, endDate: plusDays(endDate, 1) } : { mode: "timed", calendarId: item.parentCalendarId ?? calendar, timeZone: zone, startsAt: atTime(startDate, startTime, zone), endsAt: atTime(endDate, endTime, zone) });
      }
      const original = item.schedule ? parseSchedule(item.schedule.mode === "timed" ? { mode: "timed", calendarId: item.schedule.calendarId, timeZone: zone, startsAt: item.schedule.startsAt, endsAt: item.schedule.endsAt } : { mode: "allDay", calendarId: item.schedule.calendarId, timeZone: zone, startDate: item.schedule.startDate, endDate: item.schedule.endDate }) : null;
      const scheduleChanged = JSON.stringify(schedule) !== JSON.stringify(original);
      const frequencyChanged = !!info && JSON.stringify(rule) !== JSON.stringify(info.rule);
      if (frequencyChanged && (!scheduled || !rule || scope === "this")) throw new Error("Elige esta y las siguientes o toda la serie para cambiar la repetición.");
      if (scheduleChanged && schedule === null && !item.parentId && scope !== "this") throw new Error("Quitar horario se aplica solo a esta instancia.");
      if (title === item.title && !scheduleChanged && !frequencyChanged) { close(); return; }
      const command: Draft = { action: "saveTask", id: item.id, expectedRevision: item.revision,
        ...(title !== item.title ? { title } : {}), ...(scheduleChanged ? { schedule } : {}),
        ...(recurrence ? { scope, ...(scope !== "this" ? { expectedSeriesRevision: info?.seriesRevision ?? recurrence.seriesRevision } : {}) } : {}),
        ...(frequencyChanged ? { frequency: { seriesId: recurrence!.seriesId, ordinal: recurrence!.ordinal, rule: parseRecurrence(rule!, scope === "all" ? info!.anchorDate : info!.originalDate), expectedDataRevision: info!.dataRevision } } : {}) };
      if (command.action === "saveTask" && command.frequency) {
        setReading(true);
        const query = new URLSearchParams({ view: "recurrencePreview", command: JSON.stringify({ action: "changeRecurrence", commandId: crypto.randomUUID(), id: item.id, expectedRevision: item.revision, scope, expectedSeriesRevision: info!.seriesRevision, ...command.frequency }) });
        const response = await coreFetch(`/api/core?${query}`, { cache: "no-store" }); const summary = await response.json();
        if (!response.ok) throw new Error(summary.message ?? "No pudimos revisar el cambio.");
        setPreview({ summary, command });
      } else await mutate(command, close);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Revisa los cambios."); }
    finally { setReading(false); }
  }
  const locked = disabled || reading;
  return <form className="core-edit-form core-task-editor" onSubmit={event => { event.preventDefault(); void save(); }} onChange={() => setPreview(null)}>
    <label className="form-field">Nombre<input autoFocus required maxLength={250} disabled={locked} value={name} onChange={event => setName(event.target.value)} /></label>
    <label className="core-check"><input type="checkbox" disabled={locked} checked={scheduled} onChange={event => setScheduled(event.target.checked)} />Con fecha y horario</label>
    {scheduled && <>
      {item.parentCalendarId ? <small className="core-muted">Calendario de la principal: {calendars.find(value => value.id === item.parentCalendarId)?.name ?? "Calendario actual"}</small> : <label className="form-field">Calendario<select required disabled={locked} value={calendar} onChange={event => setCalendar(event.target.value)}>{!calendar && <option value="">Elige calendario</option>}{calendars.map(value => <option key={value.id} value={value.id}>{value.name}</option>)}</select></label>}
      <label className="core-check"><input type="checkbox" disabled={locked} checked={allDay} onChange={event => setAllDay(event.target.checked)} />Todo el día</label>
      <div className="core-date-fields"><label className="form-field">Inicio<input type="date" required disabled={locked} value={startDate} onChange={event => changeStart(event.target.value, startTime)} /></label>{!allDay && <TimePicker label="Hora de inicio" disabled={locked} value={startTime} onChange={time => { setPreview(null); changeStart(startDate, time); }} />}
        <label className="form-field">{allDay ? "Último día" : "Fin"}<input type="date" required min={startDate} disabled={locked} value={endDate} onChange={event => setEndDate(event.target.value)} /></label>{!allDay && <TimePicker label="Hora de fin" disabled={locked} value={endTime} onChange={time => { setPreview(null); setEndTime(time); }} />}</div>
    </>}
    {!item.parentId && recurrence && info && <RecurrenceFields value={rule} change={value => { setRule(value); setPreview(null); if (scope === "this") setScope("following"); }} startDate={scope === "all" ? info.anchorDate : info.originalDate} disabled={locked || !scopeControls || !scheduled} allowNone={false} />}
    {recurrence && (scopeControls || !!item.parentId) && <label className="form-field">Aplicar cambios a<select disabled={locked} value={scope} onChange={event => setScope(event.target.value as SeriesScope)}><option value="this">Solo esta</option><option value="following">Esta y las siguientes</option><option value="all">Toda la serie</option></select></label>}
    {recurrence && item.parentId && scope!=="this" && <p className="core-muted">El horario se aplica relativo al día de cada principal. Las completadas conservan su horario; los pasos eliminados se omiten. Quitar horario conserva sus casillas.</p>}
    {preview && <section className="core-inline-panel" aria-label="Resumen de repetición"><p>Desde {preview.summary.effectiveDate}: {preview.summary.added} fechas nuevas, {preview.summary.removed} que dejan de repetirse y {preview.summary.preserved} instancias conservadas en los próximos ocho meses.</p><p>Las completadas, pasadas y modificadas se conservan. Los cambios de esta tarea se guardan juntos. Pulsa Guardar otra vez para confirmar.</p></section>}
    {reading && <small role="status">Revisando repetición…</small>}
    {(error || feedback.error) && <p className="pantry-error" role="alert">{error ?? feedback.error}</p>}
    {error && recurrence && <button type="button" className="core-text-button" disabled={locked} onClick={() => setRefresh(value => value + 1)}>Actualizar repetición</button>}
    <div className="core-row-actions"><button className="pantry-add-button" type="submit" disabled={locked || !name.trim()}>Guardar</button><button type="button" className="core-text-button" disabled={disabled} onClick={close}>Cancelar</button></div>
    {scopeControls && recurrence && <button type="button" className="core-text-button" disabled={locked} onClick={applyCompleted}>Aplicar completado…</button>}
  </form>;
}
