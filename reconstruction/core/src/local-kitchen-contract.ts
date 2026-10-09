import { parsePantryCommand } from "./pantry-contracts.ts";
import { parseRecipeCommand } from "./recipe-input.ts";
import { parseShoppingCommand } from "./shopping-input.ts";
import { parseCommand, uuid, dateOnly } from "./contracts.ts";
import { invalid } from "./errors.ts";

export const localKitchenActions = ["createIngredient", "setIngredientHidden", "setPantryQuantity", "setIngredientTracking", "createRecipe", "editRecipe", "retireRecipe", "saveShoppingQuantity", "addShoppingEntry", "removeShoppingEntry", "buyShoppingItems", "undoShoppingPurchase"];
export function kitchenCommand(raw: unknown) {
  const action = (raw as {action?:string})?.action;
  if (["createIngredient", "setIngredientHidden", "setPantryQuantity", "setIngredientTracking"].includes(action ?? "")) return parsePantryCommand(raw);
  if (["createRecipe", "editRecipe", "retireRecipe"].includes(action ?? "")) return parseRecipeCommand(raw) as Omit<ReturnType<typeof parseRecipeCommand>,"action"> & {action:"createRecipe"|"editRecipe"|"retireRecipe"};
  if (["saveShoppingQuantity", "addShoppingEntry", "removeShoppingEntry", "buyShoppingItems", "undoShoppingPurchase"].includes(action ?? "")) return parseShoppingCommand(raw);
  const command = parseCommand(raw);
  if (command.action !== "setCompleted" || command.scope && command.scope !== "this") invalid("Esta acción de Cocina necesita conexión directa.");
  return command;
}
export type KitchenCommand = ReturnType<typeof kitchenCommand>;
export type KitchenOperation = { command: KitchenCommand; at: string };
export type KitchenBatch = { commandId: string; action: "syncLocalKitchen"; expectedDataRevision: string; start: string; operations: KitchenOperation[]; receiptIds: Record<string,string> };
export function parseKitchenBatch(raw: unknown): KitchenBatch {
  const row = raw as KitchenBatch;
  if (!row || row.action !== "syncLocalKitchen" || !/^\d{1,20}$/.test(row.expectedDataRevision) || !Array.isArray(row.operations) || !row.operations.length || row.operations.length > 20) invalid("Lote de Cocina inválido.");
  const operations = row.operations.map(op => {
    if (!op || typeof op.at !== "string" || !Number.isFinite(Date.parse(op.at))) invalid("Fecha de operación inválida.");
    return { command:kitchenCommand(op.command), at:op.at };
  });
  if (new Set(operations.map(op=>op.command.commandId)).size !== operations.length) invalid("No repitas operaciones.");
  const ids = Object.entries(row.receiptIds ?? {});
  if (ids.length > 1000) invalid("Demasiadas referencias de compra.");
  return {commandId:uuid(row.commandId),action:"syncLocalKitchen",expectedDataRevision:row.expectedDataRevision,start:dateOnly(row.start),operations,receiptIds:Object.fromEntries(ids.map(([key,value])=>[uuid(key),uuid(value)]))};
}
/** Small, bounded ledger for reversals. It never includes credentials or another owner. */
export type KitchenLedger = {
  steps: {id:string;mealId:string;dishId:string;stepKey:string;role:"preparation"|"priorReminder"}[];
  completions: {id:string;mealId:string;amounts:{ingredientId:string;quantity:string}[];uses:{batchId:string;quantity:string}[]}[];
  batches: {id:string;completionId:string;mealId:string;title:string;recipeId:string;recipeName:string;version:number;createdAt:string;quantity:string}[];
  entries: {id:string;ingredientId:string|null;name:string;unit:string;free:boolean;quantity:string|null;closed:boolean;retired:boolean}[];
  purchases: {id:string;entryId:string;ingredientId:string|null;quantity:string;availabilityOnly:boolean;previousAvailable:boolean|null;previousReceiptId:string|null}[];
  availabilityReceipts: Record<string,string|null>;
};
// Stable local IDs allow a purchase to be undone before it has ever been sent.
export function localReceiptId(commandId:string,index:number) {
  return `${commandId.slice(0,24)}${index.toString(16).padStart(12,"0")}`;
}
