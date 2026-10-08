"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import type { ScheduleInput, SeriesScope } from "../../../reconstruction/core/src/contracts";
import { dateParts, atTime, plusDays, ZONE } from "./dates";
import type { Mutate } from "./use-core-feed";
import { TimePicker } from "../components/time-picker";
import { RecurrenceFields } from "./recurrence-fields";
import { parseRecurrence, type RecurrenceRule } from "../../../reconstruction/core/src/recurrence";
import { ActivityPopover } from "./activity-popover";
import { CalendarPicker, type CreateCalendarInline } from "./calendar-picker";

export type CalendarView = { id: string; name: string; color: string; revision: number; visible: boolean; moduleKey: string | null; position: number };
export type ScheduledItem = ActivityView | ActivityView["children"][number];
export const CoreFeedback = createContext<{ error: string | null; retry: boolean; busy: boolean; reattempt: () => void }>({ error: null, retry: false, busy: false, reattempt() {} });
export function CoreDialog({ title, close, children, nonmodal = false, anchor, dismissOutside = true, popoverClassName, busy = false, inline = false }: { title: string; close: () => void; children: ReactNode; nonmodal?: boolean; anchor?: HTMLElement; dismissOutside?: boolean; popoverClassName?: string; busy?: boolean; inline?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const beside = nonmodal && !!anchor;
  useEffect(() => { if (beside || inline) return; const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, [beside, inline]);
  if (inline) return <section className="core-inline-panel" aria-label={title}><div className="core-dialog-heading"><h3>{title}</h3><button type="button" className="core-text-button" aria-label={`Cerrar ${title}`} disabled={busy} onClick={close}>×</button></div>{children}</section>;
  if (beside) return <ActivityPopover anchor={anchor!} title={title} close={close} busy={busy} dismissOutside={dismissOutside} className={popoverClassName}>{children}</ActivityPopover>;
  return <dialog className="event-dialog core-dialog" ref={ref} onCancel={event => { event.preventDefault(); close(); }} aria-label={title}>
    <div className="core-dialog-heading"><h2>{title}</h2><button type="button" className="core-text-button" aria-label="Cerrar" onClick={close}>×</button></div>{children}</dialog>;
}
export function ScheduleFields({ initial, calendars, defaultDate, defaultTime, duration = 60, onSave, disabled, allowRecurrence = false, allowAllDay = true, createCalendar, fixedCalendarId, preparation = false }: {
  initial?: ScheduledItem["schedule"]; calendars: Pick<CalendarView, "id" | "name">[]; defaultDate?: string; defaultTime?: string; duration?: number;
  onSave: (schedule: ScheduleInput, recurrence?: RecurrenceRule) => void; disabled: boolean; allowRecurrence?: boolean; allowAllDay?: boolean;
  createCalendar?: CreateCalendarInline; fixedCalendarId?: string; preparation?: boolean;
}) {
  const zone = initial?.timeZone ?? ZONE;
  const now = new Date(Math.ceil(Date.now() / 900000) * 900000);
  const start = initial?.startsAt ? dateParts(initial.startsAt, zone) : { ...dateParts(now, zone), ...(defaultDate ? { date: defaultDate } : {}), ...(defaultTime ? { time: defaultTime } : {}) };
  const end = initial?.endsAt ? dateParts(initial.endsAt, zone) : dateParts(new Date(new Date(atTime(start.date, start.time, zone)).getTime() + duration * 60000), zone);
  const [calendar, setCalendar] = useState(fixedCalendarId ?? initial?.calendarId ?? calendars[0]?.id ?? "");
  const [allDay, setAllDay] = useState(initial?.mode === "allDay");
  const [preparationMinutes, setPreparationMinutes] = useState(initial?.startsAt && initial.endsAt ? (Date.parse(initial.endsAt) - Date.parse(initial.startsAt)) / 60000 : duration);
  const [startDate, setStartDate] = useState(initial?.startDate ?? start.date), [startTime, setStartTime] = useState(start.time);
  const [endDate, setEndDate] = useState(initial?.endDate ? plusDays(initial.endDate, -1) : end.date), [endTime, setEndTime] = useState(end.time);
  const [error, setError] = useState<string | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const [addingCalendar, setAddingCalendar] = useState(false);
  function changeStart(date: string, time: string) {
    try {
      const previous = new Date(atTime(startDate, startTime, zone)).getTime();
      const finish = new Date(atTime(endDate, endTime, zone)).getTime();
      const next = dateParts(new Date(new Date(atTime(date, time, zone)).getTime() + Math.max(900000, finish - previous)), zone);
      setStartDate(date); setStartTime(time); setEndDate(allDay ? date : next.date); setEndTime(next.time); setError(null);
    } catch { setError("Revisa la fecha y hora de inicio."); }
  }
  return <form className="core-edit-form" onSubmit={event => {
    event.preventDefault(); setError(null);
    if (addingCalendar || disabled) return;
    try {
      const rule = allowRecurrence && recurrence ? parseRecurrence(recurrence, startDate) : undefined;
      if (allDay) {
        if (endDate < startDate) throw new Error("El último día no puede ser anterior al inicio.");
        onSave({ calendarId: fixedCalendarId ?? calendar, timeZone: zone, mode: "allDay", startDate, endDate: plusDays(endDate, 1) }, rule);
      } else {
        if (+startTime.slice(3) % 15 || (!preparation && +endTime.slice(3) % 15)) throw new Error("Usa horarios en intervalos de 15 minutos.");
        if (preparation && (!Number.isInteger(preparationMinutes) || preparationMinutes < 1 || preparationMinutes > 1440)) throw new Error("La duración debe ser de 1 a 1440 minutos.");
        const startsAt = atTime(startDate, startTime, zone), endsAt = preparation ? new Date(Date.parse(startsAt) + preparationMinutes * 60000).toISOString() : atTime(endDate, endTime, zone);
        if (startsAt >= endsAt) throw new Error("El fin debe ser posterior al inicio.");
        onSave({ calendarId: fixedCalendarId ?? calendar, timeZone: zone, mode: "timed", startsAt, endsAt }, rule);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Revisa el horario."); }
  }}>
    {fixedCalendarId ? <small className="core-muted">Calendario de la principal: {calendars.find(value => value.id === fixedCalendarId)?.name ?? "Calendario actual"}</small> : <CalendarPicker calendars={calendars} value={calendar} change={setCalendar} disabled={disabled} create={createCalendar} onAddingChange={setAddingCalendar} />}
    {allowAllDay && <label className="core-check"><input type="checkbox" disabled={disabled} checked={allDay} onChange={event => setAllDay(event.target.checked)} />Todo el día</label>}
    <div className="core-date-fields"><label className="form-field">Inicio<input required type="date" disabled={disabled} value={startDate} onChange={event => changeStart(event.target.value, startTime)} /></label>
      {!allDay && <TimePicker label="Hora de inicio" disabled={disabled} value={startTime} onChange={time => changeStart(startDate, time)} />}
      {preparation ? <label className="form-field">Duración (minutos)<input type="number" required min={1} max={1440} step={1} disabled={disabled} value={preparationMinutes} onChange={event => setPreparationMinutes(Number(event.target.value))} /></label> : <label className="form-field">{allDay ? "Último día" : "Fin"}<input required type="date" disabled={disabled} min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label>}
      {!allDay && !preparation && <TimePicker label="Hora de fin" disabled={disabled} value={endTime} onChange={setEndTime} />}</div>
    <small className="core-muted">Zona horaria: {zone}</small>{error && <p role="alert" className="pantry-error">{error}</p>}
    {allowRecurrence && <RecurrenceFields value={recurrence} change={setRecurrence} startDate={startDate} disabled={disabled} />}
    <button type="submit" className="pantry-add-button" disabled={disabled || addingCalendar || !calendar}>Guardar horario</button>
  </form>;
}
export function ScheduleButton({ item, calendars, disabled, mutate, parentCalendarId, parentDate, inline = false, iconOnly = false }: {
  item: ScheduledItem; calendars: CalendarView[]; disabled: boolean; mutate: Mutate; parentCalendarId?: string; parentDate?: string; inline?: boolean; iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false), [editRevision, setEditRevision] = useState(item.revision);
  const [scope,setScope]=useState<SeriesScope>("this");
  const recurringChild=!!item.parentId && !!item.recurrence;
  const scopeFields=recurringChild?{scope,...(scope!=="this"?{expectedSeriesRevision:item.recurrence!.seriesRevision}:{})}:{};
  const feedback = useContext(CoreFeedback);
  const fixedCalendarId = item.parentId ? parentCalendarId ?? item.parentCalendarId : undefined;
  const choices = fixedCalendarId ? calendars.filter(value => value.id === fixedCalendarId) : calendars;
  // A module can expose its own calendar without downloading the full catalog.
  // Its existing schedule/parent supplies the ID; ownership is checked by the API.
  const currentCalendarId = fixedCalendarId ?? item.schedule?.calendarId;
  const scheduleChoices = choices.length ? choices : currentCalendarId
    ? [{ id: currentCalendarId, name: item.mealRole === "priorReminder" ? "Cocina" : "Calendario actual" }] : [];
  const label = `${item.schedule ? "Cambiar horario de" : "Agendar"} ${item.title}`;
  return <><button className={`core-text-button${iconOnly ? " core-icon-button" : ""}`} type="button" disabled={disabled} aria-label={label} title={label} onClick={() => { setEditRevision(item.revision); setScope("this"); setOpen(true); }}>{iconOnly ? <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg> : item.schedule ? "Cambiar horario" : "Agendar"}</button>
    {open && <CoreDialog inline={inline} busy={feedback.busy} title={`Horario · ${item.title}`} close={() => { if (!feedback.busy) setOpen(false); }}>
      {feedback.error && <p className="pantry-error" role="alert">{feedback.error} {feedback.retry && <button className="core-text-button" disabled={feedback.busy} onClick={feedback.reattempt}>Reintentar cambio</button>}</p>}
      {recurringChild&&<><label className="form-field">Aplicar horario a<select disabled={disabled} value={scope} onChange={event=>setScope(event.target.value as SeriesScope)}><option value="this">Solo esta</option><option value="following">Esta y las siguientes</option><option value="all">Toda la serie</option></select></label>{scope!=="this"&&<p className="core-muted">La fecha elegida indica el mismo día de su principal, o cuántos días antes o después. Se conserva la hora en las repeticiones futuras; se omiten las subtareas completadas y las eliminadas. No se mueven otras actividades.</p>}</>}
      <ScheduleFields preparation={item.mealRole === "priorReminder" || !!item.mealPriorGroup} defaultDate={parentDate??item.recurrence?.originalDate} initial={item.schedule} fixedCalendarId={fixedCalendarId} calendars={scheduleChoices} duration={item.mealRole === "priorReminder" || item.mealPriorGroup ? 5 : item.parentId ? 15 : 60} allowAllDay={item.mealRole !== "priorReminder" && !item.mealPriorGroup} disabled={disabled} onSave={schedule => {
        void mutate({ action: "scheduleTask", id: item.id, expectedRevision: editRevision, schedule, ...scopeFields }, () => setOpen(false));
      }} />
      {item.schedule && <button className="core-text-button core-unschedule" type="button" disabled={disabled} onClick={() => {
        if ((!item.keep && !item.highlighted) || window.confirm("Quitar el horario también desactiva Conservar y Destacar. Se mantienen la tarea y su progreso. ¿Continuar?"))
          void mutate({ action: "unscheduleTask", id: item.id, expectedRevision: editRevision, ...scopeFields }, () => setOpen(false));
      }}>Quitar horario</button>}
    </CoreDialog>}
  </>;
}
const scheduleFormatters = new Map<string, { start: Intl.DateTimeFormat; end: Intl.DateTimeFormat }>();
export function scheduleLabel(item: ScheduledItem) {
  const schedule = item.schedule;
  if (!schedule) return "";
  if (schedule.mode === "allDay") return `${schedule.startDate} · Todo el día`;
  let format = scheduleFormatters.get(schedule.timeZone);
  if (!format) {
    format = { start: new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: schedule.timeZone }),
      end: new Intl.DateTimeFormat("es-MX", { timeStyle: "short", timeZone: schedule.timeZone }) };
    if (scheduleFormatters.size >= 16) scheduleFormatters.clear();
    scheduleFormatters.set(schedule.timeZone, format);
  }
  return `${format.start.format(new Date(schedule.startsAt!))} – ${format.end.format(new Date(schedule.endsAt!))}`;
}
