"use client";
import { PencilIcon, TrashIcon } from "../core/task-icons";
import { AppNavigation } from "../core/app-navigation";
import { useContext, useEffect, useMemo, useState } from "react";
import { signOut } from "../core/local-data";
import { AvailabilityControls, IngredientTrackingEditor, availabilityCommand } from "./ingredient-tracking-editor";
import { IngredientRetirementDialog, RemovedIngredients } from "./ingredient-retirement-dialog";
import type { IngredientView, PantryItemView, PantrySnapshot } from "../../../reconstruction/core/src/pantry";
import { normalizedIngredientName, quantityInput, similarIngredientName, type IngredientUnit } from "../../../reconstruction/core/src/ingredient-input";
import { usePantryFeed, type PantryMutate } from "../core/use-pantry-feed";
import { CoreDialog, CoreFeedback } from "../core/schedule-editor";

const units: Record<IngredientUnit, string> = { g: "g", ml: "ml", piece: "piezas" };
function parsedQuantity(value: string) { try { return quantityInput(value); } catch { return null; } }
function hasStock(item: IngredientView) { return item.listed && item.available; }
export function CorePantryView({ initial }: { initial: PantrySnapshot }) {
  const feed = usePantryFeed(initial);
  const [search, setSearch] = useState(""), [selectedId, setSelectedId] = useState<string | null>(null), [quantity, setQuantity] = useState("");
  const [trackingItem,setTrackingItem]=useState<IngredientView|null>(null);
  const [retiring, setRetiring] = useState<IngredientView | null>(null);
  const [editor, setEditor] = useState<{ item?: IngredientView } | null>(null);
  const [selectionBase, setSelectionBase] = useState<{ balanceRevision: number | null; ingredientRevision: number } | null>(null);
  const selected = feed.data.ingredients.find(item => item.id === selectedId);
  useEffect(() => { if (selected && !selectionBase) setSelectionBase({ balanceRevision: selected.balanceRevision, ingredientRevision: selected.revision }); }, [selected, selectionBase]);
  const selectionStale = !!selected && !!selectionBase && (selected.balanceRevision !== selectionBase.balanceRevision || selected.revision !== selectionBase.ingredientRevision);
  const selectedQuantity = parsedQuantity(quantity);
  const selectionUnchanged = !!selected?.listed && selectedQuantity === selected.quantity;
  const matches = useMemo(() => {
    const query = normalizedIngredientName(search);
    return feed.data.ingredients.filter(item => !item.hidden && normalizedIngredientName(item.name).includes(query)).sort((a, b) => Number(hasStock(b)) - Number(hasStock(a)) || a.name.localeCompare(b.name, "es"));
  }, [feed.data.ingredients, search]);
  const hidden = useMemo(() => feed.data.ingredients.filter(item => item.hidden).sort((a, b) => a.name.localeCompare(b.name, "es")), [feed.data.ingredients]);
  const available = useMemo(() => feed.data.items.filter(item => item.ingredient.available).sort((a, b) => a.ingredient.name.localeCompare(b.ingredient.name, "es")), [feed.data.items]);
  function stockRows(items: PantryItemView[]) { return items.map(item => <StockRow key={item.ingredient.id} item={item} disabled={feed.locked} mutate={feed.mutate} tracking={() => setTrackingItem(item.ingredient)} />); }
  function choose(item: IngredientView) { setSelectedId(item.id); setQuantity(item.listed ? item.quantity : ""); setSelectionBase({ balanceRevision: item.balanceRevision, ingredientRevision: item.revision }); }
  return <CoreFeedback.Provider value={{ error: feed.error, retry: feed.retry, busy: feed.busy, reattempt: feed.reattempt }}><main className="app-shell"><AppNavigation footer="Tu alacena es privada" /><section className="workspace"><header className="topbar"><div className="breadcrumb">Mi espacio / <strong>Alacena</strong></div><button className="core-text-button" disabled={feed.locked} onClick={() => void signOut({ callbackUrl: "/login" })}>Cerrar sesión</button></header>
    <div className="page-content"><div className="page-heading-row"><div><p className="eyebrow">COCINA</p><h1>Alacena</h1><p className="week-range">Elige un ingrediente y registra cuánto tienes.</p></div></div>
    {feed.error && <p className="pantry-message pantry-error" role="alert">{feed.error} {feed.retry && <button className="core-text-button" disabled={feed.busy} onClick={feed.reattempt}>Reintentar cambio</button>}</p>}
    {feed.notice && <p className="pantry-message" role="status">{feed.notice}</p>}
    <div className="pantry-layout pantry-classic"><section className="pantry-panel"><div className="pantry-section-heading"><h2>Agregar ingredientes</h2></div>
      <label className="form-field">Buscar ingrediente<input type="search" placeholder="Arroz, huevo, leche…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="core-ingredient-options" aria-label="Ingredientes disponibles">{matches.map(item => <button key={item.id} className={`core-ingredient-pick${selectedId === item.id ? " core-ingredient-selected" : ""}`} aria-pressed={selectedId === item.id} disabled={feed.locked} onClick={() => choose(item)}><strong>{item.name}</strong><small>{item.trackingMode === "availability" ? "Disponibilidad" : units[item.unit]}</small>{hasStock(item) && <span className="pantry-catalog-stock" aria-label="Con existencias" title="Con existencias">✓</span>}</button>)}</div>
      {!matches.length && <p className="today-empty">No hay coincidencias entre los ingredientes cargados. Puedes crear uno personalizado.</p>}
      {feed.data.nextCatalogId && <button className="core-text-button" disabled={feed.locked || feed.reading} onClick={() => void feed.load("catalog", feed.data.nextCatalogId!)}>Cargar más ingredientes</button>}
      {selected && <div className="pantry-selected-actions"><strong>{selected.name}</strong><button type="button" className="core-text-button core-icon-button" aria-label={`Cambiar seguimiento de ${selected.name}`} title={`Seguimiento: ${selected.trackingMode === "availability" ? "Solo disponibilidad" : "Por cantidad"}`} disabled={feed.locked} onClick={() => setTrackingItem(selected)}><PencilIcon /></button>{selected.scope === "private" && <button className="core-text-button" disabled={feed.locked} onClick={() => setEditor({ item: selected })}>Editar ingrediente</button>}<button className="core-text-button core-icon-button" aria-label={`Eliminar o reemplazar ${selected.name}`} title="Eliminar o reemplazar" disabled={feed.locked} onClick={() => setRetiring(selected)}><TrashIcon /></button><button className="core-text-button" disabled={feed.locked} aria-label="Cerrar selección" onClick={() => { setSelectedId(null); setSelectionBase(null); setQuantity(""); }}>×</button></div>}
      {selected?.trackingMode === "availability" && <AvailabilityControls item={selected} disabled={feed.locked} mutate={feed.mutate} />}{selected?.trackingMode === "quantity" && <form className="core-stock-add" onSubmit={event => { event.preventDefault(); if (feed.locked || !selectionBase || selectionStale || selectedQuantity === null || selectionUnchanged) return; void feed.mutate({ action: "setPantryQuantity", id: selected.id, expectedBalanceRevision: selectionBase.balanceRevision, expectedIngredientRevision: selectionBase.ingredientRevision, quantity: selectedQuantity, listed: true }, () => { setSelectedId(null); setSelectionBase(null); setQuantity(""); }); }}><h3>{selected.name}</h3><label className="form-field">Cantidad que tienes ({units[selected.unit]})<input inputMode="decimal" required value={quantity} disabled={feed.locked} placeholder="0" onChange={event => setQuantity(event.target.value)} /></label><button className="pantry-add-button" disabled={feed.locked || selectedQuantity === null || selectionUnchanged || selectionStale || !selectionBase}>{selected.listed ? "Guardar cantidad" : "Agregar a Alacena"}</button>{selectionStale && <p className="pantry-error">La selección cambió en otra pestaña. <button className="core-text-button" type="button" disabled={feed.locked} onClick={() => choose(selected)}>Actualizar selección</button></p>}</form>}
      <button className="core-text-button pantry-custom-link" disabled={feed.locked} onClick={() => setEditor({})}>＋ No encuentras un ingrediente</button>
      {hidden.length > 0 && <details className="inbox-completed"><summary>Sugerencias ocultas ({hidden.length})</summary><ul className="core-hidden-ingredients">{hidden.map(item => <li key={item.id}><span>{item.name}</span><button className="core-text-button" disabled={feed.locked} onClick={() => void feed.mutate({ action: "setIngredientHidden", id: item.id, expectedPreferenceRevision: item.preferenceRevision, hidden: false })}>Mostrar</button><button className="core-text-button" disabled={feed.locked} onClick={() => setRetiring(item)}>Eliminar</button></li>)}</ul></details>}
      <RemovedIngredients dataRevision={feed.data.dataRevision} disabled={feed.locked} mutate={feed.mutate} />
    </section><section className="pantry-panel"><h2>Lo que tienes</h2>{available.length ? <ul className="pantry-items-list">{stockRows(available)}</ul> : <p className="today-empty">No tienes ingredientes con existencias en esta lista.</p>}
      {feed.data.nextPantryId && <button className="core-text-button" disabled={feed.locked || feed.reading} onClick={() => void feed.load("pantry", feed.data.nextPantryId!)}>Cargar más de Alacena</button>}
    </section></div></div>
  </section>{editor && <IngredientEditor item={editor.item} catalog={feed.data.ingredients} disabled={feed.locked} mutate={feed.mutate} close={() => { if (!feed.busy) setEditor(null); }} choose={item => { choose(item); setEditor(null); }} created={id => { setSelectedId(id); setSelectionBase(null); setQuantity(""); setEditor(null); }} />}
  {trackingItem && <IngredientTrackingEditor item={trackingItem} disabled={feed.locked} mutate={feed.mutate} close={() => { if(!feed.busy){setTrackingItem(null);setSelectedId(null);setSelectionBase(null);} }} />}{retiring && <IngredientRetirementDialog item={retiring} data={feed.data} disabled={feed.locked} mutate={feed.mutate} refreshCatalog={() => void feed.load()} close={() => { if (!feed.busy) { setRetiring(null); setSelectedId(null); setSelectionBase(null); } }} />}
  </main></CoreFeedback.Provider>;
}

