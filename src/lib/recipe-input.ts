export type RecipeInput = {
  name: string;
  instructions: string;
  servings: number;
  durationMinutes: number;
  ingredients: Array<{ ingredientId: string; quantityPerServing: number; equivalent: string | null }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validPositiveAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    && value <= 999_999_999.999 && Number(value.toFixed(3)) === value;
}

export function parseRecipeInput(value: unknown): RecipeInput | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
  const instructions = typeof value.instructions === "string" ? value.instructions.trim() : "";
  const servings = value.servings;
  const durationMinutes = value.durationMinutes;
  if (!name || name.length > 150 || !instructions || instructions.length > 10_000
    || typeof servings !== "number" || !Number.isInteger(servings) || servings < 1 || servings > 100
    || typeof durationMinutes !== "number" || !Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 480
    || !Array.isArray(value.ingredients) || value.ingredients.length < 1 || value.ingredients.length > 50) return null;

  const ingredients: RecipeInput["ingredients"] = [];
  const usedIds = new Set<string>();
  for (const item of value.ingredients) {
    if (!isRecord(item) || typeof item.ingredientId !== "string" || !item.ingredientId || item.ingredientId.length > 30
      || !validPositiveAmount(item.quantityPerServing)) return null;
    if (usedIds.has(item.ingredientId)) return null;
    usedIds.add(item.ingredientId);
    const equivalent = item.equivalent === undefined || item.equivalent === null || item.equivalent === ""
      ? null
      : typeof item.equivalent === "string" ? item.equivalent.trim() : undefined;
    if (equivalent === undefined || (equivalent !== null && equivalent.length > 120)) return null;
    ingredients.push({ ingredientId: item.ingredientId, quantityPerServing: item.quantityPerServing, equivalent });
  }

  return { name, instructions, servings, durationMinutes, ingredients };
}
