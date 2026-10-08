import { uuid, revision } from "./contracts.ts";
import { invalid } from "./errors.ts";
import { quantityInput, quantityThousandths } from "./ingredient-input.ts";
export type RecipeStepInput = { stepKey: string; text: string; optional: boolean; ingredientId: string | null; expectedIngredientRevision: number | null; quantity: string | null; equivalent: string | null; minutesBefore: number | null; priorTitle: string | null; priorGroup?: boolean };
export type RecipeInput = { name: string; description: string | null; draft: boolean; baseServings: string | null; cookingMinutes: number | null; steps: RecipeStepInput[]; slotIds?: string[] };
export const recipeActions = ["createRecipe", "editRecipe", "retireRecipe"];
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Contenido de receta inválido.");
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key))) invalid("Hay campos de receta no admitidos.");
  return item;
}
function text(value: unknown, max: number, required = false): string | null {
  if (value === null && !required) return null;
  if (typeof value !== "string" || value.length > max || /[\p{Cf}]/u.test(value)) invalid(`Texto inválido; máximo ${max} caracteres.`);
  const result = value.trim(); if (required && !result) invalid("Escribe un nombre o texto para el paso.");
  return result || null;
}
function flag(value: unknown) { if (typeof value !== "boolean") invalid("Marca una opción válida."); return value; }
function minutes(value: unknown, max: number) { if (value === null) return null; if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > max) invalid(`El tiempo debe estar entre 1 y ${max} minutos.`); return value; }
export function parseRecipeCommand(raw: unknown) {
  const command = object(raw, ["action", "commandId", "id", "expectedRevision", "recipe"]);
  const action = String(command.action); if (!recipeActions.includes(action)) invalid("Acción de receta desconocida.");
  const common = { action, commandId: uuid(command.commandId), id: uuid(command.id), expectedRevision: action === "createRecipe" ? null : revision(command.expectedRevision) };
  if (action === "retireRecipe") { if ("recipe" in command) invalid("Retirar no admite contenido nuevo."); return { ...common, recipe: null }; }
  const input = object(command.recipe, ["name", "description", "draft", "baseServings", "cookingMinutes", "steps", "slotIds"]);
  let slotIds: string[] | undefined;
  if ("slotIds" in input) {
    if (!Array.isArray(input.slotIds) || input.slotIds.length > 20) invalid("Elige hasta 20 tipos de comida.");
    slotIds = input.slotIds.map(value => uuid(value));
    if (new Set(slotIds).size !== slotIds.length) invalid("No repitas un tipo de comida.");
    slotIds.sort();
  }
  const baseServings = input.baseServings === null ? null : quantityInput(input.baseServings);
  if (baseServings !== null && (quantityThousandths(baseServings) <= BigInt(0) || quantityThousandths(baseServings) > BigInt(9999999999))) invalid("Las porciones deben ser mayores que cero y menores que 10000000.");
  const cookingMinutes = minutes(input.cookingMinutes, 10080);
  if (!Array.isArray(input.steps) || input.steps.length > 60) invalid("La receta admite hasta 60 pasos.");
  const steps: RecipeStepInput[] = input.steps.map(rawStep => {
    const step = object(rawStep, ["stepKey", "text", "optional", "ingredientId", "expectedIngredientRevision", "quantity", "equivalent", "minutesBefore", "priorTitle", "priorGroup"]);
    const ingredientId = step.ingredientId === null ? null : uuid(step.ingredientId), quantity = ingredientId && step.quantity !== null ? quantityInput(step.quantity) : null;
    if (quantity !== null && quantityThousandths(quantity) <= BigInt(0)) invalid("La cantidad de ingrediente debe ser mayor que cero.");
    if (!ingredientId && (step.quantity !== null || step.expectedIngredientRevision !== null || step.equivalent !== null)) invalid("La cantidad y equivalencia requieren ingrediente.");
    const minutesBefore = minutes(step.minutesBefore, 525600), priorTitle = text(step.priorTitle, 150);
    const priorGroup = step.priorGroup === undefined ? false : flag(step.priorGroup);
    if (priorGroup && minutesBefore === null) invalid("Un tramo previo necesita anticipación.");
    if ((minutesBefore === null) !== (priorTitle === null)) invalid("La preparación previa necesita título y anticipación.");
    return { stepKey: uuid(step.stepKey), text: text(step.text, 2000, true)!, optional: flag(step.optional), ingredientId,
      expectedIngredientRevision: ingredientId ? revision(step.expectedIngredientRevision) : null, quantity, equivalent: ingredientId ? text(step.equivalent, 120) : null, minutesBefore, priorTitle, ...(step.priorGroup !== undefined ? { priorGroup } : {}) };
  });
  if (new Set(steps.map(step => step.stepKey)).size !== steps.length) invalid("Los pasos deben tener identidades distintas.");
  const draft = !baseServings || !cookingMinutes || !steps.length || !steps.some(step => step.ingredientId !== null);
  return { ...common, recipe: { name: text(input.name, 250, true)!, description: text(input.description, 4000), draft, baseServings, cookingMinutes, steps, ...(slotIds !== undefined ? { slotIds } : {}) } satisfies RecipeInput };
}
