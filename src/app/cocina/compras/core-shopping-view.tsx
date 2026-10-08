"use client";
import { AppNavigation } from "../../core/app-navigation";
import { useMemo, useState } from "react";
import { signOut } from "../../core/local-data";
import type { PantrySnapshot } from "../../../../reconstruction/core/src/pantry";
import type { ShoppingItem, ShoppingSnapshot } from "../../../../reconstruction/core/src/shopping";
import { quantityInput, normalizedIngredientName } from "../../../../reconstruction/core/src/ingredient-input";
import { useShoppingFeed } from "../../core/use-shopping-feed";
import { usePantryFeed } from "../../core/use-pantry-feed";

function unitLabel(unit: string) { return unit === "piece" ? "piezas" : unit; }
function amount(value: string) { try { return quantityInput(value); } catch { return null; } }
type QuantityDraft = { value: string; revision: string };
export function CoreShoppingView({ initial, pantry }: { initial: ShoppingSnapshot; pantry: PantrySnapshot }) {
  const feed = useShoppingFeed(initial), catalog = usePantryFeed(pantry);
  const [drafts, setDrafts] = useState<Record<string, QuantityDraft>>({}), [localError, setLocalError] = useState<string | null>(null);
  const [kind, setKind] = useState("ingredient"), [ingredientId, setIngredientId] = useState(""), [search, setSearch] = useState("");
  const [name, setName] = useState(""), [unit, setUnit] = useState("piezas"), [quantity, setQuantity] = useState("1");
  const ingredient = catalog.data.ingredients.find(row => row.id === ingredientId);
  const matches = useMemo(() => {
    const query = normalizedIngredientName(search);
    return catalog.data.ingredients.filter(row => !row.hidden && normalizedIngredientName(row.name).includes(query)).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [catalog.data.ingredients, search]);
  const purchaseDateFormat = useMemo(() => new Intl.DateTimeFormat("es-MX", { timeZone: feed.data.timeZone, dateStyle: "medium" }), [feed.data.timeZone]);
  const locked = feed.locked || catalog.locked || catalog.reading;
  function clear(keys: string[]) { setDrafts(current => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key)))); }
  function edit(item: ShoppingItem, value: string) { setDrafts(current => ({ ...current, [item.key]: { value, revision: current[item.key]?.revision ?? feed.data.dataRevision } })); }
  function chosen(item: ShoppingItem) { return item.availabilityOnly ? "0" : amount(drafts[item.key]?.value ?? item.quantity); }
  function stale(item: ShoppingItem) { return !!drafts[item.key] && drafts[item.key].revision !== feed.data.dataRevision; }
  function buy(items: ShoppingItem[]) {
    setLocalError(null);
    if (items.some(stale)) { setLocalError("Cambió la lista mientras editabas. Revisa y confirma las cantidades indicadas antes de comprar."); return; }
    if (items.some(item => chosen(item) === null)) { setLocalError("Revisa las cantidades: usa hasta tres decimales."); return; }
    const selected = items.filter(item => item.availabilityOnly || chosen(item) !== "0").map(item => ({ key: item.key, quantity: chosen(item)! }));
    if (!selected.length) { setLocalError("Indica una cantidad mayor que cero para comprar."); return; }
    if (selected.length > 200) { setLocalError("Compra hasta 200 artículos por operación; puedes marcarlos individualmente."); return; }
    void feed.mutate({ action: "buyShoppingItems", expectedDataRevision: feed.data.dataRevision, items: selected }, () => clear(selected.map(row => row.key)));
  }
  function save(item: ShoppingItem, reset = false) {
    if (!reset && (stale(item) || chosen(item) === null || (item.free && chosen(item) === "0"))) return;
    void feed.mutate({ action: "saveShoppingQuantity", expectedDataRevision: feed.data.dataRevision, key: item.key, quantity: reset ? null : chosen(item) }, () => clear([item.key]));
  }
  const anyStale = feed.data.items.some(stale);
  return <main className="app-shell"><AppNavigation footer="Tus compras son privadas" /><section className="workspace"><header className="topbar"><div className="breadcrumb">Mi espacio / <strong>Compras</strong></div><button className="core-text-button" disabled={locked} onClick={() => void signOut({ callbackUrl: "/login" })}>Cerrar sesión</button></header>
    <div className="page-content"><div className="page-heading-row"><div><p className="eyebrow">COCINA</p><h1>Compras</h1><p className="week-range">Faltantes de todas tus comidas pendientes con Cocinar activo.</p></div></div>
    {(feed.error || localError) && <p className="pantry-message pantry-error" role="alert">{feed.error ?? localError} {feed.retry && <button className="core-text-button" disabled={feed.busy} onClick={feed.reattempt}>Reintentar compra</button>}</p>}
    <section className="pantry-panel core-shopping-add"><h2>Agregar artículo</h2><form onSubmit={event => { event.preventDefault(); setLocalError(null); const parsed = kind === "ingredient" && ingredient?.trackingMode === "availability" ? "1" : amount(quantity); if (!parsed || parsed === "0") { setLocalError("Indica una cantidad mayor que cero."); return; } if (kind === "ingredient" && !ingredient) return;
      void feed.mutate({ action: "addShoppingEntry", id: crypto.randomUUID(), expectedDataRevision: feed.data.dataRevision, ingredientId: kind === "ingredient" ? ingredient!.id : null, expectedIngredientRevision: kind === "ingredient" ? ingredient!.revision : null, name: kind === "ingredient" ? ingredient!.name : name, unit: kind === "ingredient" ? ingredient!.unit : unit, quantity: parsed }, () => { setName(""); setIngredientId(""); setQuantity("1"); });
    }}><label className="form-field">Tipo<select value={kind} disabled={locked} onChange={event => setKind(event.target.value)}><option value="ingredient">Ingrediente para Alacena</option><option value="other">Otro artículo</option></select></label>
      {kind === "ingredient" ? <><label className="form-field">Buscar ingrediente<input value={search} disabled={locked} placeholder="Huevo, arroz…" onChange={event => setSearch(event.target.value)} /></label><label className="form-field">Ingrediente<select required value={ingredientId} disabled={locked} onChange={event => setIngredientId(event.target.value)}><option value="">Selecciona un ingrediente</option>{matches.map(row => <option key={row.id} value={row.id}>{row.name} ({unitLabel(row.unit)})</option>)}</select></label>{catalog.data.nextCatalogId && <button className="core-text-button" type="button" disabled={locked} onClick={() => void catalog.load("catalog", catalog.data.nextCatalogId!)}>Más ingredientes</button>}</> : <><label className="form-field">Nombre<input required maxLength={120} value={name} disabled={locked} placeholder="Jabón" onChange={event => setName(event.target.value)} /></label><label className="form-field">Unidad<input required maxLength={32} value={unit} disabled={locked} onChange={event => setUnit(event.target.value)} /></label></>}
      <div className="core-shopping-add-bottom">{!(kind === "ingredient" && ingredient?.trackingMode === "availability") && <label className="form-field">Cantidad{kind === "ingredient" && ingredient ? ` (${unitLabel(ingredient.unit)})` : ""}<input required inputMode="decimal" value={quantity} disabled={locked} onChange={event => setQuantity(event.target.value)} /></label>}<button className="pantry-add-button" disabled={locked || (!(kind === "ingredient" && ingredient?.trackingMode === "availability") && (amount(quantity) === null || amount(quantity) === "0")) || (kind === "ingredient" ? !ingredient : !name.trim() || !unit.trim())}>Agregar</button></div>
    </form>{catalog.error && <p className="pantry-error">{catalog.error}</p>}</section>
    <section className="pantry-panel core-shopping-list"><div className="pantry-section-heading"><h2>Pendientes ({feed.data.items.length})</h2><button className="pantry-add-button" disabled={locked || !feed.data.items.length || anyStale} onClick={() => buy(feed.data.items)}>Marcar todo comprado</button></div>
      {!feed.data.items.length && <p className="today-empty">No tienes faltantes ni artículos pendientes.</p>}
      {feed.data.items.map((item, index) => <div key={item.key}>{item.free && !feed.data.items[index - 1]?.free && <h3 className="core-shopping-free-heading">Artículos agregados</h3>}
        <div className="core-shopping-row"><div className="core-shopping-name"><strong>{item.name}</strong>{item.free && <small>{item.ingredientId ? "Ingrediente adicional" : "Artículo libre"}</small>}</div>
          <div className="core-shopping-controls">{item.free ? <button className="core-text-button core-shopping-remove" aria-label={`Eliminar ${item.name}`} disabled={locked} onClick={() => void feed.mutate({ action: "removeShoppingEntry", id: item.id, expectedDataRevision: feed.data.dataRevision })}>×</button> : <span className="core-shopping-remove" aria-hidden="true" />}
            {item.availabilityOnly ? <span className="core-shopping-availability">{item.optionalOnly ? "Opcional" : "Sin existencias"}</span> : <label className="form-field">Cantidad ({unitLabel(item.unit)})<input aria-label={`Cantidad a comprar de ${item.name}`} placeholder={item.required === "0" && item.optional === "0" && !item.free ? "Indica cuánto compras" : undefined} inputMode="decimal" value={drafts[item.key]?.value ?? item.quantity} disabled={locked} onChange={event => edit(item, event.target.value)} /></label>}
            <button className="pantry-add-button" disabled={locked || stale(item) || chosen(item) === null || (!item.availabilityOnly && chosen(item) === "0")} onClick={() => buy([item])}>Comprado</button>
            {!item.free && Number(item.optional) > 0 && <small className="core-shopping-optional">{item.optional} {unitLabel(item.unit)} opcional</small>}</div>
          <div className="core-shopping-adjustments">{!item.availabilityOnly && drafts[item.key] && <button className="core-text-button" disabled={locked || stale(item) || chosen(item) === null || chosen(item) === item.quantity || (item.free && chosen(item) === "0")} onClick={() => save(item)}>Guardar cantidad</button>}
            {!item.availabilityOnly && !item.free && item.edited && <button className="core-text-button" disabled={locked} onClick={() => save(item, true)}>Usar faltante calculado</button>}
            {stale(item) && <span className="pantry-error">La lista cambió. <button className="core-text-button" disabled={locked} onClick={() => setDrafts(current => ({ ...current, [item.key]: { ...current[item.key], revision: feed.data.dataRevision } }))}>Confirmar mi cantidad</button> <button className="core-text-button" disabled={locked} onClick={() => clear([item.key])}>Usar actual</button></span>}
          </div></div></div>)}
    </section>
    <details className="inbox-completed core-shopping-purchased"><summary>Comprados · últimos 30 días ({feed.data.purchased.length}{feed.data.nextPurchaseId ? "+" : ""})</summary><p className="core-muted">Deshacer devuelve la disponibilidad anterior o retira la cantidad registrada. Si hubo cambios posteriores, corrígelos antes.</p>
      {feed.data.purchased.length ? feed.data.purchased.map(row => <div className="core-shopping-receipt" key={row.id}><div><strong>{row.name}</strong><small>{row.availabilityOnly ? "Disponibilidad registrada" : `${row.quantity} ${unitLabel(row.unit)}`} · {purchaseDateFormat.format(new Date(row.createdAt))}</small></div><button className="core-text-button" disabled={locked} onClick={() => void feed.mutate({ action: "undoShoppingPurchase", id: row.id, expectedDataRevision: feed.data.dataRevision })}>Deshacer</button></div>) : <p className="today-empty">No hay compras recientes.</p>}
      {feed.data.nextPurchaseId && <button className="core-text-button" disabled={locked} onClick={() => void feed.load(feed.data.nextPurchaseId!)}>Ver más compras</button>}
    </details></div>
  </section></main>;
}
