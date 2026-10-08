import { revision, uuid } from "./contracts.ts";
import { invalid } from "./errors.ts";
import { ingredientName, ingredientUnit, quantityInput, type IngredientUnit } from "./ingredient-input.ts";
export const pantryActions = ["createIngredient", "editIngredient", "setIngredientHidden", "setPantryQuantity", "retireIngredient", "setIngredientTracking"];
export type PantryCommand = { commandId: string; id: string } & (
  { action: "setIngredientTracking"; expectedPreferenceRevision: number | null; expectedBalanceRevision: number | null; expectedIngredientRevision: number; mode: "quantity" | "availability"; available: boolean; quantity: string | null; listed: boolean } |
  { action: "retireIngredient"; expectedDataRevision: string; replacementId: string | null; updatePending: boolean } |
  { action: "createIngredient"; name: string; unit: IngredientUnit; confirmSimilar: boolean; trackingMode?: "quantity" | "availability" } |
  { action: "editIngredient"; expectedRevision: number; name: string; unit: IngredientUnit; confirmSimilar: boolean } |
  { action: "setIngredientHidden"; expectedPreferenceRevision: number | null; hidden: boolean } |
  { action: "setPantryQuantity"; expectedBalanceRevision: number | null; expectedIngredientRevision: number; quantity: string; listed: boolean }
);
function flag(value: unknown) { if (typeof value !== "boolean") invalid("Se esperaba verdadero o falso."); return value; }
function optionalRevision(value: unknown) { return value === null ? null : revision(value); }
export function parsePantryCommand(value: unknown): PantryCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Comando de alacena inválido.");
  const input = value as Record<string, unknown>;
  const common = { commandId: uuid(input.commandId), id: uuid(input.id) };
  const extras: Record<string, string[]> = {
    createIngredient: ["name", "unit", "confirmSimilar", "trackingMode"],
    setIngredientTracking: ["expectedPreferenceRevision", "expectedBalanceRevision", "expectedIngredientRevision", "mode", "available", "quantity", "listed"],
    retireIngredient: ["expectedDataRevision", "replacementId", "updatePending"],
    editIngredient: ["expectedRevision", "name", "unit", "confirmSimilar"],
    setIngredientHidden: ["expectedPreferenceRevision", "hidden"],
    setPantryQuantity: ["expectedBalanceRevision", "expectedIngredientRevision", "quantity", "listed"],
  };
  const action = String(input.action), allowed = ["commandId", "action", "id", ...(extras[action] ?? [])];
  if (!pantryActions.includes(action) || Object.keys(input).some(key => !allowed.includes(key))) invalid("Acción o campos de alacena no admitidos.");
  switch (action) {
    case "setIngredientTracking": {
      if (input.mode !== "quantity" && input.mode !== "availability") invalid("Elige cómo llevar este ingrediente.");
      return { ...common, action, mode: input.mode, available: flag(input.available), listed: flag(input.listed), quantity: input.mode === "quantity" ? quantityInput(input.quantity) : null, expectedPreferenceRevision: optionalRevision(input.expectedPreferenceRevision), expectedBalanceRevision: optionalRevision(input.expectedBalanceRevision), expectedIngredientRevision: revision(input.expectedIngredientRevision) };
    }
    case "retireIngredient": {
      if (typeof input.expectedDataRevision !== "string" || !/^\d{1,19}$/.test(input.expectedDataRevision)) invalid("Actualiza la revisión del ingrediente.");
      const replacementId = input.replacementId === null ? null : uuid(input.replacementId);
      if (replacementId === common.id) invalid("Elige otro ingrediente como sustituto.");
      return { ...common, action, expectedDataRevision: input.expectedDataRevision, replacementId, updatePending: flag(input.updatePending) };
    }
    case "createIngredient": {
      if (input.trackingMode !== undefined && input.trackingMode !== "quantity" && input.trackingMode !== "availability") invalid("Elige cómo llevar este ingrediente.");
      return { ...common, action, name: ingredientName(input.name), unit: ingredientUnit(input.unit), confirmSimilar: flag(input.confirmSimilar), trackingMode: input.trackingMode === "availability" ? "availability" : "quantity" };
    }
    case "editIngredient": return { ...common, action, expectedRevision: revision(input.expectedRevision), name: ingredientName(input.name), unit: ingredientUnit(input.unit), confirmSimilar: flag(input.confirmSimilar) };
    case "setIngredientHidden": return { ...common, action, expectedPreferenceRevision: optionalRevision(input.expectedPreferenceRevision), hidden: flag(input.hidden) };
    case "setPantryQuantity": {
      const quantity = quantityInput(input.quantity), listed = flag(input.listed);
      if (!listed && quantity !== "0") invalid("Quitar de Alacena requiere dejar la cantidad en cero.");
      return { ...common, action, expectedBalanceRevision: optionalRevision(input.expectedBalanceRevision), expectedIngredientRevision: revision(input.expectedIngredientRevision), quantity, listed };
    }
    default: return invalid("Comando de alacena desconocido.");
  }
}