function StockRow({ item, disabled, mutate, tracking }: { item: PantryItemView; disabled: boolean; mutate: PantryMutate; tracking: () => void }) {
  const [draft, setDraft] = useState(item.quantity), [editing, setEditing] = useState(false), [base, setBase] = useState({ quantity: item.quantity, revision: item.revision, ingredientRevision: item.ingredient.revision });
  useEffect(() => { if (!editing) { setDraft(item.quantity); setBase({ quantity: item.quantity, revision: item.revision, ingredientRevision: item.ingredient.revision }); } }, [item.quantity, item.revision, item.ingredient.revision, editing]);
  const amount = parsedQuantity(draft), changed = amount !== null && amount !== base.quantity, stale = editing && (base.revision !== item.revision || base.ingredientRevision !== item.ingredient.revision);
  if(item.ingredient.trackingMode === "availability")return <li className="core-stock-row"><div className="core-stock-name"><strong>{item.ingredient.name}</strong><small>Solo disponibilidad</small></div><div className="core-stock-controls"><AvailabilityControls item={item.ingredient} disabled={disabled} mutate={mutate}/><button type="button" className="core-text-button core-icon-button" aria-label={`Cambiar seguimiento de ${item.ingredient.name}`} title="Seguimiento" disabled={disabled} onClick={tracking}><PencilIcon /></button><button type="button" className="core-text-button core-icon-button" aria-label={`Quitar ${item.ingredient.name} de Alacena`} title="Quitar de Alacena" disabled={disabled} onClick={()=>void mutate(availabilityCommand(item.ingredient,false,false))}><TrashIcon /></button></div></li>;
  return <li className="core-stock-row"><div className="core-stock-name"><strong>{item.ingredient.name}</strong><small>{units[item.ingredient.unit]}</small></div>
    <div className="core-stock-controls"><label className="form-field">Cantidad<input aria-label={`Cantidad de ${item.ingredient.name}`} inputMode="decimal" value={draft} disabled={disabled} onChange={event => { setDraft(event.target.value); setEditing(true); }} /></label>
      <button className="core-text-button" disabled={disabled || !changed || stale} onClick={() => void mutate({ action: "setPantryQuantity", id: item.ingredient.id, expectedBalanceRevision: base.revision, expectedIngredientRevision: base.ingredientRevision, quantity: amount!, listed: true }, () => setEditing(false))}>Guardar</button>
      <button type="button" className="core-text-button core-icon-button" aria-label={`Cambiar seguimiento de ${item.ingredient.name}`} title="Seguimiento" disabled={disabled} onClick={tracking}><PencilIcon /></button>
      <button className="core-text-button core-icon-button" aria-label={`Quitar ${item.ingredient.name} de Alacena`} title="Quitar de Alacena" disabled={disabled} onClick={() => { if (window.confirm(`¿Quitar ${item.ingredient.name} de Alacena? Su cantidad quedará en cero; se conservará el registro del ajuste.`)) void mutate({ action: "setPantryQuantity", id: item.ingredient.id, expectedBalanceRevision: item.revision, expectedIngredientRevision: item.ingredient.revision, quantity: "0", listed: false }); }}><TrashIcon /></button>
    </div>{stale && <p className="pantry-error">La cantidad o el ingrediente cambió. Ahora hay {item.quantity} {units[item.ingredient.unit]}. <button className="core-text-button" disabled={disabled} onClick={() => setEditing(false)}>Cargar cantidad actual</button></p>}
  </li>;
}

