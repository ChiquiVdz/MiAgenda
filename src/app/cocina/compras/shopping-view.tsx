"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Unit = "g" | "kg" | "ml" | "l" | "piece";
type MealPlan = { id: string; completedAt: string | null };
type ShoppingItem = {
  id: string;
  ingredientId: string | null;
  nameSnapshot: string;
  unit: Unit | null;
  customUnit: string | null;
  quantity: string;
  purchasedQuantity: string | null;
  purchasedAt: string | null;
};
type ShoppingList = { id: string; recipeNameSnapshot: string; createdAt: string; items: ShoppingItem[] };
const unitLabels: Record<Unit, string> = { g: "g", kg: "kg", ml: "ml", l: "l", piece: "piezas" };
const customUnits = ["pieza", "paquete", "caja", "botella", "bolsa", "otro"];

function addDays(value: string, count: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
function currentDateKey() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function weekStart(value: string) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return addDays(value, day === 0 ? -6 : 1 - day);
}
function rangeLabel(start: string, weeks: 1 | 2) {
  const end = addDays(start, weeks * 7 - 1);
  const format = (value: string) => new Intl.DateTimeFormat("es-MX", { timeZone: "America/Mexico_City", day: "numeric", month: "short" }).format(new Date(`${value}T12:00:00Z`));
  return `${format(start)} – ${format(end)}`;
}
async function readJson(response: Response) { return response.json().catch(() => null); }

