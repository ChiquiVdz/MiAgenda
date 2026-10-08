import { uuid } from "./contracts.ts";
import { invalid } from "./errors.ts";
import { ingredientName, quantityInput, quantityThousandths } from "./ingredient-input.ts";
export const shoppingActions = ["saveShoppingQuantity", "addShoppingEntry", "removeShoppingEntry", "buyShoppingItems", "undoShoppingPurchase"];
export type ShoppingKey = string;
export function shoppingKey(value: unknown) {
  if (typeof value !== "string" || !/^[ie]:/.test(value)) invalid("Artículo inválido.");
  return `${value.slice(0, 1)}:${uuid(value.slice(2))}`;
}
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Comando de compras inválido.");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key))) invalid("Campos de compras no admitidos.");
  return row;
}
export function parseShoppingCommand(raw: unknown) {
  const row = object(raw, ["action", "commandId", "expectedDataRevision", "id", "key", "quantity", "name", "unit", "ingredientId", "expectedIngredientRevision", "items"]);
  if (!shoppingActions.includes(String(row.action))) invalid("Acción de compras desconocida.");
  if (typeof row.expectedDataRevision !== "string" || !/^\d{1,20}$/.test(row.expectedDataRevision)) invalid("Actualiza Compras antes de guardar.");
  const common = { commandId: uuid(row.commandId), expectedDataRevision: row.expectedDataRevision };
  switch (row.action) {
    case "saveShoppingQuantity": return { ...common, action: "saveShoppingQuantity" as const, key: shoppingKey(row.key), quantity: row.quantity === null ? null : quantityInput(row.quantity) };
    case "removeShoppingEntry": return { ...common, action: "removeShoppingEntry" as const, id: uuid(row.id) };
    case "undoShoppingPurchase": return { ...common, action: "undoShoppingPurchase" as const, id: uuid(row.id) };
    case "addShoppingEntry": {
      const ingredientId = row.ingredientId === null ? null : uuid(row.ingredientId);
      if (ingredientId && (!Number.isInteger(row.expectedIngredientRevision) || Number(row.expectedIngredientRevision) < 0)) invalid("Actualiza el ingrediente.");
      if (typeof row.unit !== "string" || !row.unit.trim() || row.unit.length > 32 || /[\p{Cc}\p{Cf}]/u.test(row.unit)) invalid("Escribe una unidad de hasta 32 caracteres.");
      const quantity = quantityInput(row.quantity); if (quantityThousandths(quantity) === BigInt(0)) invalid("Indica una cantidad mayor que cero.");
      return { ...common, action: "addShoppingEntry" as const, id: uuid(row.id), name: ingredientName(row.name), unit: row.unit.trim(), quantity, ingredientId, expectedIngredientRevision: ingredientId ? Number(row.expectedIngredientRevision) : null };
    }
    case "buyShoppingItems": {
      if (!Array.isArray(row.items) || !row.items.length || row.items.length > 200) invalid("Selecciona entre 1 y 200 artículos para comprar.");
      const items = row.items.map(value => { const item = object(value, ["key", "quantity"]), quantity = quantityInput(item.quantity); return { key: shoppingKey(item.key), quantity }; }).sort((a, b) => a.key.localeCompare(b.key));
      if (new Set(items.map(item => item.key)).size !== items.length) invalid("No repitas artículos en una compra.");
      return { ...common, action: "buyShoppingItems" as const, items };
    }
    default: return invalid("Comando desconocido.");
  }
}