export function IngredientEditor({ item, catalog, disabled, mutate, close, choose, created, fixedUnit, initialName = "" }: { item?: IngredientView; catalog: IngredientView[]; disabled: boolean; mutate: PantryMutate; close: () => void; choose: (item: IngredientView) => void; created: (id: string) => void; fixedUnit?: IngredientUnit; initialName?: string }) {
  const feedback = useContext(CoreFeedback);
  const [name, setName] = useState(item?.name ?? initialName), [unit, setUnit] = useState<IngredientUnit>(item?.unit ?? fixedUnit ?? "g"), [confirm, setConfirm] = useState(false);
  const [trackingMode,setTrackingMode]=useState<"quantity"|"availability">("quantity");
  const normalized = normalizedIngredientName(name), exact = catalog.find(candidate => candidate.id !== item?.id && candidate.normalizedName === normalized), similar = catalog.filter(candidate => candidate.id !== item?.id && similarIngredientName(candidate.normalizedName, normalized)).slice(0, 5);
  return <CoreDialog title={item ? "Editar ingrediente personalizado" : "Nuevo ingrediente personalizado"} close={close}><form className="core-edit-form" onSubmit={event => {
    event.preventDefault(); const id = item?.id ?? crypto.randomUUID();
    void mutate(item ? { action: "editIngredient", id, expectedRevision: item.revision, name, unit, confirmSimilar: confirm } : { action: "createIngredient", id, name, unit, confirmSimilar: confirm, trackingMode }, () => item ? close() : created(id));
  }}><label className="form-field">Nombre<input required maxLength={120} value={name} disabled={disabled} onChange={event => { setName(event.target.value); setConfirm(false); }} /></label>
    <label className="form-field">Unidad<select value={unit} disabled={disabled || item?.unitLocked || !!fixedUnit} onChange={event => setUnit(event.target.value as IngredientUnit)}><option value="g">Gramos (g)</option><option value="ml">Mililitros (ml)</option><option value="piece">Piezas</option></select></label>
    {!item && <label className="form-field">Seguimiento<select disabled={disabled} value={trackingMode} onChange={event=>setTrackingMode(event.target.value as typeof trackingMode)}><option value="quantity">Por cantidad</option><option value="availability">Solo disponibilidad</option></select></label>}
    {fixedUnit && <p className="core-muted">El sustituto usa la misma unidad para conservar las cantidades.</p>}
    {item?.unitLocked && <p className="core-muted">La unidad queda fija porque este ingrediente ya se usa en recetas, compras, existencias o movimientos.</p>}
    {similar.length > 0 && <section><p>{exact ? "Este ingrediente ya existe. Usa el existente para evitar duplicados." : "Hay nombres parecidos. Revisa si alguno corresponde al mismo ingrediente."}</p>{similar.map(candidate => <button key={candidate.id} className="core-text-button" type="button" disabled={disabled} onClick={() => choose(candidate)}>Usar {candidate.name}</button>)}
      {!exact && <label className="core-check"><input type="checkbox" checked={confirm} disabled={disabled} onChange={event => setConfirm(event.target.checked)} />Es un ingrediente distinto; crear o guardar por separado</label>}</section>}
    <button className="pantry-add-button" disabled={disabled || !name.trim() || !!exact || (similar.length > 0 && !confirm) || (!!item && name.trim() === item.name && unit === item.unit)}>{item ? "Guardar ingrediente" : "Crear ingrediente"}</button>
  </form>{feedback.error && <p className="pantry-error" role="alert">{feedback.error}</p>}{feedback.retry && <button className="core-text-button" disabled={feedback.busy} onClick={feedback.reattempt}>Reintentar cambio</button>}</CoreDialog>;
}
