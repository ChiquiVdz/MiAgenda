"use client";
import { useContext, useState } from "react";
import type { IngredientView } from "../../../reconstruction/core/src/pantry";
import { quantityInput } from "../../../reconstruction/core/src/ingredient-input";
import type { PantryMutate } from "../core/use-pantry-feed";
import { CoreDialog, CoreFeedback } from "../core/schedule-editor";

export function availabilityCommand(item: IngredientView, available: boolean, listed = true) {
  return { action: "setIngredientTracking" as const, id: item.id, expectedIngredientRevision: item.revision, expectedPreferenceRevision: item.preferenceRevision, expectedBalanceRevision: item.balanceRevision, mode: "availability" as const, available, quantity: null, listed };
}
export function AvailabilityControls({ item, disabled, mutate }: { item: IngredientView; disabled: boolean; mutate: PantryMutate }) {
  return <div className="recipe-actions" aria-label={`Disponibilidad de ${item.name}`}><button type="button" className="core-text-button" aria-pressed={item.available} disabled={disabled || item.available && item.listed} onClick={() => void mutate(availabilityCommand(item, true))}>Tengo</button><button type="button" className="core-text-button" aria-pressed={!item.available} disabled={disabled || !item.available && item.listed} onClick={() => void mutate(availabilityCommand(item, false))}>Se terminó</button></div>;
}
export function IngredientTrackingEditor({ item, disabled, mutate, close }: { item: IngredientView; disabled: boolean; mutate: PantryMutate; close: () => void }) {
  const feedback = useContext(CoreFeedback);
  const [base] = useState(item), [mode, setMode] = useState(item.trackingMode), [quantity, setQuantity] = useState(item.trackingMode === "availability" ? "" : item.quantity), [available, setAvailable] = useState(item.available), [error, setError] = useState<string | null>(null);
  return <CoreDialog title={`Seguimiento de ${base.name}`} close={close}><form className="core-edit-form" onSubmit={event => {
    event.preventDefault(); setError(null);
    try { const amount = mode === "quantity" ? quantityInput(quantity) : null;
      void mutate({ ...availabilityCommand(base, available), mode, quantity: amount }, close);
    } catch { setError("Indica cuánto tienes ahora, con hasta tres decimales."); }
  }}><label className="form-field">Cómo llevarlo<select value={mode} disabled={disabled} onChange={event => setMode(event.target.value as typeof mode)}><option value="quantity">Por cantidad</option><option value="availability">Solo disponibilidad</option></select></label>
    {mode === "quantity" ? <label className="form-field">Cantidad actual ({base.unit === "piece" ? "piezas" : base.unit})<input required inputMode="decimal" value={quantity} disabled={disabled} onChange={event => setQuantity(event.target.value)} /></label> : <label className="core-check"><input type="checkbox" checked={available} disabled={disabled} onChange={event => setAvailable(event.target.checked)} />Tengo este ingrediente</label>}
    <p className="core-muted">Solo disponibilidad no descuenta cantidades al cocinar. El historial anterior se conserva; al volver a cantidad indica tus existencias reales.</p>
    {error && <p className="pantry-error" role="alert">{error}</p>}<button className="pantry-add-button" disabled={disabled}>Guardar seguimiento</button>
  </form>{feedback.error && <p className="pantry-error" role="alert">{feedback.error}</p>}{feedback.retry && <button className="core-text-button" disabled={feedback.busy} onClick={feedback.reattempt}>Reintentar cambio</button>}</CoreDialog>;
}
