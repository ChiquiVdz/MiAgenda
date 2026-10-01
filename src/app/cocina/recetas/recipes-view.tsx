"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { normalizeIngredientName } from "@/lib/ingredients";

type Unit = "g" | "kg" | "ml" | "l" | "piece";
type IngredientOption = { id: string; name: string; unit: Unit; isBuiltin: boolean };
type RecipeLine = { ingredientId: string; name: string; unit: Unit; quantityPerServing: string; equivalent: string };
type Recipe = {
  id: string;
  name: string;
  instructions: string;
  servings: number;
  durationMinutes: number;
  ingredients: Array<{ ingredientId: string; quantityPerServing: string; equivalent: string | null; ingredient: IngredientOption }>;
};
type RecipeDraft = { id: string | null; name: string; instructions: string; servings: string; durationMinutes: string; ingredients: RecipeLine[] };

const unitLabels: Record<Unit, string> = { g: "g", kg: "kg", ml: "ml", l: "l", piece: "piezas" };
const emptyDraft: RecipeDraft = { id: null, name: "", instructions: "", servings: "2", durationMinutes: "45", ingredients: [] };

export function RecipesView() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [catalog, setCatalog] = useState<IngredientOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<RecipeDraft | null>(null);
  const [search, setSearch] = useState("");
  const [selectedIngredientId, setSelectedIngredientId] = useState<string | null>(null);
  const [ingredientQuantity, setIngredientQuantity] = useState("1");
  const [ingredientEquivalent, setIngredientEquivalent] = useState("");

  async function loadData() {
    const [recipeResponse, catalogResponse] = await Promise.all([
      fetch("/api/recipes", { cache: "no-store" }), fetch("/api/ingredients", { cache: "no-store" }),
    ]);
    const [recipeResult, catalogResult] = await Promise.all([
      recipeResponse.json().catch(() => null), catalogResponse.json().catch(() => null),
    ]);
    if (!recipeResponse.ok || !Array.isArray(recipeResult?.recipes)) throw new Error(recipeResult?.error ?? "No pudimos cargar tus recetas.");
    if (!catalogResponse.ok || !Array.isArray(catalogResult?.ingredients)) throw new Error(catalogResult?.error ?? "No pudimos cargar el catálogo.");
    setRecipes(recipeResult.recipes as Recipe[]);
    setCatalog(catalogResult.ingredients as IngredientOption[]);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        await loadData();
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "No pudimos cargar tus recetas.");
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
  const selectedIngredient = catalog.find((ingredient) => ingredient.id === selectedIngredientId) ?? null;

  function startNew() {
    setError(null);
    setNotice(null);
    setDraft({ ...emptyDraft, ingredients: [] });
    setSelectedIngredientId(null);
  }

  function startEdit(recipe: Recipe) {
    setError(null);
    setNotice(null);
    setDraft({
      id: recipe.id,
      name: recipe.name,
      instructions: recipe.instructions,
      servings: String(recipe.servings),
      durationMinutes: String(recipe.durationMinutes),
      ingredients: recipe.ingredients.map((item) => ({
        ingredientId: item.ingredientId,
        name: item.ingredient.name,
        unit: item.ingredient.unit,
        quantityPerServing: String(item.quantityPerServing),
        equivalent: item.equivalent ?? "",
      })),
    });
    setSelectedIngredientId(null);
  }

  function addIngredient() {
    if (!draft || !selectedIngredient) return;
    if (draft.ingredients.some((item) => item.ingredientId === selectedIngredient.id)) {
      setError(`${selectedIngredient.name} ya está agregado a esta receta.`);
      return;
    }
    setError(null);
    setDraft((current) => current ? {
      ...current,
      ingredients: [...current.ingredients, {
        ingredientId: selectedIngredient.id,
        name: selectedIngredient.name,
        unit: selectedIngredient.unit,
        quantityPerServing: ingredientQuantity,
        equivalent: ingredientEquivalent,
      }],
    } : current);
    setSelectedIngredientId(null);
    setIngredientQuantity("1");
    setIngredientEquivalent("");
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = {
      name: draft.name,
      instructions: draft.instructions,
      servings: Number(draft.servings),
      durationMinutes: Number(draft.durationMinutes),
      ingredients: draft.ingredients.map((item) => ({
        ingredientId: item.ingredientId,
        quantityPerServing: Number(item.quantityPerServing),
        equivalent: item.equivalent,
      })),
    };
    try {
      const response = await fetch(draft.id ? `/api/recipes/${encodeURIComponent(draft.id)}` : "/api/recipes", {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos guardar la receta.");
      const recipeName = result.recipe.name as string;
      await loadData();
      setDraft(null);
      setNotice(`“${recipeName}” se guardó.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos guardar la receta.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteRecipe(recipe: Recipe) {
    if (!window.confirm(`¿Eliminar la receta “${recipe.name}”?`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/recipes/${encodeURIComponent(recipe.id)}`, { method: "DELETE" });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "No pudimos eliminar la receta.");
      await loadData();
      setNotice(`“${recipe.name}” se eliminó.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No pudimos eliminar la receta.");
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
          <a className="nav-item" href="/cocina"><span className="nav-icon" aria-hidden="true">♨</span>Alacena</a>
          <a className="nav-item nav-item-active" href="/cocina/recetas" aria-current="page"><span className="nav-icon" aria-hidden="true">▤</span>Recetas</a>
          <a className="nav-item" href="/cocina/planificar"><span className="nav-icon" aria-hidden="true">◷</span>Planificar</a>
          <a className="nav-item" href="/cocina/compras"><span className="nav-icon" aria-hidden="true">☷</span>Compras</a>
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-line"><span className="privacy-dot" />Tus datos, bajo tu control</div>
          <div className="profile-row"><div className="avatar">E</div><div className="profile-copy"><strong>Tu espacio</strong><span>Cuenta personal</span></div></div>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div className="breadcrumb"><span>Mi espacio</span><span className="breadcrumb-slash">/</span><strong>Cocina</strong><span className="breadcrumb-slash">/</span><strong>Recetas</strong></div></header>
        <div className="page-content pantry-content">
          <div className="page-heading-row pantry-heading"><div><p className="eyebrow">ORGANIZA TU COCINA</p><h1>Recetas</h1><p className="week-range">Usa los mismos ingredientes del catálogo que tienes en la alacena.</p></div><button className="pantry-add-button" type="button" onClick={startNew}>＋ Nueva receta</button></div>

          {error && <p className="pantry-message pantry-error" role="alert">{error}</p>}
          {notice && <p className="pantry-message" role="status">{notice}</p>}

          {draft && <form className="recipe-editor" onSubmit={(event) => void saveRecipe(event)}>
            <div className="pantry-list-heading"><h2>{draft.id ? "Editar receta" : "Nueva receta"}</h2><button className="recipe-editor-close" type="button" disabled={saving} onClick={() => setDraft(null)}>Cerrar</button></div>
            <div className="recipe-fields">
              <label className="form-field">Nombre<input type="text" maxLength={150} value={draft.name} required onChange={(event) => setDraft((current) => current ? { ...current, name: event.target.value } : current)} placeholder="Ej. Pasta con tomate" /></label>
              <label className="form-field">Porciones<input type="number" min="1" max="100" step="1" value={draft.servings} required onChange={(event) => setDraft((current) => current ? { ...current, servings: event.target.value } : current)} /></label>
              <label className="form-field">Duración (minutos)<input type="number" min="5" max="480" step="5" value={draft.durationMinutes} required onChange={(event) => setDraft((current) => current ? { ...current, durationMinutes: event.target.value } : current)} /></label>
              <label className="form-field recipe-instructions">Instrucciones<textarea maxLength={10000} rows={4} value={draft.instructions} required onChange={(event) => setDraft((current) => current ? { ...current, instructions: event.target.value } : current)} placeholder="Describe los pasos para preparar la receta." /></label>
            </div>

            <section className="recipe-ingredient-editor" aria-labelledby="recipe-ingredients-heading">
              <div className="pantry-list-heading"><h3 id="recipe-ingredients-heading">Ingredientes por porción</h3><span>{draft.ingredients.length}</span></div>
              <label className="pantry-search">Buscar ingrediente<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Busca en el catálogo" /></label>
              <div className="ingredient-picker recipe-picker">
                {filteredCatalog.map((ingredient) => <button key={ingredient.id} type="button" className={`ingredient-chip${selectedIngredientId === ingredient.id ? " ingredient-chip-selected" : ""}`} aria-pressed={selectedIngredientId === ingredient.id} onClick={() => setSelectedIngredientId(ingredient.id)}>
                  <span>{ingredient.name}</span><small>{unitLabels[ingredient.unit]}</small>
                </button>)}
              </div>
              {selectedIngredient && <div className="recipe-add-ingredient">
                <strong>{selectedIngredient.name}</strong>
                <label className="form-field">Cantidad por porción ({unitLabels[selectedIngredient.unit]})<input type="number" min="0.001" max="999999999.999" step="0.001" value={ingredientQuantity} onChange={(event) => setIngredientQuantity(event.target.value)} /></label>
                <label className="form-field">Equivalencia opcional<input type="text" maxLength={120} value={ingredientEquivalent} onChange={(event) => setIngredientEquivalent(event.target.value)} placeholder="Ej. 2 cucharadas" /></label>
                <button className="pantry-save-button" type="button" onClick={addIngredient}>Agregar ingrediente</button>
              </div>}
              {draft.ingredients.length === 0 ? <p className="pantry-empty">Elige ingredientes del catálogo para agregarlos.</p>
                : <ul className="recipe-lines">{draft.ingredients.map((item) => <li className="recipe-line" key={item.ingredientId}>
                  <strong>{item.name}</strong><label className="pantry-quantity">Cantidad por porción ({unitLabels[item.unit]})<input type="number" min="0.001" max="999999999.999" step="0.001" value={item.quantityPerServing} onChange={(event) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.map((line) => line.ingredientId === item.ingredientId ? { ...line, quantityPerServing: event.target.value } : line) } : current)} /></label>
                  <label className="pantry-quantity">Equivalencia<input type="text" maxLength={120} value={item.equivalent} placeholder="Opcional" onChange={(event) => setDraft((current) => current ? { ...current, ingredients: current.ingredients.map((line) => line.ingredientId === item.ingredientId ? { ...line, equivalent: event.target.value } : line) } : current)} /></label>
                  <button className="pantry-remove-button" type="button" onClick={() => setDraft((current) => current ? { ...current, ingredients: current.ingredients.filter((line) => line.ingredientId !== item.ingredientId) } : current)}>Quitar</button>
                </li>)}</ul>}
            </section>
            <p className="form-hint">La cantidad y su equivalencia son por porción. La equivalencia solo se muestra; el inventario usa la unidad fija.</p>
            <div className="dialog-actions"><button className="dialog-cancel" type="button" disabled={saving} onClick={() => setDraft(null)}>Cancelar</button><button className="dialog-submit" type="submit" disabled={saving}>{saving ? "Guardando…" : draft.id ? "Guardar cambios" : "Guardar receta"}</button></div>
          </form>}

          <section className="recipe-list" aria-labelledby="recipe-list-heading">
            <div className="pantry-list-heading"><h2 id="recipe-list-heading">Mis recetas</h2><span>{recipes.length}</span></div>
            {loading ? <p className="pantry-empty">Cargando recetas…</p>
              : recipes.length === 0 ? <p className="pantry-empty">Aún no tienes recetas. Crea una para empezar a organizar tus comidas.</p>
                : <ul className="recipe-cards">{recipes.map((recipe) => <li className="recipe-card" key={recipe.id}>
                  <div className="recipe-card-heading"><div><h3>{recipe.name}</h3><span>{recipe.servings} porciones · {recipe.durationMinutes} min</span></div><div className="pantry-item-actions"><button className="pantry-save-button" type="button" disabled={saving} onClick={() => startEdit(recipe)}>Editar</button><button className="pantry-remove-button" type="button" disabled={saving} onClick={() => void deleteRecipe(recipe)}>Eliminar</button></div></div>
                  <ul className="recipe-card-ingredients">{recipe.ingredients.map((item) => <li key={item.ingredientId}><span>{item.ingredient.name}</span><span>{item.quantityPerServing} {unitLabels[item.ingredient.unit]}{item.equivalent ? ` (${item.equivalent})` : ""} <small>por porción</small></span></li>)}</ul>
                  <p className="recipe-card-instructions">{recipe.instructions}</p>
                </li>)}</ul>}
          </section>
        </div>
      </section>
    </main>
  );
}