export function ShoppingView() {
  const [weekStartKey, setWeekStartKey] = useState(() => weekStart(currentDateKey()));
  const [weeks, setWeeks] = useState<1 | 2>(1);
  const [list, setList] = useState<ShoppingList | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [freeName, setFreeName] = useState("");
  const [freeQuantity, setFreeQuantity] = useState("1");
  const [freeUnit, setFreeUnit] = useState("pieza");
  const syncing = useRef(false);
  const dirtyDraftIds = useRef(new Set<string>());

  const range = useMemo(() => {
    const endDate = addDays(weekStartKey, weeks * 7);
    return { from: `${weekStartKey}T00:00:00-06:00`, to: `${endDate}T00:00:00-06:00` };
  }, [weekStartKey, weeks]);

  async function syncList() {
    if (syncing.current) return;
    syncing.current = true;
    setLoading(true);
    setError(null);
    try {
      const plansResponse = await fetch(`/api/meals?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`, { cache: "no-store" });
      const plansResult = await readJson(plansResponse);
      if (!plansResponse.ok || !Array.isArray(plansResult?.plans)) throw new Error(plansResult?.error ?? "No pudimos consultar las comidas planeadas.");
      const mealPlanIds = (plansResult.plans as MealPlan[]).filter((plan) => !plan.completedAt).map((plan) => plan.id);
      const response = await fetch("/api/shopping-lists/planned", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...range, mealPlanIds }),
      });
      const result = await readJson(response);
      if (!response.ok || !result?.list) throw new Error(result?.error ?? "No pudimos consolidar los ingredientes.");
      const next = result.list as ShoppingList;
      setList(next);
      setDrafts((current) => Object.fromEntries(next.items.map((item) => [item.id, dirtyDraftIds.current.has(item.id) && current[item.id] !== undefined ? current[item.id] : item.quantity])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos abrir la lista de compras.");
    } finally { syncing.current = false; setLoading(false); }
  }

  useEffect(() => { void syncList(); }, [weekStartKey, weeks]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible" && !loading && !saving) void syncList();
    };
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [weekStartKey, weeks, loading, saving]);

  async function addFreeItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!list) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/shopping-lists/${encodeURIComponent(list.id)}/items`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: freeName, quantity: Number(freeQuantity), customUnit: freeUnit }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos agregar el artículo.");
      setFreeName(""); setFreeQuantity("1");
      await syncList();
      setNotice("Se agregó el artículo a la lista.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos agregar el artículo."); }
    finally { setSaving(false); }
  }

  async function removeFreeItem(item: ShoppingItem) {
    if (!list || item.ingredientId || item.purchasedAt) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/shopping-lists/${encodeURIComponent(list.id)}/items/${encodeURIComponent(item.id)}`, { method: "DELETE" });
      if (!response.ok) { const result = await readJson(response); throw new Error(result?.error ?? "No pudimos quitar el artículo."); }
      setList((current) => current ? { ...current, items: current.items.filter((entry) => entry.id !== item.id) } : current);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos quitar el artículo."); }
    finally { setSaving(false); }
  }

  async function checkout() {
    if (!list) return;
    const pending = list.items.filter((item) => !item.purchasedAt);
    const quantities = pending.map((item) => ({ itemId: item.id, quantity: Number(drafts[item.id] ?? item.quantity) }));
    if (quantities.some((item) => !Number.isFinite(item.quantity) || item.quantity <= 0)) { setError("Revisa que todas las cantidades sean mayores que cero."); return; }
    setSaving(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`/api/shopping-lists/${encodeURIComponent(list.id)}/checkout`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantities }),
      });
      const result = await readJson(response);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos registrar la compra.");
      for (const item of pending) dirtyDraftIds.current.delete(item.id);
      await syncList();
      setNotice(`Compra registrada: ${result.purchasedCount} artículos; ${result.pantryItems} ingredientes se sumaron a la alacena.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos registrar la compra."); }
    finally { setSaving(false); }
  }

  const pendingCount = list?.items.filter((item) => !item.purchasedAt).length ?? 0;
  const purchasedCount = list?.items.length ? list.items.length - pendingCount : 0;
  const hasMeals = Boolean(list?.items.some((item) => item.ingredientId));

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="MiAgenda, inicio"><span className="brand-mark">m</span><span>miagenda</span></a>
        <nav className="primary-nav" aria-label="Navegación principal">
          <a className="nav-item" href="/"><span className="nav-icon" aria-hidden="true">▦</span>Agenda</a>
          <a className="nav-item" href="/cocina"><span className="nav-icon" aria-hidden="true">♨</span>Alacena</a>
          <a className="nav-item" href="/cocina/recetas"><span className="nav-icon" aria-hidden="true">▤</span>Recetas</a>
          <a className="nav-item" href="/cocina/planificar"><span className="nav-icon" aria-hidden="true">◷</span>Planificar</a>
          <a className="nav-item nav-item-active" href="/cocina/compras" aria-current="page"><span className="nav-icon" aria-hidden="true">☷</span>Compras</a>
        </nav>
        <div className="sidebar-bottom"><div className="privacy-line"><span className="privacy-dot" />Tus datos, bajo tu control</div><div className="profile-row"><div className="avatar">E</div><div className="profile-copy"><strong>Tu espacio</strong><span>Cuenta personal</span></div></div></div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="breadcrumb"><span>Mi espacio</span><span className="breadcrumb-slash">/</span><strong>Cocina</strong><span className="breadcrumb-slash">/</span><strong>Compras</strong></div></header>
        <div className="page-content pantry-content shopping-content">
          <div className="page-heading-row pantry-heading shopping-page-heading"><div><p className="eyebrow">TODO LO QUE NECESITAS</p><h1>Lista de compras</h1><p className="week-range">Consolidada desde tus comidas planeadas; lo comprado se suma a la alacena.</p></div>
            <div className="meal-planner-toolbar"><label className="meal-weeks-select">Mostrar<select aria-label="Semanas visibles" value={weeks} onChange={(event) => setWeeks(event.target.value === "2" ? 2 : 1)}><option value="1">1 semana</option><option value="2">2 semanas</option></select></label><div className="week-arrows"><button type="button" aria-label="Semanas anteriores" onClick={() => setWeekStartKey((value) => addDays(value, -7 * weeks))}>‹</button><button type="button" aria-label="Semanas siguientes" onClick={() => setWeekStartKey((value) => addDays(value, 7 * weeks))}>›</button></div><button className="today-button" type="button" onClick={() => setWeekStartKey(weekStart(currentDateKey()))}>Hoy</button></div>
          </div>
          <div className="shopping-period-toolbar"><strong>{rangeLabel(weekStartKey, weeks)}</strong><span>Se actualiza al abrir o volver a esta pantalla.</span></div>
          {error && <p className="pantry-message pantry-error" role="alert">{error}</p>}
          {notice && <p className="pantry-message" role="status">{notice} <a href="/cocina">Ver alacena</a></p>}

          <section className="shopping-lists" aria-labelledby="shopping-list-heading">
            <div className="pantry-list-heading"><div><h2 id="shopping-list-heading">Compras del periodo</h2><span>{list?.items.length ?? 0} artículos · {purchasedCount} comprados</span></div><button className="pantry-add-button" type="button" onClick={() => void checkout()} disabled={loading || saving || pendingCount === 0}>{saving ? "Guardando…" : "Marcar todo como comprado"}</button></div>
            {loading ? <p className="pantry-empty">Reuniendo tus comidas planeadas…</p>
              : !list?.items.length ? <p className="pantry-empty">La lista está vacía. <a href="/cocina/planificar">Planea recetas para estas fechas</a> o agrega artículos libres abajo.</p>
                : <ul className="shopping-list-items">{list.items.map((item) => {
                  const unit = item.unit ? unitLabels[item.unit] : item.customUnit ?? "unidades";
                  return <li className={`shopping-list-item${item.purchasedAt ? " shopping-list-item-bought" : ""}`} key={item.id}>
                    <div className="shopping-item-name"><strong>{item.nameSnapshot}</strong><span>{item.purchasedAt ? `Comprado: ${item.purchasedQuantity} ${unit}` : item.ingredientId ? `Necesario para el menú · ${unit}` : `Artículo libre · ${unit}`}</span></div>
                    {!item.purchasedAt ? <div className="shopping-item-buy"><label className="pantry-quantity">Cantidad a comprar ({unit})<input aria-label={`Cantidad de ${item.nameSnapshot}`} type="number" min="0.001" max="999999999.999" step="0.001" value={drafts[item.id] ?? item.quantity} disabled={saving} onChange={(event) => { dirtyDraftIds.current.add(item.id); setDrafts((current) => ({ ...current, [item.id]: event.target.value })); }} /> </label>{!item.ingredientId && <button className="shopping-remove-button" type="button" aria-label={`Quitar ${item.nameSnapshot}`} disabled={saving} onClick={() => void removeFreeItem(item)}>Quitar</button>}</div>
                      : <span className="shopping-item-confirmed">✓ Comprado</span>}
                  </li>;
                })}</ul>}
            {hasMeals && <p className="shopping-list-note">Las cantidades incluyen el total de las recetas planeadas menos lo que ya hay en la alacena. Los artículos libres no cambian el inventario.</p>}
          </section>

          <form className="shopping-free-form" onSubmit={(event) => void addFreeItem(event)}>
            <div className="pantry-list-heading"><div><h2>Agregar artículo libre</h2><span>Para cosas que no forman parte de una receta, como jabón.</span></div></div>
            <div className="shopping-free-fields"><label className="form-field">Artículo<input type="text" maxLength={100} placeholder="Ej. Jabón para trastes" value={freeName} onChange={(event) => setFreeName(event.target.value)} required disabled={saving || loading} /></label><label className="form-field">Cantidad<input type="number" min="0.001" max="999999999.999" step="0.001" value={freeQuantity} onChange={(event) => setFreeQuantity(event.target.value)} required disabled={saving || loading} /></label><label className="form-field">Unidad<select value={freeUnit} onChange={(event) => setFreeUnit(event.target.value)} disabled={saving || loading}>{customUnits.map((unit) => <option value={unit} key={unit}>{unit}</option>)}</select></label><button className="pantry-add-button" type="submit" disabled={!list || saving || loading}>＋ Agregar a la lista</button></div>
          </form>
        </div>
      </section>
    </main>
  );
}
