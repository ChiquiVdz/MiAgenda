"use client";

import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from "react";

const hours = Array.from({ length: 24 }, (_, index) => index);
const weekDays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const AGENDA_TIME_ZONE = "America/Mexico_City";
const HOUR_HEIGHT = 58;

type CalendarItem = {
  id: string;
  summary: string;
  color: string | null;
  primary: boolean;
  selected: boolean;
};

type AgendaEvent = {
  id: string;
  calendarId: string;
  calendarName: string;
  color: string | null;
  summary: string;
  startDate: string | null;
  endDate: string | null;
  startDateTime: string | null;
  endDateTime: string | null;
  recurringEventId: string | null;
  etag: string | null;
  overlay: { completedAt: string | null; keep: boolean; kind: "plain" | "app_task" | "meal" } | null;
};

type CreateEventDraft = {
  calendarId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  allDay: boolean;
};

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function agendaRange(days: Date[]) {
  if (days.length !== 7) return null;
  const endDate = new Date(days[0]);
  endDate.setDate(endDate.getDate() + 7);
  // La agenda ya muestra GMT−6 / America/Mexico_City.
  return {
    from: `${dateKey(days[0])}T00:00:00-06:00`,
    to: `${dateKey(endDate)}T00:00:00-06:00`,
  };
}

