"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ScheduleInput } from "../../../reconstruction/core/src/contracts";
import { atTime, dateParts, labelDate, plusDays } from "./dates";
import type { CalendarView } from "./schedule-editor";
import { TimePicker } from "../components/time-picker";
import { RecurrenceFields } from "./recurrence-fields";
import { parseRecurrence, type RecurrenceRule } from "../../../reconstruction/core/src/recurrence";
import { CalendarPicker, type CreateCalendarInline } from "./calendar-picker";

export type WeekDraftSchedule = Extract<ScheduleInput, { mode: "timed" }>;

/** Nonmodal editor: the calendar remains interactive; nothing persists until Save. */
export function WeekCreatePopover({ schedule, title, calendars, scroll, disabled, error, retry, busy, reattempt, changeTitle, changeSchedule, close, meal, save, createCalendar, previewAllDay }: {
  schedule: WeekDraftSchedule; title: string; calendars: CalendarView[]; scroll: RefObject<HTMLDivElement | null>;
  disabled: boolean; error: string | null; retry: boolean; busy: boolean; reattempt: () => void;
  changeTitle: (value: string) => void; changeSchedule: (value: WeekDraftSchedule) => void;
  close: () => void; meal: () => void; save: (schedule: ScheduleInput, rule?: RecurrenceRule) => void;
  createCalendar: CreateCalendarInline; previewAllDay: (range: { startDate: string; endDate: string } | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null), name = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 16, top: 100 }), [mounted, setMounted] = useState(false);
  const [inputError, setInputError] = useState<string | null>(null);
  const [addingCalendar, setAddingCalendar] = useState(false);
  const start = dateParts(schedule.startsAt, schedule.timeZone), end = dateParts(schedule.endsAt, schedule.timeZone);
  const [allDay, setAllDay] = useState(false), [lastDay, setLastDay] = useState<string | null>(null), [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const finalDay = !lastDay || lastDay < start.date ? start.date : lastDay;
  useEffect(() => { previewAllDay(allDay ? { startDate: start.date, endDate: plusDays(finalDay, 1) } : null); }, [allDay, start.date, finalDay, previewAllDay]);
  useEffect(() => () => previewAllDay(null), [previewAllDay]);
  useEffect(() => { setMounted(true); name.current?.focus(); }, []);
  useEffect(() => { if (mounted) name.current?.focus(); }, [mounted]);
  useEffect(() => {
    if (!mounted) return;
    let frame = 0;
    const resumeTyping = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !scroll.current?.contains(event.target)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (!document.querySelector("dialog[open]") && !name.current?.disabled) name.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener("pointerup", resumeTyping);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("pointerup", resumeTyping); };
  }, [mounted, scroll]);
  useLayoutEffect(() => {
    function place() {
      const target = scroll.current?.querySelector<HTMLElement>(`[data-draft-date="${start.date}"]`) ?? scroll.current?.querySelector<HTMLElement>(".core-week-draft");
      const rect = target?.getBoundingClientRect(), size = box.current?.getBoundingClientRect();
      if (!rect || !size) return;
      const left = rect.right + 12 + size.width <= window.innerWidth - 12 ? rect.right + 12 : rect.left - size.width - 12;
      setPosition({ left: Math.max(12, Math.min(left, window.innerWidth - size.width - 12)), top: Math.max(12, Math.min(rect.top, window.innerHeight - size.height - 12)) });
    }
    place(); const container = scroll.current;
    const observer = new ResizeObserver(place); if (box.current) observer.observe(box.current);
    container?.addEventListener("scroll", place, { passive: true }); window.addEventListener("resize", place);
    return () => { observer.disconnect(); container?.removeEventListener("scroll", place); window.removeEventListener("resize", place); };
  }, [scroll, schedule.startsAt, schedule.endsAt, mounted, error, inputError]);
  function changeStart(date: string, time: string) {
    try {
      const startsAt = atTime(date, time, schedule.timeZone);
      changeSchedule({ ...schedule, startsAt, endsAt: new Date(Date.parse(startsAt) + Date.parse(schedule.endsAt) - Date.parse(schedule.startsAt)).toISOString() });
      setInputError(null);
    } catch { setInputError("Revisa la fecha y hora de inicio."); }
  }
  function changeEnd(date: string, time: string) {
    try {
      const endsAt = atTime(date, time, schedule.timeZone);
      if (endsAt <= schedule.startsAt) throw new Error();
      changeSchedule({ ...schedule, endsAt }); setInputError(null);
    } catch { setInputError("El fin debe ser posterior al inicio."); }
  }
  if (!mounted) return null;
  return createPortal(<div ref={box} className="core-create-popover" role="dialog" aria-modal="false" aria-label="Crear actividad" style={position}>
    <div className="core-create-popover-heading"><span>Nueva actividad</span><button type="button" className="core-text-button" aria-label="Cerrar y descartar" disabled={busy} onClick={close}>×</button></div>
    <form onSubmit={event => {
      event.preventDefault(); if (disabled || addingCalendar || !title.trim() || !schedule.calendarId || (!allDay && inputError)) return;
      try { const rule = recurrence ? parseRecurrence(recurrence, start.date) : undefined;
        save(allDay ? { mode: "allDay", calendarId: schedule.calendarId, timeZone: schedule.timeZone, startDate: start.date, endDate: plusDays(finalDay, 1) } : schedule, rule);
      } catch (cause) { setInputError(cause instanceof Error ? cause.message : "Revisa la repetición."); }
    }}>
      <input ref={name} className="core-create-title" aria-label="Nombre de la actividad" placeholder="Agregar nombre" required maxLength={250} value={title} disabled={disabled} onChange={event => changeTitle(event.target.value)} />
      <div className="core-create-types"><button type="button" className="core-create-type-active" aria-pressed="true">Tarea</button><button type="button" disabled={disabled} onClick={meal}>Comida</button></div>
      <label className="core-create-date-label" title="Cambiar fecha"><span aria-hidden="true">{labelDate(start.date, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</span><span aria-hidden="true">▾</span><input type="date" required aria-label="Fecha de inicio" value={start.date} disabled={disabled}
        onClick={event => { try { event.currentTarget.showPicker(); } catch { /* The native date field remains available. */ } }}
        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); try { event.currentTarget.showPicker(); } catch {} } }}
        onChange={event => { if (event.target.value) changeStart(event.target.value, start.time); }} /></label>
      <label className="core-check core-create-all-day"><input type="checkbox" disabled={disabled} checked={allDay} onChange={event => { setAllDay(event.target.checked); setInputError(null); }} />Todo el día</label>
      {!allDay && <div className="core-create-time-row"><TimePicker label="Inicio" value={start.time} disabled={disabled} onChange={time => changeStart(start.date, time)} /><TimePicker label="Fin" value={end.time} disabled={disabled} onChange={time => changeEnd(end.date, time)} /></div>}
      {!allDay && end.date !== start.date && <small className="core-muted">Termina el {labelDate(end.date)}</small>}
      {allDay && <label className="form-field">Último día<input type="date" required min={start.date} value={finalDay} disabled={disabled} onChange={event => setLastDay(event.target.value || null)} /></label>}
      <CalendarPicker calendars={calendars} value={schedule.calendarId} disabled={disabled} change={calendarId => changeSchedule({ ...schedule, calendarId })} create={createCalendar} onAddingChange={setAddingCalendar} />
      <RecurrenceFields value={recurrence} change={value => { setRecurrence(value); setInputError(null); }} startDate={start.date} disabled={disabled} />
      {(error || inputError) && <p className="pantry-error" role="alert">{error || inputError}</p>}
      {retry && <button type="button" className="core-text-button" disabled={busy} onClick={reattempt}>Reintentar guardado</button>}
      <div className="core-create-actions"><button className="pantry-add-button" type="submit" disabled={disabled || addingCalendar || !title.trim() || !schedule.calendarId || (!allDay && !!inputError)}>Guardar</button></div>
    </form>
  </div>, document.body);
}
