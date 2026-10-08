import { quantityInput, quantityString, quantityThousandths } from "./ingredient-input.ts";

export type MealQuantities = Record<string, string>;
export type AmountStep = { stepKey?: string; ingredientId: string | null; ingredientName?: string | null; unit: string | null; quantity: string | null; optional: boolean };
const ZERO = BigInt(0), THOUSAND = BigInt(1000), BILLION = BigInt(1000000000);
function ceil(n: bigint, d: bigint) { return (n + d - BigInt(1)) / d; }
export function amountKey(ingredientId: string, optional: boolean) { return `${ingredientId}:${optional ? "optional" : "required"}`; }
export function mealQuantities(value: unknown): MealQuantities | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Cantidades de comida inválidas.");
  const entries = Object.entries(value);
  if (entries.length > 120) throw new Error("Demasiados ingredientes en la comida.");
  return Object.fromEntries(entries.map(([key, amount]) => {
    if (!/^[0-9a-f-]{36}:(required|optional)$/i.test(key)) throw new Error("Un ingrediente no pertenece al plan.");
    const parsed = quantityInput(amount);
    if (parsed === "0") throw new Error("Indica cantidades mayores que cero.");
    return [key, parsed];
  }));
}
function scaledNine(amount: string, servings: string, base: string) {
  const divisor = quantityThousandths(base);
  if (divisor <= ZERO) throw new Error("Indica porciones base positivas.");
  return ceil(quantityThousandths(amount) * quantityThousandths(servings) * BigInt(1000000), divisor);
}
function nine(value: bigint) {
  const tail = String(value % BILLION).padStart(9, "0").replace(/0+$/, "");
  return `${value / BILLION}${tail ? `.${tail}` : ""}`;
}

/** Ingredient totals for this preparation. Null preserves legacy proportional plans. */
export function ingredientAmounts(steps: AmountStep[], base: string, servings: string, chosen: MealQuantities | null) {
  const groups = new Map<string, { key: string; ingredientId: string; name: string; unit: string; optional: boolean; baseAmount: bigint }>();
  for (const step of steps) if (step.ingredientId && step.quantity && step.unit) {
    const key = amountKey(step.ingredientId, step.optional), old = groups.get(key);
    groups.set(key, { key, ingredientId: step.ingredientId, name: step.ingredientName ?? "Ingrediente", unit: step.unit, optional: step.optional, baseAmount: (old?.baseAmount ?? ZERO) + quantityThousandths(step.quantity) });
  }
  return [...groups.values()].map(group => {
    const proportional = scaledNine(quantityString(group.baseAmount), servings, base);
    const calculated = chosen !== null && group.unit === "piece" ? ceil(proportional, BILLION) * THOUSAND : ceil(proportional, BigInt(1000000));
    return { ...group, calculated: quantityString(calculated), quantity: quantityThousandths(servings) === ZERO ? "0" : chosen?.[group.key] ?? quantityString(calculated), edited: chosen?.[group.key] !== undefined };
  });
}

/** Allocate each chosen total to its original steps, preserving optional selection. */
export function plannedIngredientSteps<T extends AmountStep>(steps: T[], base: string, servings: string, chosen: MealQuantities | null): T[] {
  if (chosen === null) return steps.map(step => ({ ...step, quantity: step.quantity ? nine(scaledNine(step.quantity, servings, base)) : null }));
  const groups = ingredientAmounts(steps, base, servings, chosen);
  const totals = new Map(groups.map(group => [group.key, quantityThousandths(group.quantity) * BigInt(1000000)]));
  const weights = new Map(groups.map(group => [group.key, group.baseAmount]));
  const remaining = new Map(totals);
  const result = steps.map(step => {
    if (!step.ingredientId || !step.quantity || !step.unit) return { ...step };
    const key = amountKey(step.ingredientId, step.optional), weight = weights.get(key)!;
    const amount = weight === ZERO ? ZERO : totals.get(key)! * quantityThousandths(step.quantity) / weight;
    remaining.set(key, remaining.get(key)! - amount);
    return { ...step, quantity: nine(amount) };
  });
  for (const group of groups) {
    const index = steps.findIndex(step => step.ingredientId === group.ingredientId && step.optional === group.optional && step.quantity !== null);
    if (index >= 0 && remaining.get(group.key)! > ZERO) {
      const original = result[index].quantity!, [whole, tail = ""] = original.split(".");
      result[index] = { ...result[index], quantity: nine(BigInt(whole) * BILLION + BigInt(tail.padEnd(9, "0")) + remaining.get(group.key)!) };
    }
  }
  return result;
}
