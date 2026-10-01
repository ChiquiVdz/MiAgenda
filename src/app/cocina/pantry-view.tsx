"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { normalizeIngredientName } from "@/lib/ingredients";

type IngredientUnit = "g" | "kg" | "ml" | "l" | "piece";
type IngredientOption = { id: string; name: string; unit: IngredientUnit; isBuiltin: boolean };
type PantryRow = IngredientOption & { pantryItem: { id: string; quantity: string } };

const unitLabels: Record<IngredientUnit, string> = {
  g: "g", kg: "kg", ml: "ml", l: "l", piece: "piezas",
};

export function PantryView() {
  const [items, setItems] = useState<PantryRow[]>([]);
  const [catalog, setCatalog] = useState<IngredientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customUnit, setCustomUnit] = useState<IngredientUnit>("g");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  async function loadItems() {
    const response = await fetch("/api/pantry", { cache: "no-store" });
    const result = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(result?.items)) throw new Error(result?.error ?? "No pudimos cargar la alacena.");
    const loaded = result.items as PantryRow[];
    setItems(loaded);
    setDrafts(Object.fromEntries(loaded.map((item) => [item.pantryItem.id, String(item.pantryItem.quantity)])));
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [pantryResponse, catalogResponse] = await Promise.all([
          fetch("/api/pantry", { cache: "no-store" }),
          fetch("/api/ingredients", { cache: "no-store" }),
        ]);
        const [pantryResult, catalogResult] = await Promise.all([
          pantryResponse.json().catch(() => null), catalogResponse.json().catch(() => null),
        ]);
        if (!pantryResponse.ok || !Array.isArray(pantryResult?.items)) throw new Error(pantryResult?.error ?? "No pudimos cargar la alacena.");
        if (!catalogResponse.ok || !Array.isArray(catalogResult?.ingredients)) throw new Error(catalogResult?.error ?? "No pudimos cargar el catálogo.");
        if (cancelled) return;
        const loaded = pantryResult.items as PantryRow[];
        setItems(loaded);
        setDrafts(Object.fromEntries(loaded.map((item) => [item.pantryItem.id, String(item.pantryItem.quantity)])));
        setCatalog(catalogResult.ingredients as IngredientOption[]);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No pudimos cargar la alacena.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  const filteredCatalog = useMemo(() => {
    const query = normalizeIngredientName(search);
    return catalog.filter((ingredient) => !query || normalizeIngredientName(ingredient.name).includes(query));
  }, [catalog, search]);
  const selectedIngredient = catalog.find((ingredient) => ingredient.id === selectedId) ?? null;

  async function addIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!selectedIngredient) {
      setError("Elige un ingrediente del catálogo antes de agregarlo.");
      return;
    }
    const quantity = Number(new FormData(form).get("quantity"));
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/pantry", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId: selectedIngredient.id, quantity }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos agregar el ingrediente.");
      form.reset();
      await loadItems();
      setNotice(`${selectedIngredient.name} se agregó a tu alacena.`);
      setSelectedId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos agregar el ingrediente.");
    } finally {
      setSaving(false);
    }
  }

  async function createCustomIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/ingredients", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: customName, unit: customUnit }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos crear el ingrediente.");
      const ingredient = result.ingredient as IngredientOption;
      setCatalog((current) => [...current, ingredient].sort((a, b) => Number(b.isBuiltin) - Number(a.isBuiltin) || a.name.localeCompare(b.name, "es")));
      setSelectedId(ingredient.id);
      setSearch(ingredient.name);
      setCustomName("");
      setCustomOpen(false);
      setNotice(`${ingredient.name} ya está disponible en tu catálogo.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos crear el ingrediente.");
    } finally {
      setSaving(false);
    }
  }

  async function saveItem(item: PantryRow) {
    const quantity = Number(drafts[item.pantryItem.id]);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/pantry/${encodeURIComponent(item.pantryItem.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ quantity }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos actualizar la cantidad.");
      await loadItems();
      setNotice(`${item.name} actualizado.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos actualizar la cantidad.");
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(item: PantryRow) {
    if (!window.confirm(`¿Quitar ${item.name} de la alacena?`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/pantry/${encodeURIComponent(item.pantryItem.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos quitar el ingrediente.");
      await loadItems();
      setNotice(`${item.name} se quitó de la alacena.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos quitar el ingrediente.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="MiAgenda, inicio"><span className="brand-mark">m</span><span>miagenda</span></a>
        <nav className="primary-nav" aria-label="Navegación principal">
          <a className="nav-item" href="/"><span className="nav-icon" aria-hidden="true">▦</span>Agenda</a>
          <a className="nav-item nav-item-active" href="/cocina" aria-current="page"><span className="nav-icon" aria-hidden="true">♨</span>Alacena</a>
          <a className="nav-item" href="/cocina/recetas"><span className="nav-icon" aria-hidden="true">▤</span>Recetas</a>
          <a className="nav-item" href="/cocina/planificar"><span className="nav-icon" aria-hidden="true">◷</span>Planificar</a>
          <a className="nav-item" href="/cocina/compras"><span className="nav-icon" aria-hidden="true">☷</span>Compras</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-line"><span className="privacy-dot" />Tus datos, bajo tu control</div>
          <div className="profile-row"><div className="avatar">E</div><div className="profile-copy"><strong>Tu espacio</strong><span>Cuenta personal</span></div></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="breadcrumb"><span>Mi espacio</span><span className="breadcrumb-slash">/</span><strong>Cocina</strong></div></header>
        <div className="page-content pantry-content">
          <div className="page-heading-row pantry-heading"><div><p className="eyebrow">ORGANIZA TU COCINA</p><h1>Alacena</h1><p className="week-range">Elige ingredientes del catálogo; las recetas usarán los mismos.</p></div></div>

          <section className="pantry-add-panel" aria-labelledby="catalog-heading">
            <div className="pantry-list-heading pantry-catalog-heading"><h2 id="catalog-heading">Agregar ingredientes</h2><span>{catalog.length} opciones</span></div>
            <label className="pantry-search">Buscar en el catálogo<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Arroz, leche, azúcar…" /></label>
            <div className="ingredient-picker" aria-label="Ingredientes disponibles">
              {filteredCatalog.map((ingredient) => <button key={ingredient.id} type="button" className={`ingredient-chip${selectedId === ingredient.id ? " ingredient-chip-selected" : ""}`} aria-pressed={selectedId === ingredient.id} onClick={() => setSelectedId(ingredient.id)}>
                <span>{ingredient.name}</span><small>{unitLabels[ingredient.unit]}</small>
              </button>)}
              {!loading && filteredCatalog.length === 0 && <p className="pantry-empty">No encontramos ese ingrediente. Puedes agregarlo a tu catálogo.</p>}
            </div>
            {selectedIngredient && <form className="pantry-selected-form" onSubmit={(event) => void addIngredient(event)}>
              <strong>{selectedIngredient.name}</strong>
              <label className="form-field">Cantidad a agregar ({unitLabels[selectedIngredient.unit]})<input name="quantity" type="number" min="0.001" max="999999999.999" step="0.001" placeholder="Cantidad" required /></label>
              <button className="pantry-add-button" type="submit" disabled={saving}>{saving ? "Guardando…" : "＋ Agregar a la alacena"}</button>
            </form>}
            <button className="pantry-custom-toggle" type="button" onClick={() => setCustomOpen((open) => !open)}>{customOpen ? "Cancelar" : "＋ No encuentras un ingrediente"}</button>
            {customOpen && <form className="pantry-custom-form" onSubmit={(event) => void createCustomIngredient(event)}>
              <label className="form-field">Nombre<input type="text" value={customName} onChange={(event) => setCustomName(event.target.value)} maxLength={100} placeholder="Ej. Queso cotija" required /></label>
              <label className="form-field">Unidad fija<select value={customUnit} onChange={(event) => setCustomUnit(event.target.value as IngredientUnit)}><option value="g">g</option><option value="kg">kg</option><option value="ml">ml</option><option value="l">l</option><option value="piece">piezas</option></select></label>
              <button className="pantry-save-button" type="submit" disabled={saving}>{saving ? "Guardando…" : "Crear ingrediente"}</button>
            </form>}
          </section>

          {error && <p className="pantry-message pantry-error" role="alert">{error}</p>}
          {notice && <p className="pantry-message" role="status">{notice}</p>}
          <section className="pantry-list" aria-labelledby="pantry-list-heading">
            <div className="pantry-list-heading"><h2 id="pantry-list-heading">Lo que tienes</h2><span>{items.length} {items.length === 1 ? "ingrediente" : "ingredientes"}</span></div>
            {loading ? <p className="pantry-empty">Cargando alacena…</p>
              : items.length === 0 ? <p className="pantry-empty">Tu alacena está vacía. Elige un ingrediente para comenzar.</p>
                : <ul className="pantry-items">{items.map((item) => <li className="pantry-item" key={item.id}>
                  <div className="pantry-item-name"><strong>{item.name}</strong><span>{unitLabels[item.unit]}</span></div>
                  <label className="pantry-quantity">Cantidad<input aria-label={`Cantidad de ${item.name}`} type="number" min="0.001" max="999999999.999" step="0.001" value={drafts[item.pantryItem.id] ?? ""} disabled={saving} onChange={(event) => setDrafts((current) => ({ ...current, [item.pantryItem.id]: event.target.value }))} /></label>
                  <div className="pantry-item-actions"><button className="pantry-save-button" type="button" disabled={saving} onClick={() => void saveItem(item)}>Guardar</button><button className="pantry-remove-button" type="button" disabled={saving} onClick={() => void removeItem(item)}>Quitar</button></div>
                </li>)}</ul>}
          </section>
        </div>
      </section>
    </main>
  );
}
