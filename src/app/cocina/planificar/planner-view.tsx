"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

const TIME_ZONE = "America/Mexico_City";
type Unit = "g" | "kg" | "ml" | "l" | "piece";
type Calendar = { id: string; summary: string; primary: boolean; selected: boolean };
type MealSlot = { id: string; name: string; defaultTime: string; position: number };
type SuggestedRecipe = {
  id: string;
  name: string;
  servings: number;
  durationMinutes: number;
  missingCount: number;
  ingredients: Array<{
    ingredientId: string;
    name: string;
    unit: Unit;
    requiredQuantity: number;
    availableQuantity: number;
    missingQuantity: number;
    equivalent: string | null;
  }>;
};
type PlannedMeal = {
  id: string;
  recipeId: string | null;
  mealSlotId: string | null;
  servings: number;
  durationMinutes: number;
  completedAt: string | null;
  googleEventId: string;
  calendarId: string;
  calendarName: string;
  etag: string | null;
  summary: string;
  startDate: string | null;
  startDateTime: string | null;
  endDate: string | null;
  endDateTime: string | null;
};

const unitLabels: Record<Unit, string> = { g: "g", kg: "kg", ml: "ml", l: "l", piece: "piezas" };

function dateKeyInMexico(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDaysToKey(value: string, amount: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function weekStart(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay();
  return addDaysToKey(value, day === 0 ? -6 : 1 - day);
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("es-MX", { timeZone: TIME_ZONE, weekday: "short", day: "numeric" })
    .format(new Date(`${value}T12:00:00Z`));
}

function dateRangeLabel(start: string, count: number) {
  const end = addDaysToKey(start, count - 1);
  const format = (key: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-MX", { ...options, timeZone: TIME_ZONE })
    .format(new Date(`${key}T12:00:00Z`));
  return `${format(start, { day: "numeric", month: "short" })} – ${format(end, { day: "numeric", month: "short", year: "numeric" })}`;
}

function timeLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("es-MX", { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "";
}

function dateTimeInput(value: string | null) {
  if (!value) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function quantitiesForServings(recipe: SuggestedRecipe, servings: number) {
  const factor = servings / recipe.servings;
  return recipe.ingredients.map((ingredient) => {
    const requiredQuantity = Math.round(ingredient.requiredQuantity * factor * 1000) / 1000;
    return { ...ingredient, requiredQuantity, missingQuantity: Math.round(Math.max(0, requiredQuantity - ingredient.availableQuantity) * 1000) / 1000 };
  });
}

function mexicoDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00-06:00`).toISOString();
}

function weekDates(start: string) {
  return Array.from({ length: 7 }, (_, index) => addDaysToKey(start, index));
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

export function PlannerView() {
  const [slots, setSlots] = useState<MealSlot[]>([]);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [weekStartKey, setWeekStartKey] = useState(() => weekStart(dateKeyInMexico(new Date())));
  const [weeksToShow, setWeeksToShow] = useState<1 | 2>(1);
  const [plans, setPlans] = useState<PlannedMeal[]>([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [plansLoading, setPlansLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<MealSlot | null>(null);
  const [slotDraft, setSlotDraft] = useState({ name: "", defaultTime: "12:00" });
  const [addingSlot, setAddingSlot] = useState(false);
  const [addSlotDraft, setAddSlotDraft] = useState({ name: "", defaultTime: "12:00" });
  const [activeCell, setActiveCell] = useState<{ slot: MealSlot; date: string } | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestedRecipe[]>([]);
  const [maxMissingIngredients, setMaxMissingIngredients] = useState(3);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [showAllRecipes, setShowAllRecipes] = useState(false);
  const [selectedRecipeId, setSelectedRecipeId] = useState("");
  const [calendarId, setCalendarId] = useState("");
  const [servings, setServings] = useState("2");
  const [durationMinutes, setDurationMinutes] = useState("45");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [plansReload, setPlansReload] = useState(0);
  const [editingPlan, setEditingPlan] = useState<PlannedMeal | null>(null);
  const [editRecipeId, setEditRecipeId] = useState("");
  const [editStartDateTime, setEditStartDateTime] = useState("");
  const [editServings, setEditServings] = useState("2");
  const [editDurationMinutes, setEditDurationMinutes] = useState("45");

  useEffect(() => {
    let cancelled = false;
    async function loadBaseData() {
      setPageLoading(true);
      try {
        const [slotsResponse, calendarsResponse] = await Promise.all([
          fetch("/api/meal-slots", { cache: "no-store" }),
          fetch("/api/calendars", { cache: "no-store" }),
        ]);
        const [slotsResult, calendarsResult] = await Promise.all([
          readJson(slotsResponse), readJson(calendarsResponse),
        ]);
        if (!slotsResponse.ok || !Array.isArray(slotsResult?.mealSlots)) throw new Error(slotsResult?.error ?? "No pudimos cargar tus comidas habituales.");
        if (!calendarsResponse.ok || !Array.isArray(calendarsResult?.calendars)) throw new Error(calendarsResult?.error ?? "No pudimos cargar tus calendarios.");
        if (cancelled) return;
        const availableCalendars = (calendarsResult.calendars as Calendar[]).filter((item) => item.selected);
        setSlots(slotsResult.mealSlots as MealSlot[]);
        setCalendars(availableCalendars);
        setCalendarId(availableCalendars.find((item) => item.primary)?.id ?? availableCalendars[0]?.id ?? "");
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No pudimos preparar el planificador.");
      } finally {
        if (!cancelled) setPageLoading(false);
      }
    }
    void loadBaseData();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadPlans() {
      setPlansLoading(true);
      const rangeEnd = addDaysToKey(weekStartKey, weeksToShow * 7);
      const from = `${weekStartKey}T00:00:00-06:00`;
      const to = `${rangeEnd}T00:00:00-06:00`;
      try {
        const response = await fetch(`/api/meals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { cache: "no-store" });
        const result = await readJson(response);
        if (!response.ok || !Array.isArray(result?.plans)) throw new Error(result?.error ?? "No pudimos cargar las comidas planeadas.");
        if (!cancelled) setPlans(result.plans as PlannedMeal[]);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No pudimos cargar las comidas planeadas.");
      } finally {
        if (!cancelled) setPlansLoading(false);
      }
    }
    void loadPlans();
    return () => { cancelled = true; };
  }, [weekStartKey, weeksToShow, plansReload]);

  useEffect(() => {
    let refreshTimer: number | undefined;
    const refreshPlansWhenVisible = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => setPlansReload((current) => current + 1), 150);
    };
    window.addEventListener("focus", refreshPlansWhenVisible);
    document.addEventListener("visibilitychange", refreshPlansWhenVisible);
    return () => {
      window.clearTimeout(refreshTimer);
      window.removeEventListener("focus", refreshPlansWhenVisible);
      document.removeEventListener("visibilitychange", refreshPlansWhenVisible);
    };
  }, []);

  const selectedRecipe = useMemo(() => suggestions.find((recipe) => recipe.id === selectedRecipeId) ?? null, [suggestions, selectedRecipeId]);

  async function loadSuggestions() {
    setSuggestionsLoading(true);
    try {
      const response = await fetch("/api/recipes/suggestions?includeAll=true", { cache: "no-store" });
      const result = await readJson(response);
      if (!response.ok || !Array.isArray(result?.suggestions)) throw new Error(result?.error ?? "No pudimos revisar tu alacena.");
      setSuggestions(result.suggestions as SuggestedRecipe[]);
      setMaxMissingIngredients(result.maxMissingIngredients ?? 3);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos revisar tu alacena.");
    } finally {
      setSuggestionsLoading(false);
    }
  }

  function openCell(slot: MealSlot, date: string) {
    setError(null);
    setNotice(null);
    setActiveCell({ slot, date });
    setSuggestions([]);
    setShowAllRecipes(false);
    setSelectedRecipeId("");
    setIdempotencyKey(null);
    setCalendarId(calendars.find((item) => item.primary)?.id ?? calendars[0]?.id ?? "");
    void loadSuggestions();
  }

  function changeWeeks(value: string) {
    const weeks = value === "2" ? 2 : 1;
    setWeeksToShow(weeks);
  }

  function shiftWeeks(amount: number) {
    setWeekStartKey((current) => addDaysToKey(current, amount * weeksToShow * 7));
  }

  function editSlot(slot: MealSlot) {
    setEditingSlot(slot);
    setSlotDraft({ name: slot.name, defaultTime: slot.defaultTime });
    setError(null);
    setNotice(null);
  }

  async function saveSlot(event: FormEvent<HTMLFormElement>, slotId?: string) {
    event.preventDefault();
    const draft = slotId ? slotDraft : addSlotDraft;
    const editing = Boolean(slotId);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(editing ? `/api/meal-slots/${encodeURIComponent(slotId!)}` : "/api/meal-slots", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos guardar esta fila.");
      if (editing) {
        setSlots((current) => current.map((slot) => slot.id === slotId ? result.mealSlot as MealSlot : slot));
        setEditingSlot(null);
        setNotice("La comida habitual se actualizó. Los eventos ya planeados conservan su horario.");
      } else {
        setSlots((current) => [...current, result.mealSlot as MealSlot].sort((a, b) => a.position - b.position));
        setAddingSlot(false);
        setAddSlotDraft({ name: "", defaultTime: "12:00" });
        setNotice("Se agregó una fila a tu planificador.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar esta fila.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSlot(slot: MealSlot) {
    if (!window.confirm(`¿Eliminar la fila “${slot.name}”? Las comidas que ya programaste seguirán en Google Calendar.`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/meal-slots/${encodeURIComponent(slot.id)}`, { method: "DELETE" });
      const result = response.status === 204 ? null : await readJson(response);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos eliminar esta fila.");
      setSlots((current) => current.filter((item) => item.id !== slot.id));
      setNotice(`Se eliminó la fila “${slot.name}”. Las comidas ya planeadas no se borraron.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos eliminar esta fila.");
    } finally {
      setSaving(false);
    }
  }

  function chooseRecipe(recipe: SuggestedRecipe) {
    setSelectedRecipeId(recipe.id);
    setServings(String(recipe.servings));
    setDurationMinutes(String(recipe.durationMinutes));
    setIdempotencyKey(null);
  }

  async function planSelectedRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeCell || !selectedRecipe || !calendarId) return;
    setSaving(true);
    setError(null);
    const requestKey = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(requestKey);
    try {
      const response = await fetch("/api/meals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipeId: selectedRecipe.id,
          calendarId,
          startDateTime: mexicoDateTime(activeCell.date, activeCell.slot.defaultTime),
          servings: Number(servings),
          durationMinutes: Number(durationMinutes),
          mealSlotId: activeCell.slot.id,
          idempotencyKey: requestKey,
        }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos programar esta receta.");
      setActiveCell(null);
      setIdempotencyKey(null);
      setNotice(`“${selectedRecipe.name}” se agregó al menú y a Google Calendar.`);
      setPlansReload((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos programar esta receta.");
    } finally {
      setSaving(false);
    }
  }

  function openPlanEditor(plan: PlannedMeal) {
    if (plan.completedAt) {
      setError("Para editar una comida completada, deshaz primero el completado desde la agenda.");
      return;
    }
    setEditingPlan(plan);
    setEditRecipeId(plan.recipeId ?? "");
    setEditStartDateTime(dateTimeInput(plan.startDateTime));
    setEditServings(String(plan.servings));
    setEditDurationMinutes(String(plan.durationMinutes));
    setError(null);
    setNotice(null);
    if (!suggestions.length) void loadSuggestions();
  }

  async function savePlanEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingPlan) return;
    const recipe = suggestions.find((item) => item.id === editRecipeId);
    if (!recipe) { setError("Elige una receta disponible."); return; }
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/meals/${encodeURIComponent(editingPlan.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeId: editRecipeId, etag: editingPlan.etag, startDateTime: new Date(`${editStartDateTime}:00-06:00`).toISOString(), servings: Number(editServings), durationMinutes: Number(editDurationMinutes) }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos editar la comida.");
      setEditingPlan(null);
      setNotice(`Se actualizó “${recipe.name}” y sus cantidades planeadas.`);
      setPlansReload((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos editar la comida.");
    } finally { setSaving(false); }
  }

  async function deletePlan(plan: PlannedMeal) {
    if (plan.completedAt) { setError("Deshaz el completado desde la agenda antes de eliminar esta comida."); return; }
    if (!window.confirm(`¿Eliminar “${plan.summary}” del menú y de Google Calendar?`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/meals/${encodeURIComponent(plan.id)}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ etag: plan.etag }) });
      const result = response.status === 204 ? null : await readJson(response);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos eliminar la comida.");
      setNotice(`“${plan.summary}” se eliminó del menú y de Google Calendar.`);
      setPlansReload((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos eliminar la comida.");
    } finally { setSaving(false); }
  }

  async function togglePlanCompletion(plan: PlannedMeal) {
    const action = plan.completedAt ? "uncomplete" : "complete";
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/events/${encodeURIComponent(plan.googleEventId)}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calendarId: plan.calendarId }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error ?? `No pudimos ${action === "complete" ? "completar" : "deshacer"} esta comida.`);
      setNotice(action === "complete" ? `“${plan.summary}” se marcó como completada.` : `“${plan.summary}” volvió a estar pendiente.`);
      setPlansReload((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos actualizar esta comida.");
    } finally { setSaving(false); }
  }

  const visibleSuggestions = showAllRecipes
    ? suggestions
    : suggestions.filter((recipe) => recipe.missingCount <= maxMissingIngredients);
  const plansByCell = useMemo(() => {
    const grouped = new Map<string, PlannedMeal[]>();
    for (const plan of plans) {
      const date = plan.startDate ?? (plan.startDateTime ? dateKeyInMexico(new Date(plan.startDateTime)) : null);
      if (!date || !plan.mealSlotId) continue;
      const key = `${plan.mealSlotId}\u0000${date}`;
      grouped.set(key, [...(grouped.get(key) ?? []), plan]);
    }
    return grouped;
  }, [plans]);
  const unassignedPlans = plans.filter((plan) => !plan.mealSlotId);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="MiAgenda, inicio"><span className="brand-mark">m</span><span>miagenda</span></a>
        <nav className="primary-nav" aria-label="Navegación principal">
          <a className="nav-item" href="/"><span className="nav-icon" aria-hidden="true">▦</span>Agenda</a>
          <a className="nav-item" href="/cocina"><span className="nav-icon" aria-hidden="true">♨</span>Alacena</a>
          <a className="nav-item" href="/cocina/recetas"><span className="nav-icon" aria-hidden="true">▤</span>Recetas</a>
          <a className="nav-item nav-item-active" href="/cocina/planificar" aria-current="page"><span className="nav-icon" aria-hidden="true">◷</span>Planificar</a>
          <a className="nav-item" href="/cocina/compras"><span className="nav-icon" aria-hidden="true">☷</span>Compras</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-line"><span className="privacy-dot" />Tus datos, bajo tu control</div>
          <div className="profile-row"><div className="avatar">E</div><div className="profile-copy"><strong>Tu espacio</strong><span>Cuenta personal</span></div></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="breadcrumb"><span>Mi espacio</span><span className="breadcrumb-slash">/</span><strong>Cocina</strong><span className="breadcrumb-slash">/</span><strong>Planificar</strong></div></header>
        <div className="page-content pantry-content meal-planner-content">
          <div className="page-heading-row pantry-heading meal-planner-heading">
            <div><p className="eyebrow">MENÚ Y HORARIOS</p><h1>Planificar comidas</h1><p className="week-range">Elige una receta en cada día. Se agregará a Google Calendar con su hora habitual.</p></div>
            <div className="meal-planner-toolbar">
              <label className="meal-weeks-select">Mostrar<select aria-label="Semanas visibles" value={weeksToShow} onChange={(event) => changeWeeks(event.target.value)}><option value="1">1 semana</option><option value="2">2 semanas</option></select></label>
              <div className="week-arrows"><button type="button" aria-label="Semanas anteriores" onClick={() => shiftWeeks(-1)}>‹</button><button type="button" aria-label="Semanas siguientes" onClick={() => shiftWeeks(1)}>›</button></div>
              <button className="today-button" type="button" onClick={() => setWeekStartKey(weekStart(dateKeyInMexico(new Date())))}>Hoy</button>
            </div>
          </div>

          {error && !activeCell && <p className="pantry-message pantry-error" role="alert">{error}</p>}
          {notice && !activeCell && <p className="pantry-message" role="status">{notice} <a href="/">Ver agenda</a></p>}

          <div className="meal-planner-actions">
            <span>{dateRangeLabel(weekStartKey, weeksToShow * 7)}</span>
            <button className="pantry-add-button" type="button" disabled={addingSlot} onClick={() => { setAddingSlot(true); setError(null); setNotice(null); setAddSlotDraft({ name: "", defaultTime: "12:00" }); }}>＋ Agregar comida</button>
          </div>

          {addingSlot && <form className="meal-slot-create" onSubmit={(event) => void saveSlot(event)}>
            <label className="form-field">Nombre<input autoFocus type="text" maxLength={60} value={addSlotDraft.name} onChange={(event) => setAddSlotDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Ej. Colación" required /></label>
            <label className="form-field">Hora habitual<input type="time" value={addSlotDraft.defaultTime} onChange={(event) => setAddSlotDraft((current) => ({ ...current, defaultTime: event.target.value }))} required /></label>
            <div className="meal-slot-edit-actions"><button type="button" className="dialog-cancel" disabled={saving} onClick={() => setAddingSlot(false)}>Cancelar</button><button type="submit" className="dialog-submit" disabled={saving}>{saving ? "Guardando…" : "Agregar fila"}</button></div>
          </form>}

          {pageLoading ? <p className="pantry-empty">Cargando tu menú…</p> : <div className="meal-weeks">
            {Array.from({ length: weeksToShow }, (_, weekIndex) => {
              const currentStart = addDaysToKey(weekStartKey, weekIndex * 7);
              const days = weekDates(currentStart);
              return <section className="meal-week-card" key={currentStart} aria-label={`Semana ${dateRangeLabel(currentStart, 7)}`}>
                <div className="meal-week-heading"><h2>{dateRangeLabel(currentStart, 7)}</h2>{plansLoading && <span>Sincronizando…</span>}</div>
                <div className="meal-table-scroll"><table className="meal-plan-table">
                  <thead><tr><th className="meal-slot-column" scope="col">Comida</th>{days.map((day) => <th scope="col" key={day}>{dateLabel(day)}</th>)}</tr></thead>
                  <tbody>{slots.map((slot) => <tr key={slot.id}>
                    <th className="meal-slot-column" scope="row">
                      {editingSlot?.id === slot.id ? <form className="meal-slot-edit" onSubmit={(event) => void saveSlot(event, slot.id)}>
                        <label>Nombre<input autoFocus type="text" maxLength={60} value={slotDraft.name} onChange={(event) => setSlotDraft((current) => ({ ...current, name: event.target.value }))} required /></label>
                        <label>Hora<input type="time" value={slotDraft.defaultTime} onChange={(event) => setSlotDraft((current) => ({ ...current, defaultTime: event.target.value }))} required /></label>
                        <div className="meal-slot-edit-actions"><button type="button" disabled={saving} onClick={() => setEditingSlot(null)}>Cancelar</button><button type="submit" disabled={saving}>{saving ? "…" : "Guardar"}</button></div>
                      </form> : <div className="meal-slot-label"><strong>{slot.name}</strong><span>{slot.defaultTime}</span><div className="meal-slot-actions"><button type="button" aria-label={`Editar ${slot.name}`} title="Editar nombre y hora" disabled={saving} onClick={() => editSlot(slot)}>Editar</button><button type="button" aria-label={`Eliminar fila ${slot.name}`} title="Eliminar fila" disabled={saving} onClick={() => void deleteSlot(slot)}>×</button></div></div>}
                    </th>
                    {days.map((day) => {
                      const cellPlans = plansByCell.get(`${slot.id}\u0000${day}`) ?? [];
                      return <td key={day}><div className="meal-plan-cell">
                        {cellPlans.map((plan) => <div className={`meal-plan-chip${plan.completedAt ? " meal-plan-chip-completed" : ""}`} key={plan.id} title={`${plan.summary} · ${plan.servings} porciones`}>
                          <strong>{plan.summary}</strong><span>{timeLabel(plan.startDateTime)} · {plan.servings} porciones · {plan.durationMinutes} min</span>
                          <div className="meal-plan-actions"><button className={`meal-completion-toggle${plan.completedAt ? " meal-completion-toggle-checked" : ""}`} type="button" disabled={saving} aria-pressed={Boolean(plan.completedAt)} aria-label={`${plan.completedAt ? "Deshacer completado de" : "Completar"} ${plan.summary}`} title={plan.completedAt ? "Deshacer completado" : "Marcar como completada"} onClick={() => void togglePlanCompletion(plan)}>{plan.completedAt ? "✓" : ""}</button><button type="button" title={plan.completedAt ? "Deshaz el completado desde la agenda antes de editar" : "Editar receta, fecha, hora, porciones y duración"} disabled={saving || Boolean(plan.completedAt)} onClick={() => openPlanEditor(plan)}>Editar</button><button type="button" disabled={saving || Boolean(plan.completedAt)} aria-label={`Eliminar ${plan.summary}`} title={plan.completedAt ? "Deshaz el completado desde la agenda antes de eliminar" : "Eliminar la comida planeada"} onClick={() => void deletePlan(plan)}>Eliminar</button></div>
                        </div>)}
                        <button className="meal-cell-add" type="button" aria-label={`${cellPlans.length ? "Agregar otra receta" : "Agregar receta"} para ${slot.name}, ${dateLabel(day)}`} onClick={() => openCell(slot, day)}><span aria-hidden="true">＋</span>{cellPlans.length ? "Agregar otra receta" : "Agregar receta"}</button>
                      </div></td>;
                    })}
                  </tr>)}
                  {slots.length === 0 && <tr><td className="meal-no-slots" colSpan={8}>No hay filas. Usa “Agregar comida” para crear una.</td></tr>}
                  </tbody>
                </table></div>
              </section>;
            })}
          </div>}

          {unassignedPlans.length > 0 && <section className="meal-unassigned">
            <h2>Comidas planeadas sin una fila</h2><p>Son planes anteriores a las filas habituales; siguen en Google Calendar.</p>
            <ul>{unassignedPlans.map((plan) => <li key={plan.id}><strong>{plan.summary}</strong><span>{plan.startDateTime ? `${dateLabel(dateKeyInMexico(new Date(plan.startDateTime)))} · ${timeLabel(plan.startDateTime)}` : plan.startDate}</span><div className="meal-plan-actions"><button className={`meal-completion-toggle${plan.completedAt ? " meal-completion-toggle-checked" : ""}`} type="button" disabled={saving} aria-pressed={Boolean(plan.completedAt)} aria-label={`${plan.completedAt ? "Deshacer completado de" : "Completar"} ${plan.summary}`} title={plan.completedAt ? "Deshacer completado" : "Marcar como completada"} onClick={() => void togglePlanCompletion(plan)}>{plan.completedAt ? "✓" : ""}</button><button type="button" disabled={saving || Boolean(plan.completedAt)} onClick={() => openPlanEditor(plan)}>Editar</button><button type="button" disabled={saving || Boolean(plan.completedAt)} onClick={() => void deletePlan(plan)}>Eliminar</button></div></li>)}</ul>
          </section>}
        </div>
      </section>

      {activeCell && <div className="dialog-backdrop meal-suggestion-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setActiveCell(null); }}>
        <section className="event-dialog meal-suggestion-dialog" role="dialog" aria-modal="true" aria-labelledby="meal-suggestion-title">
          <div className="dialog-heading"><div><p className="eyebrow">{activeCell.slot.name} · {dateLabel(activeCell.date)} · {activeCell.slot.defaultTime}</p><h2 id="meal-suggestion-title">Elige una receta</h2></div><button className="dialog-close" type="button" disabled={saving} onClick={() => setActiveCell(null)} aria-label="Cerrar">×</button></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <label className="form-field meal-calendar-field">Calendario de Google<select value={calendarId} onChange={(event) => setCalendarId(event.target.value)} disabled={!calendars.length || saving}>
            {calendars.length === 0 ? <option value="">No hay calendarios activos</option> : calendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.summary}</option>)}
          </select></label>
          {!calendars.length && <p className="form-hint">Activa un calendario desde la agenda para programar comidas.</p>}
          <div className="meal-suggestion-toolbar"><p>{showAllRecipes ? "Todas tus recetas, ordenadas según tu alacena." : `Sugerencias con hasta ${maxMissingIngredients} ingredientes faltantes.`}</p><button type="button" onClick={() => setShowAllRecipes((value) => !value)}>{showAllRecipes ? "Ver sugerencias" : "Ver todas las recetas"}</button></div>
          {suggestionsLoading ? <p className="pantry-empty">Revisando tu alacena…</p>
            : visibleSuggestions.length === 0 ? <p className="pantry-empty">No hay sugerencias. Prueba “Ver todas las recetas” o agrega ingredientes a tu alacena.</p>
              : <ul className="meal-suggestion-list">{visibleSuggestions.map((recipe) => {
                const isSelected = selectedRecipeId === recipe.id;
                const shownServings = isSelected && Number(servings) > 0 ? Number(servings) : recipe.servings;
                const shownIngredients = quantitiesForServings(recipe, shownServings);
                const missingCount = shownIngredients.filter((item) => item.missingQuantity > 0).length;
                return <li className={`meal-suggestion-card${isSelected ? " meal-suggestion-card-selected" : ""}`} key={recipe.id}>
                  <div className="meal-suggestion-card-head"><div><strong>{recipe.name}</strong><span>{shownServings} porciones · {recipe.durationMinutes} min</span></div><span className={`suggestion-status${missingCount === 0 ? " suggestion-ready" : ""}`}>{missingCount === 0 ? "Tienes todo" : `Faltan ${missingCount}`}</span></div>
                  {missingCount > 0 && <p className="meal-suggestion-missing">{shownIngredients.filter((item) => item.missingQuantity > 0).map((item) => `${item.name}: faltan ${item.missingQuantity} ${unitLabels[item.unit]}`).join(" · ")}</p>}
                  <button type="button" className="pantry-save-button" disabled={saving} aria-pressed={isSelected} onClick={() => chooseRecipe(recipe)}>{isSelected ? "Seleccionada" : "Elegir"}</button>
                </li>;
              })}</ul>}
          {selectedRecipe && <form className="meal-selected-recipe" onSubmit={(event) => void planSelectedRecipe(event)}>
            <div className="meal-selected-heading"><strong>{selectedRecipe.name}</strong><span>Se programará a las {activeCell.slot.defaultTime}</span></div>
            <div className="meal-selected-fields">
              <label className="form-field">Porciones<input type="number" min="1" max="100" step="1" value={servings} onChange={(event) => { setServings(event.target.value); setIdempotencyKey(null); }} required /></label>
              <label className="form-field">Duración (minutos)<input type="number" min="5" max="480" step="5" value={durationMinutes} onChange={(event) => { setDurationMinutes(event.target.value); setIdempotencyKey(null); }} required /></label>
            </div>
            <p className="form-hint">Las cantidades se guardan para las porciones que programes. El inventario se descuenta al completar en la agenda.</p>
            <div className="dialog-actions"><button type="button" className="dialog-cancel" disabled={saving} onClick={() => { setSelectedRecipeId(""); setIdempotencyKey(null); }}>Cambiar receta</button><button className="dialog-submit" type="submit" disabled={saving || !calendarId}>{saving ? "Agregando…" : "Agregar al menú"}</button></div>
          </form>}
        </section>
      </div>}

      {editingPlan && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) setEditingPlan(null); }}>
        <section className="event-dialog meal-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="meal-edit-title">
          <div className="dialog-heading"><div><p className="eyebrow">EDITAR COMIDA PLANEADA</p><h2 id="meal-edit-title">{editingPlan.summary}</h2></div><button className="dialog-close" type="button" disabled={saving} onClick={() => setEditingPlan(null)} aria-label="Cerrar">×</button></div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <form className="event-form" onSubmit={(event) => void savePlanEdit(event)}>
            <label className="form-field">Receta<select value={editRecipeId} onChange={(event) => setEditRecipeId(event.target.value)} required disabled={saving || suggestionsLoading}><option value="">Elige receta</option>{suggestions.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}</select></label>
            <label className="form-field">Día y hora<input type="datetime-local" value={editStartDateTime} onChange={(event) => setEditStartDateTime(event.target.value)} required disabled={saving} /></label>
            <div className="meal-selected-fields"><label className="form-field">Porciones<input type="number" min="1" max="100" step="1" value={editServings} onChange={(event) => setEditServings(event.target.value)} required disabled={saving} /></label><label className="form-field">Duración (minutos)<input type="number" min="5" max="480" step="5" value={editDurationMinutes} onChange={(event) => setEditDurationMinutes(event.target.value)} required disabled={saving} /></label></div>
            <p className="form-hint">Cambiar receta o porciones también actualiza los ingredientes que se descontarán al completar.</p>
            <div className="dialog-actions"><button className="dialog-cancel" type="button" disabled={saving} onClick={() => setEditingPlan(null)}>Cancelar</button><button className="dialog-submit" type="submit" disabled={saving || suggestionsLoading}>{saving ? "Guardando…" : "Guardar cambios"}</button></div>
          </form>
        </section>
      </div>}
    </main>
  );
}