function zonedMinutes(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AGENDA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

function eventTimeLabel(event: AgendaEvent) {
  if (!event.startDateTime || !event.endDateTime) return "";
  const time = (value: string) => new Intl.DateTimeFormat("es-MX", {
    timeZone: AGENDA_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
  return `${time(event.startDateTime)} – ${time(event.endDateTime)}`;
}

function dateTimeInputs(value: string) {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: AGENDA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`,
  };
}

function dayWindow(date: Date) {
  const key = dateKey(date);
  const start = new Date(`${key}T00:00:00-06:00`);
  return { key, start: start.getTime(), end: start.getTime() + 24 * 60 * 60 * 1000 };
}

function addDaysToKey(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function minutesAfter(date: string, time: string, minutes: number) {
  const timestamp = new Date(`${date}T${time}:00-06:00`).getTime();
  return Number.isFinite(timestamp)
    ? dateTimeInputs(new Date(timestamp + minutes * 60_000).toISOString())
    : { date, time };
}

function draftDuration(draft: CreateEventDraft) {
  const start = new Date(`${draft.startDate}T${draft.startTime}:00-06:00`).getTime();
  const end = new Date(`${draft.endDate}T${draft.endTime}:00-06:00`).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? Math.max(1, Math.round((end - start) / 60_000))
    : 60;
}

function shiftDraftStart(draft: CreateEventDraft, startDate: string, startTime: string): CreateEventDraft {
  const duration = draftDuration(draft);
  const end = minutesAfter(startDate, startTime, duration);
  return { ...draft, startDate, startTime, endDate: end.date, endTime: end.time };
}

function setDraftEnd(draft: CreateEventDraft, endDate: string, endTime: string): CreateEventDraft {
  const start = new Date(`${draft.startDate}T${draft.startTime}:00-06:00`).getTime();
  const attemptedEnd = new Date(`${endDate}T${endTime}:00-06:00`).getTime();
  if (!Number.isFinite(attemptedEnd) || attemptedEnd > start) return { ...draft, endDate, endTime };
  const correctedEnd = minutesAfter(draft.startDate, draft.startTime, draftDuration(draft));
  return { ...draft, endDate: correctedEnd.date, endTime: correctedEnd.time };
}

function getWeek(date: Date) {
  const monday = new Date(date);
  const day = monday.getDay();
  monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
  monday.setHours(12, 0, 0, 0);
  return weekDays.map((_, index) => {
    const current = new Date(monday);
    current.setDate(monday.getDate() + index);
    return current;
  });
}

function formatDate(date: Date, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("es-MX", {
    ...options,
    timeZone: "America/Mexico_City",
  }).format(date);
}

export function AgendaView() {
  const [focusDate, setFocusDate] = useState<Date | null>(null);
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [calendarLoadState, setCalendarLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [calendarMessage, setCalendarMessage] = useState<string | null>(null);
  const [savingCalendarId, setSavingCalendarId] = useState<string | null>(null);
  const [calendarReload, setCalendarReload] = useState(0);
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [eventLoadState, setEventLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [eventLoadError, setEventLoadError] = useState<string | null>(null);
  const [eventReload, setEventReload] = useState(0);
  const [createEventOpen, setCreateEventOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<AgendaEvent | null>(null);
  const [deleteEventConfirm, setDeleteEventConfirm] = useState(false);
  const [createEventSaving, setCreateEventSaving] = useState(false);
  const [createEventError, setCreateEventError] = useState<string | null>(null);
  const [eventActionMessage, setEventActionMessage] = useState<string | null>(null);
  const [eventActionError, setEventActionError] = useState(false);
  const [savingEventActionKey, setSavingEventActionKey] = useState<string | null>(null);
  const [createEventDraft, setCreateEventDraft] = useState<CreateEventDraft>({
    calendarId: "", startDate: "", startTime: "09:00", endDate: "", endTime: "10:00", allDay: false,
  });

  useEffect(() => setFocusDate(new Date()), []);

  useEffect(() => {
    let cancelled = false;

    async function loadCalendars() {
      setCalendarLoadState("loading");
      setCalendarMessage(null);
      try {
        const response = await fetch("/api/calendars", { cache: "no-store" });
        const result = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(result?.calendars)) {
          throw new Error("No pudimos cargar tus calendarios de Google.");
        }
        if (!cancelled) {
          setCalendars(result.calendars as CalendarItem[]);
          setCalendarLoadState("ready");
        }
      } catch {
        if (!cancelled) setCalendarLoadState("error");
      }
    }

    void loadCalendars();
    return () => { cancelled = true; };
  }, [calendarReload]);

  const days = useMemo(() => (focusDate ? getWeek(focusDate) : []), [focusDate]);
  const range = useMemo(() => agendaRange(days), [days]);
  const selectedCalendarKey = calendars.filter((calendar) => calendar.selected).map((calendar) => calendar.id).sort().join("|");
  const weekLabel = days.length
    ? `${formatDate(days[0], { day: "numeric", month: "short" })} – ${formatDate(days[6], { day: "numeric", month: "short", year: "numeric" })}`
    : "Cargando semana…";

  useEffect(() => {
    if (!range || calendarLoadState !== "ready") return;
    let cancelled = false;

    async function loadEvents() {
      setEventLoadState("loading");
      setEventLoadError(null);
      try {
        const params = new URLSearchParams({ from: range!.from, to: range!.to });
        const response = await fetch(`/api/events?${params}`, { cache: "no-store" });
        const result = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(result?.events)) {
          throw new Error(typeof result?.error === "string" ? result.error : "No pudimos cargar los eventos.");
        }
        if (!cancelled) {
          setEvents(result.events as AgendaEvent[]);
          setEventLoadState("ready");
        }
      } catch (error) {
        if (!cancelled) {
          setEvents([]);
          setEventLoadError(error instanceof Error ? error.message : "No pudimos cargar los eventos de Google Calendar.");
          setEventLoadState("error");
        }
      }
    }

    void loadEvents();
    return () => { cancelled = true; };
  }, [range?.from, range?.to, calendarLoadState, selectedCalendarKey, eventReload]);

  useEffect(() => {
    if (calendarLoadState !== "ready") return;
    let lastRefreshAt = 0;
    const refreshIfVisible = () => {
      const now = Date.now();
      if (document.visibilityState === "visible" && now - lastRefreshAt > 2_000) {
        lastRefreshAt = now;
        setEventReload((current) => current + 1);
      }
    };
    const intervalId = window.setInterval(refreshIfVisible, 60_000);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [calendarLoadState]);

  function moveWeek(amount: number) {
    setFocusDate((current) => {
      const next = new Date(current ?? new Date());
      next.setDate(next.getDate() + amount * 7);
      return next;
    });
  }

  function openCreateEvent() {
    setEditingEvent(null);
    setDeleteEventConfirm(false);
    const startDate = dateKey(days[0] ?? new Date());
    setCreateEventDraft({
      calendarId: calendars.find((calendar) => calendar.selected)?.id ?? "",
      startDate,
      startTime: "09:00",
      endDate: startDate,
      endTime: "10:00",
      allDay: false,
    });
    setCreateEventError(null);
    setCreateEventOpen(true);
  }

  function openEditEvent(event: AgendaEvent) {
    const start = event.startDateTime ? dateTimeInputs(event.startDateTime) : null;
    const end = event.endDateTime ? dateTimeInputs(event.endDateTime) : null;
    setEditingEvent(event);
    setDeleteEventConfirm(false);
    setCreateEventDraft({
      calendarId: event.calendarId,
      startDate: event.startDate ?? start?.date ?? "",
      startTime: start?.time ?? "09:00",
      endDate: event.endDate ?? end?.date ?? event.startDate ?? start?.date ?? "",
      endTime: end?.time ?? "10:00",
      allDay: Boolean(event.startDate && event.endDate),
    });
    setCreateEventError(null);
    setCreateEventOpen(true);
  }

  async function submitCreateEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateEventSaving(true);
    setCreateEventError(null);
    const form = new FormData(event.currentTarget);
    const allDay = form.get("allDay") === "on";
    const eventFields = allDay
      ? {
          summary: String(form.get("summary") ?? ""),
          allDay: true,
          startDate: String(form.get("startDate") ?? ""),
          endDate: String(form.get("endDate") ?? ""),
        }
      : {
          summary: String(form.get("summary") ?? ""),
          allDay: false,
          startDateTime: `${String(form.get("startDate") ?? "")}T${String(form.get("startTime") ?? "")}:00-06:00`,
          endDateTime: `${String(form.get("endDate") ?? "")}T${String(form.get("endTime") ?? "")}:00-06:00`,
        };
    const calendarId = editingEvent?.calendarId ?? String(form.get("calendarId") ?? "");
    const body = editingEvent ? { ...eventFields, calendarId, etag: editingEvent.etag } : { ...eventFields, calendarId };

    try {
      const response = await fetch(editingEvent ? `/api/events/${encodeURIComponent(editingEvent.id)}` : "/api/events", {
        method: editingEvent ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos crear la actividad.");
      setCreateEventOpen(false);
      setEventActionMessage(editingEvent ? "Actividad actualizada en Google Calendar." : "Actividad creada en Google Calendar.");
      setEventReload((current) => current + 1);
      window.setTimeout(() => setEventActionMessage(null), 4500);
    } catch (error) {
      setCreateEventError(error instanceof Error ? error.message : "No pudimos crear la actividad.");
    } finally {
      setCreateEventSaving(false);
    }
  }

  async function deleteEvent() {
    if (!editingEvent) return;
    setCreateEventSaving(true);
    setCreateEventError(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(editingEvent.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: editingEvent.calendarId, etag: editingEvent.etag }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error ?? "No pudimos eliminar la actividad.");
      }
      setCreateEventOpen(false);
      setEditingEvent(null);
      setDeleteEventConfirm(false);
      setEventActionMessage("Actividad eliminada de Google Calendar.");
      setEventReload((current) => current + 1);
      window.setTimeout(() => setEventActionMessage(null), 4500);
    } catch (error) {
      setCreateEventError(error instanceof Error ? error.message : "No pudimos eliminar la actividad.");
      setDeleteEventConfirm(false);
    } finally {
      setCreateEventSaving(false);
    }
  }

  async function updateEventState(
    eventToUpdate: AgendaEvent,
    action: "complete" | "uncomplete" | "keep" | "unkeep",
    closeEditor = false,
  ) {
    const eventKey = `${eventToUpdate.calendarId}\u0000${eventToUpdate.id}`;
    if (closeEditor) {
      setCreateEventSaving(true);
      setCreateEventError(null);
    }
    setSavingEventActionKey(eventKey);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(eventToUpdate.id)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: eventToUpdate.calendarId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos actualizar el estado de la actividad.");
      setEvents((current) => current.map((item) => {
        if (item.id !== eventToUpdate.id || item.calendarId !== eventToUpdate.calendarId) return item;
        return {
          ...item,
          overlay: {
            completedAt: typeof result?.completedAt === "string" ? result.completedAt : null,
            keep: typeof result?.keep === "boolean" ? result.keep : item.overlay?.keep ?? false,
            kind: item.overlay?.kind ?? "plain",
          },
        };
      }));
      if (closeEditor) {
        setCreateEventOpen(false);
        setEditingEvent(null);
      }
      const messages = {
        complete: "Actividad marcada como completada.",
        uncomplete: "Actividad pendiente de nuevo.",
        keep: "Actividad guardada en Conservar.",
        unkeep: "La actividad volverá a la retención automática.",
      };
      setEventActionError(false);
      setEventActionMessage(messages[action]);
      window.setTimeout(() => setEventActionMessage(null), 4500);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No pudimos actualizar el estado de la actividad.";
      if (closeEditor) setCreateEventError(message);
      else {
        setEventActionError(true);
        setEventActionMessage(message);
      }
    } finally {
      setSavingEventActionKey(null);
      if (closeEditor) setCreateEventSaving(false);
    }
  }

  async function toggleCalendar(calendar: CalendarItem) {
    const selected = !calendar.selected;
    setCalendarMessage(null);
    setCalendars((current) => current.map((item) => item.id === calendar.id ? { ...item, selected } : item));
    setSavingCalendarId(calendar.id);

    try {
      const response = await fetch(`/api/calendars/${encodeURIComponent(calendar.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos guardar el cambio.");
    } catch {
      setCalendars((current) => current.map((item) => item.id === calendar.id ? { ...item, selected: calendar.selected } : item));
      setCalendarMessage("No pudimos guardar la selección. Inténtalo de nuevo.");
    } finally {
      setSavingCalendarId(null);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#agenda" aria-label="MiAgenda, inicio">
          <span className="brand-mark">m</span>
          <span>miagenda</span>
        </a>

        <button className="new-item" type="button" disabled={calendarLoadState !== "ready"} onClick={openCreateEvent}>
          <span className="new-item-plus">＋</span>
          <span>Crear actividad</span>
        </button>

        <nav className="primary-nav" aria-label="Navegación principal">
          <a className="nav-item nav-item-active" href="#agenda" aria-current="page">
            <span className="nav-icon" aria-hidden="true">▦</span>
            Agenda
          </a>
          <a className="nav-item nav-item-muted" href="/cocina">
            <span className="nav-icon" aria-hidden="true">♨</span>
            Cocina
          </a>
        </nav>

        <div className="sidebar-divider" />
        <section className="calendar-list" aria-labelledby="calendars-heading">
          <div className="section-heading">
            <h2 id="calendars-heading">Mis calendarios</h2>
            <span className="tiny-lock" aria-hidden="true">⌑</span>
          </div>
          {calendarLoadState === "loading" && (
            <div className="connect-note"><span className="connect-note-icon" aria-hidden="true">◷</span><p>Cargando tus calendarios…</p></div>
          )}
          {calendarLoadState === "error" && (
            <div className="connect-note calendar-load-error" role="alert">
              <p>No pudimos cargar Google Calendar.</p>
              <button type="button" onClick={() => setCalendarReload((current) => current + 1)}>Reintentar</button>
            </div>
          )}
          {calendarLoadState === "ready" && calendars.length === 0 && (
            <div className="connect-note"><span className="connect-note-icon" aria-hidden="true">◷</span><p>No hay calendarios disponibles en esta cuenta.</p></div>
          )}
          {calendarLoadState === "ready" && calendars.length > 0 && (
            <ul className="calendar-items">
              {calendars.map((calendar) => (
                <li className="calendar-option" key={calendar.id}>
                  <label className="calendar-option-label" title={calendar.summary}>
                    <input
                      type="checkbox"
                      checked={calendar.selected}
                      disabled={savingCalendarId === calendar.id}
                      onChange={() => void toggleCalendar(calendar)}
                    />
                    <span className="calendar-swatch" style={{ backgroundColor: calendar.color ?? "#90a393" }} />
                    <span className="calendar-option-name">{calendar.summary}</span>
                  </label>
                  {calendar.primary && <span className="calendar-primary-label">Principal</span>}
                </li>
              ))}
            </ul>
          )}
          {calendarMessage && <p className="calendar-feedback" role="alert">{calendarMessage}</p>}
        </section>

        <div className="sidebar-bottom">
          <div className="privacy-line"><span className="privacy-dot" />Tus datos, bajo tu control</div>
          <div className="profile-row">
            <div className="avatar">E</div>
            <div className="profile-copy"><strong>Tu espacio</strong><span>Cuenta personal</span></div>
            <span className="profile-menu" aria-hidden="true">···</span>
          </div>
        </div>
      </aside>

      <section className="workspace" id="agenda">
        <header className="topbar">
          <div className="breadcrumb"><span>Mi espacio</span><span className="breadcrumb-slash">/</span><strong>Agenda</strong></div>
          <div className="topbar-actions">
            <span className={`sync-status${calendarLoadState === "ready" ? " sync-status-connected" : ""}`}>
              <span />{calendarLoadState === "ready" ? "Google conectado" : calendarLoadState === "loading" ? "Cargando Google" : "Sin conexión"}
            </span>
            <button className="sync-refresh" type="button" onClick={() => setEventReload((current) => current + 1)} disabled={eventLoadState === "loading" || calendarLoadState !== "ready"} aria-label={eventLoadState === "loading" ? "Actualizando eventos" : "Actualizar eventos"} title="Actualizar eventos de Google Calendar">
              {eventLoadState === "loading" ? "…" : "↻"}
            </button>
            <button className="avatar avatar-small" type="button" aria-label="Perfil">E</button>
          </div>
        </header>

        <div className="page-content">
          <div className="page-heading-row">
            <div>
              <p className="eyebrow">TU TIEMPO, CON INTENCIÓN</p>
              <h1>Agenda semanal</h1>
              <p className="week-range">{weekLabel}</p>
            </div>
            <div className="week-controls" aria-label="Controles de semana">
              <button className="week-mobile-create" type="button" onClick={openCreateEvent} disabled={calendarLoadState !== "ready"}>＋ Crear</button>
              <button className="today-button" type="button" onClick={() => setFocusDate(new Date())}>Hoy</button>
              <div className="week-arrows">
                <button type="button" aria-label="Semana anterior" onClick={() => moveWeek(-1)}>‹</button>
                <button type="button" aria-label="Semana siguiente" onClick={() => moveWeek(1)}>›</button>
              </div>
            </div>
          </div>

          <div className="calendar-card">
            <div className="day-header-row">
              <div className="timezone-cell">GMT−6</div>
              {weekDays.map((day, index) => {
                const date = days[index];
                const isToday = date && focusDate && date.toDateString() === focusDate.toDateString();
                return (
                  <div className={`day-heading${isToday ? " day-heading-today" : ""}`} key={day}>
                    <span>{day}</span>
                    <strong>{date ? formatDate(date, { day: "numeric" }) : "–"}</strong>
                    {isToday && <i>HOY</i>}
                  </div>
                );
              })}
            </div>
            <div className="all-day-row" aria-label="Eventos de día completo">
              <div className="all-day-label">Día completo</div>
              {days.map((date) => {
                const day = dayWindow(date);
                const allDayEvents = events.filter((event) => event.startDate && event.endDate && event.startDate <= day.key && event.endDate > day.key);
                return (
                  <div className="all-day-cell" key={day.key}>
                    {allDayEvents.map((event) => (
                      <div className="all-day-event-container" key={`${event.calendarId}:${event.id}`} style={{ "--event-color": event.color ?? "#78947d" } as CSSProperties}>
                        <button className={`all-day-event${event.overlay?.completedAt ? " all-day-event-completed" : ""}`} type="button" title={`${event.summary} · ${event.calendarName}`} onClick={() => openEditEvent(event)}>
                          {event.summary}
                        </button>
                        <button className={`event-completion${event.overlay?.completedAt ? " event-completion-checked" : ""}`} type="button" disabled={savingEventActionKey === `${event.calendarId}\u0000${event.id}`} aria-pressed={Boolean(event.overlay?.completedAt)} aria-label={`${event.overlay?.completedAt ? "Deshacer completado de" : "Completar"} ${event.summary}`} title={event.overlay?.completedAt ? "Deshacer completado" : "Completar"} onClick={() => void updateEventState(event, event.overlay?.completedAt ? "uncomplete" : "complete")}>
                          {event.overlay?.completedAt ? "✓" : ""}
                        </button>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="time-grid-scroll">
              <div className="time-grid">
                <div className="hour-column">
                  {hours.map((hour) => <div className="hour-label" key={hour}>{`${String(hour).padStart(2, "0")}:00`}</div>)}
                </div>
                {days.map((date) => {
                  const window = dayWindow(date);
                  const dayEvents = events.flatMap((event) => {
                    if (!event.startDateTime || !event.endDateTime) return [];
                    const start = new Date(event.startDateTime).getTime();
                    const end = new Date(event.endDateTime).getTime();
                    const clippedStart = Math.max(start, window.start);
                    const clippedEnd = Math.min(end, window.end);
                    if (!Number.isFinite(start) || !Number.isFinite(end) || clippedEnd <= clippedStart) return [];
                    const top = start < window.start ? 0 : zonedMinutes(new Date(start)) / 60 * HOUR_HEIGHT;
                    const height = Math.max(20, (clippedEnd - clippedStart) / 60000 / 60 * HOUR_HEIGHT);
                    return [{ event, top, height }];
                  });
                  return (
                    <div className="day-column" key={window.key}>
                      {hours.map((hour) => <div className="hour-slot" key={hour} />)}
                      {dayEvents.map(({ event, top, height }) => (
                        <div className="agenda-event-container" key={`${event.calendarId}:${event.id}`} style={{ top, height, "--event-color": event.color ?? "#78947d" } as CSSProperties}>
                          <button className={`agenda-event${event.overlay?.completedAt ? " agenda-event-completed" : ""}`} title={`${event.summary}\n${event.calendarName}\n${eventTimeLabel(event)}`} aria-label={`Editar ${event.summary}${eventTimeLabel(event) ? `, ${eventTimeLabel(event)}` : ""}`} type="button" onClick={() => openEditEvent(event)}>
                            <strong>{event.summary}</strong>
                            <span>{eventTimeLabel(event)}</span>
                          </button>
                          <button className={`event-completion${event.overlay?.completedAt ? " event-completion-checked" : ""}`} type="button" disabled={savingEventActionKey === `${event.calendarId}\u0000${event.id}`} aria-pressed={Boolean(event.overlay?.completedAt)} aria-label={`${event.overlay?.completedAt ? "Deshacer completado de" : "Completar"} ${event.summary}`} title={event.overlay?.completedAt ? "Deshacer completado" : "Completar"} onClick={() => void updateEventState(event, event.overlay?.completedAt ? "uncomplete" : "complete")}>
                            {event.overlay?.completedAt ? "✓" : ""}
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
              {eventLoadState === "ready" && events.length === 0 && <div className="empty-state">
                <div className="empty-illustration" aria-hidden="true">
                  <span className="empty-sun" />
                  <span className="empty-page"><i /><i /><i /></span>
                  <span className="empty-spark spark-one">✳</span>
                  <span className="empty-spark spark-two">✳</span>
                </div>
                <h2>{selectedCalendarKey ? "Tu semana está libre" : "Activa un calendario"}</h2>
                <p>{selectedCalendarKey ? "No hay eventos en los calendarios seleccionados para esta semana." : "Selecciona al menos un calendario en la barra lateral para ver sus eventos."}</p>
              </div>}
              {eventLoadState === "loading" && <div className="event-status" role="status">Cargando eventos de la semana…</div>}
              {eventLoadState === "error" && <div className="event-status event-status-error" role="alert">
                <span>{eventLoadError ?? "No pudimos cargar los eventos de Google Calendar."}</span>
                <button type="button" onClick={() => setEventReload((current) => current + 1)}>Reintentar</button>
              </div>}
            </div>
          </div>
          {eventActionMessage && <p className={`action-feedback${eventActionError ? " action-feedback-error" : ""}`} role={eventActionError ? "alert" : "status"}>{eventActionMessage}</p>}
          <p className="footer-note">Google Calendar será la fuente de tus fechas y horarios. MiAgenda añade las herramientas para organizarte.</p>
        </div>
      </section>
      {createEventOpen && <div className="dialog-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !createEventSaving) setCreateEventOpen(false); }} onKeyDown={(event) => { if (event.key === "Escape" && !createEventSaving) setCreateEventOpen(false); }}>
        <section className="event-dialog" role="dialog" aria-modal="true" aria-labelledby="create-event-title">
          <div className="dialog-heading">
            <div><p className="eyebrow">GOOGLE CALENDAR</p><h2 id="create-event-title">{editingEvent ? "Editar actividad" : "Crear actividad"}</h2></div>
            <button className="dialog-close" type="button" disabled={createEventSaving} onClick={() => setCreateEventOpen(false)} aria-label="Cerrar">×</button>
          </div>
          {calendars.filter((calendar) => calendar.selected).length === 0
            ? <p className="dialog-empty">Activa un calendario en la barra lateral para poder crear una actividad.</p>
            : <form className="event-form" onSubmit={(event) => void submitCreateEvent(event)}>
                <label className="form-field">Título
                  <input name="summary" type="text" maxLength={250} placeholder="Ej. Clase de Arquitectura" autoFocus required />
                </label>
                <label className="form-field">Calendario
                  <select name="calendarId" value={createEventDraft.calendarId} disabled={Boolean(editingEvent)} onChange={(event) => setCreateEventDraft((draft) => ({ ...draft, calendarId: event.target.value }))} required>
                    {calendars.filter((calendar) => calendar.selected).map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
                  </select>
                </label>
                {editingEvent && <input type="hidden" name="calendarId" value={editingEvent.calendarId} />}
                <label className="all-day-toggle"><input name="allDay" type="checkbox" checked={createEventDraft.allDay} onChange={(event) => setCreateEventDraft((draft) => {
                  if (!event.target.checked) {
                    const end = minutesAfter(draft.startDate, draft.startTime, 60);
                    return { ...draft, allDay: false, endDate: end.date, endTime: end.time };
                  }
                  return { ...draft, allDay: true, endDate: draft.endDate <= draft.startDate ? addDaysToKey(draft.startDate, 1) : draft.endDate };
                })} /> Todo el día</label>
                <div className="form-date-grid">
                <label className="form-field">Inicia
                    <input name="startDate" type="date" value={createEventDraft.startDate} onChange={(event) => setCreateEventDraft((draft) => draft.allDay
                      ? { ...draft, startDate: event.target.value, endDate: draft.endDate <= event.target.value ? addDaysToKey(event.target.value, 1) : draft.endDate }
                      : shiftDraftStart(draft, event.target.value, draft.startTime))} required />
                  </label>
                  {!createEventDraft.allDay && <label className="form-field">Hora de inicio
                    <input name="startTime" type="time" value={createEventDraft.startTime} onChange={(event) => setCreateEventDraft((draft) => shiftDraftStart(draft, draft.startDate, event.target.value))} required />
                  </label>}
                  <label className="form-field">Termina
                    <input name="endDate" type="date" min={createEventDraft.allDay ? addDaysToKey(createEventDraft.startDate, 1) : createEventDraft.startDate} value={createEventDraft.endDate} onChange={(event) => setCreateEventDraft((draft) => draft.allDay
                      ? { ...draft, endDate: event.target.value }
                      : setDraftEnd(draft, event.target.value, draft.endTime))} required />
                  </label>
                  {!createEventDraft.allDay && <label className="form-field">Hora de fin
                    <input name="endTime" type="time" min={createEventDraft.endDate === createEventDraft.startDate ? createEventDraft.startTime : undefined} value={createEventDraft.endTime} onChange={(event) => setCreateEventDraft((draft) => setDraftEnd(draft, draft.endDate, event.target.value))} required />
                  </label>}
                </div>
                {createEventDraft.allDay && <p className="form-hint">La fecha final no se incluye en el evento de día completo.</p>}
                <p className="form-hint">Las horas usan la zona America/Mexico_City (GMT−6).</p>
                {createEventError && <p className="form-error" role="alert">{createEventError}</p>}
                {deleteEventConfirm
                  ? <div className="delete-confirm" role="alert">
                      <p>Se eliminará este evento de tu calendario y de MiAgenda. Google no enviará avisos a invitados.</p>
                      <div className="dialog-actions">
                        <button className="dialog-cancel" type="button" disabled={createEventSaving} onClick={() => setDeleteEventConfirm(false)}>Cancelar</button>
                        <button className="dialog-delete-confirm" type="button" disabled={createEventSaving} onClick={() => void deleteEvent()}>{createEventSaving ? "Eliminando…" : "Sí, eliminar"}</button>
                      </div>
                    </div>
                  : <div className="dialog-actions">
                      {editingEvent && <button className="dialog-cancel" type="button" disabled={createEventSaving} onClick={() => void updateEventState(editingEvent, editingEvent.overlay?.keep ? "unkeep" : "keep", true)}>{createEventSaving ? "Guardando…" : editingEvent.overlay?.keep ? "Quitar de Conservar" : "Conservar"}</button>}
                      {editingEvent && <button className="dialog-delete" type="button" disabled={createEventSaving} onClick={() => setDeleteEventConfirm(true)}>Eliminar</button>}
                      <button className="dialog-cancel" type="button" disabled={createEventSaving} onClick={() => setCreateEventOpen(false)}>Cancelar</button>
                      <button className="dialog-submit" type="submit" disabled={createEventSaving}>{createEventSaving ? "Guardando…" : editingEvent ? "Guardar cambios" : "Crear actividad"}</button>
                    </div>}
              </form>}
        </section>
      </div>}
    </main>
  );
}
