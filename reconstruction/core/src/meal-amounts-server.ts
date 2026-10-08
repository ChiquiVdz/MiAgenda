import { Prisma } from "../generated/client.ts";
import { plannedIngredientSteps, type AmountStep, type MealQuantities } from "./meal-amounts.ts";

/** Keep the original decimal calculation for plans saved before chosen amounts. */
export function inventoryIngredientSteps<T extends AmountStep>(steps:T[],base:string,servings:string,chosen:MealQuantities|null):T[] {
  if(chosen!==null)return plannedIngredientSteps(steps,base,servings,chosen);
  return steps.map(step=>({...step,quantity:step.quantity?new Prisma.Decimal(step.quantity).mul(servings).div(base).toString():null}));
}
export function displayIngredientAmount(amount:string|null) {
  return amount===null?null:new Prisma.Decimal(amount).toDecimalPlaces(3,Prisma.Decimal.ROUND_CEIL).toString();
}
