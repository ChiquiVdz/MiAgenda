"use client";
import { coreFetch, localMode } from "./local-data";
import { AppNavigation } from "./app-navigation";
import { useMobileLayout } from "./use-mobile-layout";
import dynamic from "next/dynamic";

import { useEffect, useMemo, useRef, useState } from "react";
import { signOut } from "./local-data";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import { TaskCard } from "./task-card";
import { CoreDialog, CoreFeedback, ScheduleFields, type CalendarView, scheduleLabel } from "./schedule-editor";
import { useCoreFeed, type Feed } from "./use-core-feed";
import { atTime, dateParts, labelDate, plusDays, rangeQuery, agendaPeriod, movePeriod, type AgendaViewMode } from "./dates";
import { monthDays } from "@/lib/calendar-month";
import { MonthAgenda } from "../components/month-agenda";
import { YearAgenda } from "../components/year-agenda";
import { useWeekDrag } from "./use-week-drag";
import { CalendarEditor } from "./calendar-editor";
import { WeekCreatePopover, type WeekDraftSchedule } from "./week-create-popover";
import { ActivityPopover } from "./activity-popover";
const AgendaMealCreator = dynamic(() => import("./agenda-meal-creator").then(module => module.AgendaMealCreator), { loading: () => <p role="status">Cargando formulario de comida…</p> });

function intersects(item: ActivityView, start: string, end: string, midnight = atTime(start), next = atTime(end)) {
  const schedule = item.schedule;
  return !!schedule && (schedule.mode === "allDay"
    ? schedule.startDate! < end && schedule.endDate! > start
    : schedule.startsAt! < next && schedule.endsAt! > midnight);
}
function minuteAt(value: string) { const time = dateParts(value).time; return +time.slice(0, 2) * 60 + +time.slice(3); }
function placements<T extends Pick<ActivityView, "id" | "schedule">>(items: T[], day: string) {
  const midnight = atTime(day), next = atTime(plusDays(day, 1));
  const rows = items.filter(item => item.schedule?.mode === "timed" && item.schedule.startsAt! < next && item.schedule.endsAt! > midnight).map(item => ({ item,
    start: item.schedule!.startsAt! <= midnight ? 0 : minuteAt(item.schedule!.startsAt!),
    end: item.schedule!.endsAt! >= next ? 1440 : minuteAt(item.schedule!.endsAt!), lane: 0, lanes: 1, parent: -1, left: 0, width: 100, layer: 0, textWidth: 100 }));
  const duration = (row: typeof rows[number]) => row.end - row.start;
  const visualEnd = (row: typeof rows[number]) => Math.min(1440, Math.max(row.end, row.start + 30));
  // Longer blocks form the background; later starts of equal length sit above.
  rows.sort((a, b) => duration(b) - duration(a) || a.start - b.start || a.item.id.localeCompare(b.item.id));
  const siblings = new Map<number, typeof rows>();
  rows.forEach((row, index) => {
    for (let candidate = 0; candidate < index; candidate++) {
      const other = rows[candidate];
      if (row.start >= visualEnd(other) || other.start >= visualEnd(row) || (duration(other) === duration(row) && other.start === row.start)) continue;
      const previous = rows[row.parent];
      if (!previous || duration(other) < duration(previous) || (duration(other) === duration(previous) && other.start > previous.start)) row.parent = candidate;
    }
    const group = siblings.get(row.parent) ?? [];
    group.push(row); siblings.set(row.parent, group);
  });
  for (const group of siblings.values()) {
    group.sort((a, b) => a.start - b.start || b.end - a.end || a.item.id.localeCompare(b.item.id));
    let cluster: typeof rows = [], ends: number[] = [], until = -1;
    const finish = () => { for (const row of cluster) row.lanes = ends.length; cluster = []; ends = []; };
    for (const row of group) {
      if (row.start >= until) { finish(); until = -1; }
      let lane = ends.findIndex(end => end <= row.start);
      if (lane === -1) lane = ends.length;
      ends[lane] = visualEnd(row); row.lane = lane; cluster.push(row); until = Math.max(until, visualEnd(row));
    }
    finish();
  }
  for (const row of rows) {
    const parent = rows[row.parent];
    const protectSummary = parent && siblings.get(row.parent)?.some(child => child.start < parent.start + 64 && visualEnd(child) > parent.start);
    const inset = parent ? (protectSummary ? parent.width * .42 : Math.min(6, parent.width * .15)) : 0;
    if (parent && protectSummary) parent.textWidth = 42;
    row.width = ((parent?.width ?? 100) - inset) / row.lanes;
    row.left = (parent?.left ?? 0) + inset + row.lane * row.width;
    row.layer = parent ? parent.layer + 1 : 0;
  }
  return rows;
}

