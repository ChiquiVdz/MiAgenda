"use client";
import { useMobileLayout } from "../core/use-mobile-layout";

import { useMemo, useState, type CSSProperties } from "react";
import { eventsForDays } from "@/lib/calendar-display";

type MonthEvent = {
  id: string; calendarId: string; calendarName: string; summary: string; color: string | null;
  startDate: string | null; endDate: string | null; startDateTime: string | null; endDateTime: string | null;
  overlay: { completedAt: string | null; highlighted?: boolean } | null;
  progress?: { done: number; total: number } | null;
};
const daysOfWeek = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
function key(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
const timeFormatter = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", hour: "numeric", minute: "2-digit" });
const dayFormatter = new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "long", year: "numeric" });
const time = (value: string) => timeFormatter.format(new Date(value));

export function MonthAgenda<T extends MonthEvent>({ days, month, today, events, canCreate, loading, error, onRetry, onCreate, onOpen, onWeek, createLabel = "Crear tarea o comida" }: {
  days: Date[]; month: number; today: string; events: T[]; canCreate: boolean; loading: boolean; error: string | null;
  onRetry: () => void; onCreate: (date: string) => void; onOpen: (event: T) => void; onWeek: (date: Date) => void;
  createLabel?: string;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const grouped = useMemo(() => {
    const result = eventsForDays(days, events);
    for (const items of result.values()) items.sort((a, b) => Number(Boolean(b.startDate)) - Number(Boolean(a.startDate)) || (a.startDateTime ?? a.startDate ?? "").localeCompare(b.startDateTime ?? b.startDate ?? "") || a.summary.localeCompare(b.summary));
    return result;
  }, [days, events]);
  const mobile = useMobileLayout(), visibleCount = mobile ? 2 : 3;
  const weeks = Array.from({ length: days.length / 7 }, (_, row) => days.slice(row * 7, row * 7 + 7));
  return <section className="month-agenda" aria-label="Agenda mensual" aria-busy={loading}>
    {loading && <p className="month-status" role="status">Actualizando el mes…</p>}
    {error && <p className="form-error month-status" role="alert">{error} <button type="button" onClick={onRetry}>Reintentar</button></p>}
    <div className="month-scroll"><div className="month-grid">
      <div className="month-headings"><span className="month-week-heading">Semana</span>{daysOfWeek.map((day) => <span key={day}>{day}</span>)}</div>
      {weeks.map((week) => <div className="month-week" key={key(week[0])}>
        <button className="month-week-link" type="button" aria-label={`Ver semana del ${key(week[0])}`} onClick={() => onWeek(week[0])}><span>Ver</span><span>semana</span><span aria-hidden="true">›</span></button>
        {week.map((day) => {
          const date = key(day);
          const start = Date.parse(`${date}T00:00:00-06:00`);
          const items = grouped.get(date) ?? [];
          const shown = expanded[date] ? items : items.slice(0, visibleCount);
          const label = dayFormatter.format(day);
          return <div className={`month-day${day.getMonth() !== month ? " month-day-outside" : ""}${date === today ? " month-day-today" : ""}`} key={date}>
            <button className="month-create-area" type="button" disabled={!canCreate} aria-label={`${createLabel} el ${label}`} title={createLabel} onClick={() => onCreate(date)} />
            <div className="month-day-heading"><span className="month-day-number" aria-label={`${label}${date === today ? ", hoy" : ""}`}>{day.getDate()}</span><button className="month-add" type="button" disabled={!canCreate} aria-label={`${createLabel} el ${label}`} title={createLabel} onClick={() => onCreate(date)}>＋</button></div>
            <div className="month-event-list">{shown.map((event) => <button className={`month-event${event.startDate ? " month-event-all-day" : ""}${event.overlay?.completedAt ? " month-event-completed" : ""}`} style={{ "--event-color": event.color ?? "#78947d" } as CSSProperties} type="button" key={`${event.calendarId}:${event.id}`}
              title={`${event.summary} · ${event.calendarName}${event.startDateTime ? ` · ${time(event.startDateTime)}` : " · Todo el día"}`} onClick={() => onOpen(event)}>
              {event.startDateTime && <span className="month-event-time">{Date.parse(event.startDateTime) < start ? "↤" : time(event.startDateTime)}</span>}<span className="month-event-title">{event.overlay?.highlighted ? "★ " : ""}{event.overlay?.completedAt ? "✓ " : ""}{event.summary}</span>{event.progress && <span className="month-event-progress">{event.progress.done}/{event.progress.total}</span>}
            </button>)}
            {items.length > visibleCount && <button className="month-more" type="button" aria-expanded={Boolean(expanded[date])} onClick={() => setExpanded((current) => ({ ...current, [date]: !current[date] }))}>{expanded[date] ? "Ver menos" : `+${items.length - visibleCount} más`}</button>}</div>
          </div>;
        })}
      </div>)}
    </div></div>
  </section>;
}
