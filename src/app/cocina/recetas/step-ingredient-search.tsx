"use client";
import { useId, useMemo, useState } from "react";
import type { IngredientView } from "../../../../reconstruction/core/src/pantry";

const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i++) { const next = [i + 1]; for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j]))); row = next; }
  return row[b.length];
}
export function StepIngredientSearch({ catalog, disabled, choose, create }: { catalog: IngredientView[]; disabled: boolean; choose: (ingredient: IngredientView | null) => void; create: (name: string) => void }) {
  const [query, setQuery] = useState(""), [active, setActive] = useState(0);
  const id = useId();
  const options = useMemo(() => {
    const text = normalize(query);
    const matches = catalog.map(ingredient => { const name = normalize(ingredient.name); const score = !text || name === text ? 0 : name.startsWith(text) ? 1 : name.includes(text) ? 2 : text.length >= 3 && distance(text, name) <= Math.min(2, Math.floor(text.length / 3)) ? 3 : 99; return { ingredient, score }; }).filter(value => value.score < 99).sort((a, b) => a.score - b.score || a.ingredient.name.localeCompare(b.ingredient.name, "es")).slice(0, 8).map(value => value.ingredient);
    return text ? matches : [null, ...matches];
  }, [catalog, query]);
  const offerCreate = !!query.trim() && !options.length;
  const selectedIndex = Math.min(active, Math.max(0, options.length - 1));
  return <div className="recipe-ingredient-search"><input autoFocus type="text" role="combobox" aria-label="Buscar ingrediente del paso" aria-autocomplete="list" aria-expanded="true" aria-controls={id} aria-activedescendant={offerCreate ? `${id}-create` : options.length ? `${id}-${selectedIndex}` : undefined} maxLength={120} placeholder="Buscar ingrediente…" disabled={disabled} value={query} onChange={event => { setQuery(event.target.value); setActive(0); }} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); if (!disabled) { if (offerCreate) create(query.trim()); else if (options.length) choose(options[selectedIndex]); } }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive(current => options.length ? (current + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length : 0); }
  }} />
    <ul id={id} role="listbox" aria-label="Ingredientes encontrados">{options.map((ingredient, index) => <li role="option" id={`${id}-${index}`} key={ingredient?.id ?? "none"} aria-selected={selectedIndex === index}><button type="button" disabled={disabled} onClick={() => choose(ingredient)}>{ingredient ? <>{ingredient.name}<small>{ingredient.unit === "piece" ? "piezas" : ingredient.unit}</small></> : "Sin ingrediente"}</button></li>)}{offerCreate && <li role="option" id={`${id}-create`} aria-selected="true"><button type="button" disabled={disabled} onClick={() => create(query.trim())}>＋ Crear ingrediente «{query.trim()}»</button></li>}</ul>
  </div>;
}
