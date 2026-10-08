"use client";

import { monthDays } from "@/lib/calendar-month";
import { useMemo } from "react";
import { eventsForDays } from "@/lib/calendar-display";

type HighlightEvent = {
  id: string; calendarId: string; summary: string; calendarName: string; color: string | null;
  startDate: string | null; endDate: string | null; startDateTime: string | null; endDateTime: string | null;
};
const weekdays = ["D", "L", "M", "M", "J", "V", "S"];
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
const monthFormatter = new Intl.DateTimeFormat("es-MX", { month: "long" });
const highlightFormatter = new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short" });
export function YearAgenda<T extends HighlightEvent>({ year, today, events, loading, error, showTitles = true, suppressEmpty = false, onRetry, onMonth, onOpen }: {
  year: number; today: string; events: T[]; loading: boolean; error: string | null; showTitles?: boolean; suppressEmpty?: boolean;
  onRetry: () => void; onMonth: (date: Date) => void; onOpen: (event: T) => void;
}) {
  const months = useMemo(() => {
    const grids = Array.from({ length: 12 }, (_, month) => {
      const first = new Date(year, month, 1, 12);
      return { first, name: monthFormatter.format(first), days: monthDays(first) };
    });
    const grouped = eventsForDays(grids.flatMap(grid => grid.days), events);
    for (const items of grouped.values()) items.sort((a, b) => (a.startDateTime ?? a.startDate ?? "").localeCompare(b.startDateTime ?? b.startDate ?? "") || a.summary.localeCompare(b.summary));
    return grids.map((grid, month) => ({ ...grid, grouped,
      highlighted: [...new Set(grid.days.filter(day => day.getMonth() === month).flatMap(day => grouped.get(dateKey(day)) ?? []))]
        .sort((a, b) => (a.startDateTime ?? a.startDate ?? "").localeCompare(b.startDateTime ?? b.startDate ?? "") || a.summary.localeCompare(b.summary)) }));
  }, [year, events]);
  return <section className="year-agenda" aria-label={`Agenda del año ${year}`} aria-busy={loading}>
    {loading && <p className="form-hint" role="status">Cargando eventos destacados…</p>}
    {error && <p className="form-error" role="alert">{error} <button type="button" onClick={onRetry}>Reintentar</button></p>}
    <div className="year-months">{months.map(({ first, name, days, highlighted, grouped }, month) => {
      return <section className="year-month" key={month} aria-label={`${name} de ${year}`}>
        <h2><button type="button" onClick={() => onMonth(first)}>{name}</button></h2>
        <div className="year-days">{weekdays.map((day, index) => <span className="year-weekday" key={index}>{day}</span>)}
          {days.map((day) => {
            if (day.getMonth() !== month) return <span aria-hidden="true" key={dateKey(day)} />;
            const key = dateKey(day); const items = grouped.get(key) ?? [];
            return <button className={`year-day${key === today ? " year-day-today" : ""}${items.length ? " year-day-highlighted" : ""}`} type="button" key={key}
              aria-label={`${key}${key === today ? ", hoy" : ""}${items.length ? `, ${items.length} destacados` : ""}. Abrir mes`} title={items.length ? items.map((event) => event.summary).join(" · ") : "Abrir mes"} onClick={() => onMonth(day)}>{day.getDate()}{items.length > 0 && <span className="year-highlight-dot" aria-hidden="true" />}</button>;
          })}
        </div>
        {showTitles && highlighted.length > 0 && <ul className="year-highlight-list">{highlighted.map((event) => <li key={`${event.calendarId}:${event.id}`}><button type="button" onClick={() => onOpen(event)} title={`${event.summary} · ${event.calendarName}`}><span className="year-highlight-color" style={{ background: event.color ?? "#78947d" }} />
          <span><strong>{event.summary}</strong><small>{event.startDate ?? (event.startDateTime ? highlightFormatter.format(new Date(event.startDateTime)) : "")} · {event.calendarName}</small></span></button></li>)}</ul>}
      </section>;
    })}</div>
    {!loading && !error && !suppressEmpty && events.length === 0 && <p className="form-hint">No hay eventos destacados en tus calendarios visibles para este año.</p>}
  </section>;
}