export function CoreAgenda({ initialData, initialCalendars, initialToday }: { initialData: Feed; initialCalendars: CalendarView[]; initialToday: string }) {
  const mobile = useMobileLayout(), initialViewChosen = useRef(false);
  const [view, setView] = useState<AgendaViewMode>("week"), [anchor, setAnchor] = useState(initialToday);
  useEffect(() => {
    if (initialViewChosen.current) return;
    initialViewChosen.current = true;
    if (window.matchMedia("(max-width: 680px)").matches) setView("day");
  }, [mobile]);
  const [now, setNow] = useState<Date | null>(null), [calendars, setCalendars] = useState(initialCalendars);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [editingCalendar, setEditingCalendar] = useState<CalendarView | null>(null);
  const [addingCalendar, setAddingCalendar] = useState(false), [name, setName] = useState(""), [color, setColor] = useState("#527860");
  const [createDate, setCreateDate] = useState<string | null>(null), [newTitle, setNewTitle] = useState("");
  const [createTime, setCreateTime] = useState<string | undefined>();
  const [weekDraft, setWeekDraft] = useState<WeekDraftSchedule | null>(null);
  const [allDayPreview, setAllDayPreview] = useState<{ startDate: string; endDate: string } | null>(null);
  const [detailAnchor, setDetailAnchor] = useState<HTMLElement | null>(null);
  const [createType, setCreateType] = useState<"task" | "meal">("task"), [mealLocked, setMealLocked] = useState(false), [mealNotice, setMealNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [extraDetail, setExtraDetail] = useState<ActivityView | null>(null);
  const detailGeneration = useRef(0), calendarGeneration = useRef(0);
  const today = now ? dateParts(now).date : initialToday;
  const { start, days, end, visibleStart, visibleEnd } = useMemo(() => mobile && view === "week" ? {start:anchor,end:plusDays(anchor,3),visibleStart:anchor,visibleEnd:plusDays(anchor,3),days:3} : agendaPeriod(view, anchor), [view, anchor, mobile]);
  const calendarById = useMemo(() => new Map(calendars.map(calendar => [calendar.id, calendar])), [calendars]);
  const visibleIds = useMemo(() => new Set(calendars.filter(calendar => calendar.visible).map(calendar => calendar.id)), [calendars]);
  const bounds = useMemo(() => ({ midnight: atTime(start), next: atTime(end) }), [start, end]);
  async function reloadCalendars(action?: string) {
    if (action && !["createCalendar", "setCalendarVisible", "editCalendar", "deleteCalendar"].includes(action)) return;
    const generation = ++calendarGeneration.current;
    try {
      const response = await coreFetch("/api/core?view=calendars", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos consultar los calendarios.");
      if (generation === calendarGeneration.current) { setCalendars(result.items); setCalendarError(null); }
    } catch (cause) { setCalendarError(cause instanceof Error ? cause.message : "No pudimos consultar los calendarios."); }
  }
  const feed = useCoreFeed(initialData, rangeQuery(start, days, view === "year"), item => intersects(item, start, end) && (view !== "year" || item.highlighted), (action, result) => {
    if (action === "createCalendar" && result?.calendars.length) setCalendars(current => [...current, ...result.calendars.filter(item => !current.some(old => old.id === item.id)).map((item, index) => ({ ...item, visible: true, moduleKey: null, position: current.length + index }))]);
    if (action === "changeRecurrence" || action === "saveTask") { ++detailGeneration.current; setSelectedId(null); setExtraDetail(null); }
    void reloadCalendars(action);
    if (result) setExtraDetail(current => current ? result.activities.find(item => item.id === current.id) ?? (result.removedIds.includes(current.id) ? null : current) : null);
    else if (selectedId && extraDetail && !extraDetail.recurrence?.virtual) void openParent(selectedId);
  });
  const items = useMemo(() => feed.data.items.filter(item => intersects(item, start, end, bounds.midnight, bounds.next) && item.schedule && visibleIds.has(item.schedule.calendarId) && (view !== "year" || item.highlighted)).sort((a, b) => (a.schedule!.startsAt ?? a.schedule!.startDate!).localeCompare(b.schedule!.startsAt ?? b.schedule!.startDate!) || a.title.localeCompare(b.title)), [feed.data.items, start, end, bounds, visibleIds, view]);
  // A presentation projection only: all mutations still use the original Activity.
  const calendarEvents = useMemo(() => items.map(item => {
    const calendar = calendarById.get(item.schedule!.calendarId);
    return { id: item.id, calendarId: item.schedule!.calendarId, calendarName: calendar?.name ?? "Calendario", color: calendar?.color ?? null,
      summary: item.title, startDate: item.schedule!.startDate, endDate: item.schedule!.endDate, startDateTime: item.schedule!.startsAt, endDateTime: item.schedule!.endsAt,
      overlay: { completedAt: item.completedAt, highlighted: item.highlighted }, progress: item.children.length ? { done: item.children.filter(child => child.completedAt).length, total: item.children.length } : null };
  }), [items, calendarById]);
  const monthGrid = useMemo(() => monthDays(new Date(+anchor.slice(0, 4), +anchor.slice(5, 7) - 1, 1, 12)), [anchor]);
  const weekRows = useMemo(() => view === "week" ? new Map(Array.from({ length: days }, (_, index) => {
    const day = plusDays(start, index);
    return [day, placements(items, day)] as const;
  })) : new Map<string, ReturnType<typeof placements<ActivityView>>>(), [items, start, view, days]);
  const periodLabel = view === "year" ? anchor.slice(0, 4) : view === "month" ? labelDate(visibleStart, { month: "long", year: "numeric" }) : `${labelDate(start)}${view === "week" ? ` – ${labelDate(plusDays(end, -1))}` : ""}`;
  function keyOfLocalDay(day: Date) { return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`; }
  function openActivity(id: string, anchor?: HTMLElement) {
    if (weekDraft) return;
    setDetailAnchor(anchor ?? null);
    ++detailGeneration.current; setExtraDetail(feed.data.items.find(item => item.id === id) ?? null); setSelectedId(id);
  }
  const selected = feed.data.items.find(item => item.id === selectedId) ?? (extraDetail?.id === selectedId ? extraDetail : null);
  const weekScroll = useRef<HTMLDivElement>(null);
  const lastScroll = useRef<string | null>(null);
  useEffect(() => {
    setNow(new Date()); const timer = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (view !== "week") lastScroll.current = null;
    if (view === "week" && now && lastScroll.current !== start && weekScroll.current) {
      weekScroll.current.scrollTop = Math.max(0, minuteAt(now.toISOString()) - 100); lastScroll.current = start;
    }
  }, [view, now, start]);
  // Merge separately loaded parents with responses from the same common service.
  const mutate: typeof feed.mutate = async (command, success) => {
    ++detailGeneration.current;
    await feed.mutate(command, success);
  };
  const drag = useWeekDrag(weekScroll, start, feed.locked || feed.reading || !!weekDraft, mutate);
  const draftDrag = useWeekDrag(weekScroll, start, feed.locked || feed.reading || !weekDraft || !!createDate || !!allDayPreview, async command => {
    if (command.action === "scheduleTask" && command.schedule.mode === "timed") setWeekDraft(command.schedule);
  });
  const draftSchedule = draftDrag.preview?.schedule ?? weekDraft;
  const draftItem = draftSchedule && !allDayPreview ? { id: "week-new-activity", title: newTitle.trim() || "Sin nombre", revision: 0, schedule: { ...draftSchedule, startDate: null, endDate: null } } : null;
  function closeCreate() { if (!feed.busy && !mealLocked) { draftDrag.cancel(); setWeekDraft(null); setCreateDate(null); setNewTitle(""); } }
  useEffect(() => {
    if (!weekDraft || createDate || selectedId || addingCalendar || editingCalendar) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !feed.busy) { event.preventDefault(); draftDrag.cancel(); setWeekDraft(null); setNewTitle(""); } };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [weekDraft, createDate, selectedId, addingCalendar, editingCalendar, feed.busy]);
  useEffect(() => { if (view !== "week" && weekDraft) { setWeekDraft(null); setCreateDate(null); } }, [view, weekDraft]);
  const previewSource = feed.data.items.find(item => item.id === drag.preview?.id);
  const previewItem = drag.preview && previewSource ? { ...previewSource, schedule: { ...drag.preview.schedule, startDate: null, endDate: null } } : null;
  async function openParent(id: string) {
    const generation = ++detailGeneration.current;
    try {
      const response = await coreFetch(`/api/core?view=detail&id=${id}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos abrir la principal.");
      if (generation === detailGeneration.current) { setExtraDetail(result.item); setSelectedId(id); }
    } catch (cause) { setCalendarError(cause instanceof Error ? cause.message : "No pudimos abrir la principal."); }
  }
  function closeDetail() { ++detailGeneration.current; setSelectedId(null); setExtraDetail(null); }
  function status() { return <>{feed.error && <p className="pantry-message pantry-error" role="alert">{feed.error} {feed.retry && <button className="core-text-button" type="button" disabled={feed.busy} onClick={feed.reattempt}>Reintentar cambio</button>}</p>}{feed.notice && <p className="pantry-message" role="status">{feed.notice}</p>}{mealNotice && <p className="pantry-message" role="status">{mealNotice}</p>}</>; }
  function openCreate(date: string, time?: string) {
    if (weekDraft && createDate) return;
    const hour = time ?? dateParts(new Date(Math.ceil(Date.now()/900000)*900000)).time;
    setMealNotice(null);
    if (view === "week") {
      if (!weekDraft) { setNewTitle(""); setCreateType("task"); }
      const startsAt = atTime(date, hour);
      const duration = weekDraft ? Date.parse(weekDraft.endsAt) - Date.parse(weekDraft.startsAt) : 3600000;
      setWeekDraft({ mode: "timed", calendarId: weekDraft?.calendarId ?? calendars.find(calendar => calendar.visible && !calendar.moduleKey)?.id ?? calendars[0]?.id ?? "", timeZone: "America/Mexico_City", startsAt, endsAt: new Date(Date.parse(startsAt) + duration).toISOString() });
      return;
    }
    setNewTitle(""); setCreateType("task"); setCreateTime(hour); setCreateDate(date);
  }
  function draftMore(type: "task" | "meal") {
    if (!weekDraft) return;
    const local = dateParts(weekDraft.startsAt, weekDraft.timeZone);
    setCreateType(type); setCreateTime(local.time); setCreateDate(local.date);
  }
  function changeDraft(schedule: WeekDraftSchedule) {
    setWeekDraft(schedule);
    const date = dateParts(schedule.startsAt, schedule.timeZone).date;
    if (date < start || date >= end) setAnchor(date);
  }
  function createCalendarInline(name: string, color: string, selected: (id: string) => void) {
    const id = crypto.randomUUID();
    void mutate({ action: "createCalendar", id, name, color }, () => selected(id));
  }
  function mealSaved(date: string) {
    setCreateDate(null); setWeekDraft(null); setMealLocked(false);
    if (date >= start && date < end) void feed.load(); else setAnchor(date);
    const kitchen = calendars.find(calendar => calendar.moduleKey === "kitchen");
    if (!kitchen) void reloadCalendars();
    setMealNotice(`Cambios de comida guardados en Agenda y Planificar.${kitchen && !kitchen.visible ? " Activa el calendario Cocina para verla aquí." : view === "year" ? " En Año solo se muestran los eventos destacados." : ""}`);
  }
  function eventButton(item: ActivityView, compact = false, textWidth = 100) {
    const calendar = calendarById.get(item.schedule!.calendarId);
    function timeLabel(stamp: string) { const time = dateParts(stamp, item.schedule!.timeZone).time; const hour = +time.slice(0, 2); return `${hour % 12 || 12}:${time.slice(3)} ${hour < 12 ? "am" : "pm"}`; }
    return <button type="button" className={`core-week-event${item.completedAt ? " core-event-done" : ""}`} title={`${item.title} · ${scheduleLabel(item)}`} style={{ borderLeftColor: calendar?.color }} onClick={event => { if (!drag.suppressClick()) openActivity(item.id, event.currentTarget); }}>
      <span className="core-week-summary" style={{ width: textWidth < 100 ? `calc(${textWidth}% - 6px)` : "100%" }}><strong>{item.highlighted ? "★ " : ""}{item.title}</strong>{!compact && <small><span>{timeLabel(item.schedule!.startsAt!)} –</span><span>{timeLabel(item.schedule!.endsAt!)}</span></small>}{item.parentId && <small>Subtarea</small>}</span></button>;
  }
  const detailBody = <>{status()}{selected ? <>
    {selected.parentId && <button className="core-text-button" disabled={feed.locked} onClick={() => void openParent(selected.parentId!)}>Ver tarea principal</button>}
    <ul className="core-inbox-list core-detail-list"><TaskCard key={selected.id} item={selected} scopeControls={view === "week" || view === "month"} calendars={calendars} disabled={feed.locked} mutate={mutate} /></ul>
  </> : <p>La actividad ya no está en este período. Su horario puede haberse quitado o cambiado; consulta Inbox u otro período.</p>}</>;
  return <CoreFeedback.Provider value={feed}><main className="app-shell"><AppNavigation><div className="sidebar-divider" /><div className="section-heading"><h2>Mis calendarios</h2><button className="calendar-add" aria-label="Crear calendario" disabled={feed.locked} onClick={() => setAddingCalendar(true)}>＋</button></div>
    <ul className="calendar-items">{calendars.map(calendar => <li className="core-calendar-row" key={calendar.id}><label className="core-check"><input type="checkbox" checked={calendar.visible} disabled={feed.locked} onChange={event => void mutate({ action: "setCalendarVisible", id: calendar.id, expectedRevision: calendar.revision, visible: event.target.checked })} /><span className="core-calendar-dot" style={{ background: calendar.color }} />{calendar.name}</label><button type="button" className="core-text-button" disabled={feed.locked} aria-label={`Editar calendario ${calendar.name}`} onClick={() => setEditingCalendar(calendar)}>⋯</button></li>)}</ul>
  </AppNavigation><section className="workspace agenda-workspace"><header className="topbar agenda-header"><div className="agenda-heading"><h1>Agenda</h1><p className="week-range">{periodLabel}</p></div>
      <div className="core-toolbar"><button className="core-text-button" disabled={feed.locked || mealLocked} onClick={() => openCreate(anchor)}>＋ Crear</button>
        {!(today >= visibleStart && today < visibleEnd) && <button className="core-text-button" disabled={feed.locked || mealLocked} onClick={() => { closeCreate(); setAnchor(today); }}>Hoy</button>}
        <button className="core-text-button" disabled={feed.locked || mealLocked} aria-label="Período anterior" onClick={() => { closeCreate(); setAnchor(mobile && view === "week" ? plusDays(anchor,-1) : movePeriod(view, anchor, -1)); }}>‹</button>
        <button className="core-text-button" disabled={feed.locked || mealLocked} aria-label="Período siguiente" onClick={() => { closeCreate(); setAnchor(mobile && view === "week" ? plusDays(anchor,1) : movePeriod(view, anchor, 1)); }}>›</button>
        <select aria-label="Vista de agenda" disabled={feed.locked || mealLocked} value={view} onChange={event => { setView(event.target.value as AgendaViewMode); setAnchor(today); }}><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option><option value="year">Año</option></select>
        
        <button className="core-text-button" disabled={feed.locked || mealLocked} onClick={() => void signOut({ callbackUrl: "/login" })}>Cerrar sesión</button>
      </div></header><div className="page-content">{status()}{calendarError && <p className="pantry-message pantry-error" role="alert">{calendarError}</p>}
      {drag.preview && previewItem && <p className="core-drag-status" role="status">{drag.preview.title} · {scheduleLabel(previewItem)} · Suelta para guardar</p>}
      {feed.data.nextAfterId && <p className="core-muted" role="status">Hay más {view === "year" ? "destacados" : "actividades"} en este período. Usa «Cargar más» para mostrarlos.</p>}
      {view === "year" ? <YearAgenda year={+anchor.slice(0, 4)} today={today} events={calendarEvents} loading={feed.reading} error={null} suppressEmpty={Boolean(feed.error)} onRetry={() => void feed.load()}
        onMonth={date => { setView("month"); setAnchor(keyOfLocalDay(date)); }} onOpen={event => openActivity(event.id)} />
      : view === "month" ? <MonthAgenda key={visibleStart} days={monthGrid} month={+anchor.slice(5, 7) - 1} today={today}
        events={calendarEvents} canCreate={!feed.locked} loading={feed.reading} error={null} createLabel="Crear tarea o comida" onRetry={() => void feed.load()} onCreate={date => openCreate(date)}
        onOpen={event => openActivity(event.id)} onWeek={date => { setView("week"); setAnchor(keyOfLocalDay(date)); }} />
      : view === "day" ? <div className="today-agenda"><h2>{labelDate(anchor, { weekday: "long", day: "numeric", month: "long" })}</h2>
        {items.length ? <ul className="core-inbox-list">{items.map(item => <TaskCard key={item.id} item={item} calendars={calendars} disabled={feed.locked} mutate={mutate} />)}</ul> : <p className="today-empty">No hay actividades en los calendarios visibles para este día.</p>}
      </div> : <div className="core-week-scroll" ref={weekScroll}><div className="core-week-grid">
        <div className="core-week-header"><div className="core-muted">GMT−6</div>{Array.from({ length: days }, (_, index) => { const day = plusDays(start, index); return <button className={`core-day-heading${day === today ? " core-is-today" : ""}`} key={day} onClick={() => { setView("day"); setAnchor(day); }}><span>{labelDate(day, { weekday: "short" })}</span><strong>{+day.slice(8)}</strong>{day === today && <small>Hoy</small>}</button>; })}</div>
        <div className="core-week-all-day"><span className="core-muted">Todo el día</span>{Array.from({ length: days }, (_, index) => { const day = plusDays(start, index); return <div key={day}>{items.filter(item => item.schedule!.mode === "allDay" && intersects(item, day, plusDays(day, 1))).map(item => <div key={item.id}>{eventButton(item, true)}</div>)}{weekDraft && allDayPreview && day >= allDayPreview.startDate && day < allDayPreview.endDate && <div className="core-all-day-draft core-week-draft" data-draft-date={day} style={{ backgroundColor: calendarById.get(weekDraft.calendarId)?.color ?? "#527860" }}>{newTitle.trim() || "Sin nombre"}</div>}</div>; })}</div>
        <div className="core-week-timeline"><div className="core-hours">{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * 60 }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
          {Array.from({ length: days }, (_, index) => { const day = plusDays(start, index); return <div className="core-day-column" key={day} onClick={event => {
            if (event.target !== event.currentTarget || feed.locked) return;
            const minute = Math.min(1425, Math.max(0, Math.floor((event.clientY - event.currentTarget.getBoundingClientRect().top) / 15) * 15));
            openCreate(day, `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`);
          }}>
            {(weekRows.get(day) ?? []).map(row => <div className={`core-event-position core-draggable${drag.preview?.id === row.item.id ? " core-drag-origin" : ""}`} key={row.item.id}
              onPointerDown={event => drag.begin(event, row.item, index)} onPointerMove={drag.move} onPointerUp={drag.up} onPointerCancel={drag.cancel} onLostPointerCapture={drag.cancel}
              onClick={event => { if (event.target === event.currentTarget && !drag.suppressClick()) openActivity(row.item.id, event.currentTarget); }}
              style={{ top: row.start, height: Math.min(1440 - row.start, Math.max(30, row.end - row.start)), left: `${row.left}%`, width: `${row.width}%`, zIndex: row.layer + 1 }}>
              {eventButton(row.item, false, row.textWidth)}
              {row.item.schedule!.startsAt! >= atTime(day) && <span className="core-resize-handle core-resize-start" data-resize="start" title="Arrastra para cambiar el inicio" aria-hidden="true" />}
              {row.item.schedule!.endsAt! <= atTime(plusDays(day, 1)) && <span className="core-resize-handle core-resize-end" data-resize="end" title="Arrastra para cambiar el fin" aria-hidden="true" />}
            </div>)}
            {previewItem && placements([previewItem], day).map(row => <div className="core-event-position core-drag-preview" key={row.item.id} style={{ top: row.start, height: Math.min(1440 - row.start, Math.max(30, row.end - row.start)), left: 0, width: "100%" }}><strong>{drag.preview!.title}</strong><small>{scheduleLabel(previewItem)}</small></div>)}
            {draftItem && placements([draftItem], day).map(row => <div className="core-event-position core-draggable core-week-draft" data-draft-date={day} key={row.item.id}
              onPointerDown={event => draftDrag.begin(event, draftItem, index)} onPointerMove={draftDrag.move} onPointerUp={draftDrag.up} onPointerCancel={draftDrag.cancel} onLostPointerCapture={draftDrag.cancel}
              style={{ top: row.start, height: Math.min(1440 - row.start, Math.max(30, row.end - row.start)), left: 0, width: "100%", backgroundColor: calendarById.get(draftItem.schedule.calendarId)?.color ?? "#527860" }}>
              <strong>{draftItem.title}</strong><small>{labelDate(day, { weekday: "short" })} · {dateParts(draftItem.schedule.startsAt!).time} – {dateParts(draftItem.schedule.endsAt!).time}</small>
              {draftItem.schedule.startsAt! >= atTime(day) && <span className="core-resize-handle core-resize-start" data-resize="start" title="Cambiar inicio" aria-hidden="true" />}
              {draftItem.schedule.endsAt! <= atTime(plusDays(day, 1)) && <span className="core-resize-handle core-resize-end" data-resize="end" title="Cambiar fin" aria-hidden="true" />}
            </div>)}
            {day === today && now && <div className="core-now-line" style={{ top: minuteAt(now.toISOString()) }}><span /></div>}
          </div>; })}</div>
      </div></div>}
      {feed.data.nextAfterId && <button className="core-text-button" disabled={feed.locked || feed.reading} onClick={() => void feed.load(feed.data.nextAfterId!)}>Cargar más actividades del período</button>}
    </div></section>
    {addingCalendar && <CoreDialog title="Nuevo calendario" close={() => { if (!feed.locked) setAddingCalendar(false); }}>{status()}<form className="core-edit-form" onSubmit={event => { event.preventDefault(); void mutate({ action: "createCalendar", id: crypto.randomUUID(), name: name.trim(), color }, () => { setAddingCalendar(false); setName(""); }); }}><label className="form-field">Nombre<input required maxLength={120} value={name} disabled={feed.locked} onChange={event => setName(event.target.value)} /></label><label className="form-field">Color<input type="color" value={color} disabled={feed.locked} onChange={event => setColor(event.target.value)} /></label><button className="pantry-add-button" disabled={feed.locked || !name.trim()}>Crear calendario</button></form></CoreDialog>}
    {weekDraft && !createDate && <WeekCreatePopover schedule={draftSchedule!} title={newTitle} calendars={calendars} scroll={weekScroll} disabled={feed.locked} busy={feed.busy} error={feed.error} retry={feed.retry} reattempt={feed.reattempt}
      changeTitle={setNewTitle} changeSchedule={changeDraft} close={closeCreate} meal={() => draftMore("meal")} createCalendar={createCalendarInline} previewAllDay={setAllDayPreview}
      save={(schedule, rule) => void mutate(rule ? { action: "createRecurringTask", id: crypto.randomUUID(), title: newTitle.trim(), description: null, schedule, rule } : { action: "createTask", id: crypto.randomUUID(), title: newTitle.trim(), description: null, parentId: null, expectedParentRevision: null, position: 0, schedule }, closeCreate)} />}
    {createDate && <CoreDialog title="Crear actividad" close={closeCreate} nonmodal={view === "week" && !!weekDraft && createType === "meal"}
      anchor={weekScroll.current?.querySelector<HTMLElement>(".core-week-draft") ?? undefined} dismissOutside={false} busy={feed.busy || mealLocked} popoverClassName="core-meal-create-popover">
      <label className="form-field core-new-title">Tipo de elemento<select value={createType} disabled={feed.locked || mealLocked} onChange={event => setCreateType(event.target.value as "task" | "meal")}><option value="task">Tarea</option><option value="meal">Comida</option></select></label>
      {createType === "meal" ? <AgendaMealCreator date={createDate} time={createTime!} onLockedChange={setMealLocked} close={closeCreate} saved={mealSaved} /> : <>{status()}<label className="form-field core-new-title">Nombre<input required maxLength={250} value={newTitle} disabled={feed.locked} onChange={event => setNewTitle(event.target.value)} /></label><ScheduleFields initial={weekDraft ? { ...weekDraft, startDate: null, endDate: null } : undefined} calendars={calendars} defaultDate={createDate} defaultTime={createTime} disabled={feed.locked || !newTitle.trim()} allowRecurrence createCalendar={createCalendarInline} onSave={(schedule, rule) => void mutate(rule ? { action: "createRecurringTask", id: crypto.randomUUID(), title: newTitle.trim(), description: null, schedule, rule } : { action: "createTask", id: crypto.randomUUID(), title: newTitle.trim(), description: null, parentId: null, expectedParentRevision: null, position: 0, schedule }, () => { setCreateDate(null); setWeekDraft(null); })} /></>}
    </CoreDialog>}
    {selectedId && (view === "week" && detailAnchor ? <ActivityPopover anchor={detailAnchor} close={closeDetail} busy={feed.busy}>{detailBody}</ActivityPopover>
      : <CoreDialog title="Detalle de actividad" close={() => { if (!feed.busy) closeDetail(); }}>{detailBody}</CoreDialog>)}
    {editingCalendar && <CalendarEditor calendar={editingCalendar} calendars={calendars} disabled={feed.locked} mutate={mutate} close={() => setEditingCalendar(null)} />}
  </main></CoreFeedback.Provider>;
}
