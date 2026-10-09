"use client";
import { coreFetch, localMode } from "../core/local-data";
import Link from "../core/local-link";
import { AppNavigation } from "../core/app-navigation";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { signOut } from "../core/local-data";
import type { ActivityView } from "../../../reconstruction/core/src/views";

import { useCoreFeed } from "../core/use-core-feed";
import { TaskCard } from "../core/task-card";
import { CoreFeedback, type CalendarView } from "../core/schedule-editor";

type InboxData = { items: ActivityView[]; dataRevision: string; nextAfterId: string | null };

export function CoreInboxView({ initialData, calendars: initialCalendars }: { initialData: InboxData; calendars: CalendarView[] }) {
  const [draft, setDraft] = useState("");
  const [calendars, setCalendars] = useState(initialCalendars), [calendarError, setCalendarError] = useState<string | null>(null);
  const calendarGeneration = useRef(0);
  async function refreshCalendars(action?: string) {
    if (action) return;
    const version = ++calendarGeneration.current;
    try {
      const response = await coreFetch("/api/core?view=calendars", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "No pudimos actualizar los calendarios.");
      if (calendarGeneration.current === version) { setCalendars(result.items); setCalendarError(null); }
    } catch { setCalendarError("No pudimos actualizar los calendarios. Pulsa Actualizar para reintentar."); }
  }
  const { data, busy, reading, error, retry, notice, locked, mutate, load, reattempt } = useCoreFeed(initialData, "view=inbox&limit=50", item => !item.parentId && !item.schedule, action => { void refreshCalendars(action); });

  const { pending, completed } = useMemo(() => {
    const sorted = [...data.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    return { pending: sorted.filter(item => !item.completedAt), completed: sorted.filter(item => item.completedAt) };
  }, [data.items]);
  function group(items: ActivityView[]) {
    return <ul className="core-inbox-list">{items.map(item => <TaskCard key={item.id} item={item} calendars={calendars} disabled={locked} mutate={mutate} />)}</ul>;
  }
  async function add(event: FormEvent) {
    event.preventDefault();
    await mutate({ action: "createTask", id: crypto.randomUUID(), title: draft.trim(),
      description: null, parentId: null, expectedParentRevision: null, position: 0 }, () => setDraft(""));
  }
  return <CoreFeedback.Provider value={{ error, retry, busy, reattempt }}><main className="app-shell"><AppNavigation footer="Tus pendientes, en MiAgenda" /><section className="workspace"><header className="topbar"><div className="breadcrumb"><span>Mi espacio</span><span className="breadcrumb-slash">/</span><strong>Inbox</strong></div>
    <button className="core-text-button" type="button" disabled={locked} onClick={() => void signOut({ callbackUrl: "/login" })}>Cerrar sesión</button></header>
    <div className="page-content"><div className="today-agenda"><div className="page-heading-row"><div><p className="eyebrow">CAPTURA RÁPIDA</p><h1>Inbox</h1><p className="week-range">Anota lo que tienes pendiente y organízalo en subtareas.</p></div>
      </div>
      <form className="inbox-add" onSubmit={event => void add(event)}><label className="form-field">Nuevo pendiente<input maxLength={250} required autoFocus placeholder="Examen a las 3 el jueves" value={draft} disabled={locked} onChange={event => setDraft(event.target.value)} /></label>
        <button className="pantry-add-button" type="submit" disabled={locked || !draft.trim()}>＋ Agregar</button></form>
      {error && <div className="pantry-message pantry-error" role="alert">{error} {retry && <button type="button" disabled={busy} onClick={() => { reattempt(); }}>Reintentar cambio</button>}
        <Link prefetch={false} className="core-login-link" href="/login">Volver al acceso</Link></div>}
      {notice && <p className="pantry-message" role="status">{notice}</p>}
      {calendarError && <p className="pantry-message pantry-error" role="alert">{calendarError}</p>}
      <section className="today-group"><h2>Pendientes <span>{pending.length}</span></h2>{pending.length ? group(pending) : <p className="today-empty">No tienes pendientes en Inbox.</p>}</section>
      {completed.length > 0 && <details className="inbox-completed"><summary>Completados ({completed.length})</summary>{group(completed)}</details>}
      {data.nextAfterId && <button className="core-text-button" type="button" disabled={locked || reading} onClick={() => void load(data.nextAfterId!)}>Cargar más pendientes y completados</button>}
    </div></div>
  </section></main></CoreFeedback.Provider>;
}
