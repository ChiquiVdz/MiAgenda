import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/client.ts";
import { CoreError } from "./errors.ts";
import { amountKey, ingredientAmounts, mealQuantities } from "./meal-amounts.ts";
import { quantityString, quantityThousandths } from "./ingredient-input.ts";

type Tx = Prisma.TransactionClient;
export const selectableIngredient = (userId: string) => ({ retiredAt: null, OR: [{ scope: "global" as const }, { ownerUserId: userId }], preferences: { none: { userId, retiredForUser: true } } });

/** Historical IDs remain valid evidence. Only reversals follow a user's replacements. */
export async function reversalIngredient(tx: Tx, userId: string, originalId: string) {
  let id = originalId;
  const visited = new Set<string>();
  while (!visited.has(id)) {
    visited.add(id);
    const preference = await tx.ingredientPreference.findUnique({ where: { userId_ingredientId: { userId, ingredientId: id } } });
    if (!preference?.retiredForUser || !preference.replacementId) return id;
    id = preference.replacementId;
  }
  throw new CoreError("DEPENDENCY", "Hay un ciclo de sustituciones. Revisa los ingredientes antes de continuar.");
}

export async function returnHistoricalStock(tx: Tx, userId: string, commandId: string, ingredientId: string, quantity: Prisma.Decimal) {
  const targetId = await reversalIngredient(tx, userId, ingredientId);
  if (targetId !== ingredientId) await transferStock(tx, userId, commandId, ingredientId, targetId, quantity);
  await tx.ingredientPreference.updateMany({ where: { userId, ingredientId: targetId, retiredForUser: true }, data: { retiredForUser: false, hidden: false, replacementId: null } });
  await tx.pantryBalance.updateMany({ where: { userId, ingredientId: targetId, listed: false }, data: { listed: true } });
}

/** Balanced adjustments preserve exact original reversals and the immutable ledger. */
export async function transferStock(tx: Tx, userId: string, commandId: string, sourceId: string, targetId: string, quantity: Prisma.Decimal) {
  if (quantity.isZero() || sourceId === targetId) return;
  const source = await tx.ingredient.findUniqueOrThrow({ where: { id: sourceId } });
  const target = await tx.ingredient.findUniqueOrThrow({ where: { id: targetId } });
  if (source.unit !== target.unit) throw new CoreError("DEPENDENCY", "Solo se pueden unificar ingredientes con la misma unidad. Ajusta o convierte las cantidades explícitamente antes.");
  const balances = await tx.pantryBalance.findMany({ where: { userId, ingredientId: { in: [sourceId, targetId] } } });
  if ((balances.find(b => b.ingredientId === sourceId)?.quantity ?? new Prisma.Decimal(0)).lt(quantity)) throw new CoreError("DEPENDENCY", "No hay existencias suficientes para el traslado.");
  if ((balances.find(b => b.ingredientId === targetId)?.quantity ?? new Prisma.Decimal(0)).add(quantity).gt("999999999.999")) throw new CoreError("DEPENDENCY", "La suma excede la cantidad máxima de Alacena.");
  const operationId = randomUUID();
  const operation = await tx.inventoryOperation.create({ data: { id: operationId, userId, commandId, kind: "adjustment", sourceKey: operationId,
    sourceRevision: balances.find(balance => balance.ingredientId === sourceId)?.revision ?? 0 } });
  // Subtraction first also avoids temporary overflow and respects nonnegative stock.
  await tx.inventoryMovement.create({ data: { id: randomUUID(), userId, operationId: operation.id, ingredientId: sourceId, unit: source.unit, delta: quantity.neg() } });
  await tx.inventoryMovement.create({ data: { id: randomUUID(), userId, operationId: operation.id, ingredientId: targetId, unit: target.unit, delta: quantity } });
}

const versionInclude = { steps: { orderBy: { position: "asc" as const } } };
export async function ingredientImpact(tx: Tx, userId: string, id: string) {
  const ingredient = await tx.ingredient.findFirst({ where: { id, ...selectableIngredient(userId) }, include: { pantry: { where: { userId } } } });
  if (!ingredient) throw new CoreError("NOT_FOUND", "El ingrediente ya no está disponible en tu catálogo.");
  const recipes = await tx.recipe.findMany({ where: { userId, retiredAt: null }, include: { versions: { orderBy: { version: "desc" }, take: 1, include: versionInclude } } });
  const affected = recipes.filter(recipe => recipe.versions[0]?.steps.some(step => step.ingredientId === id));
  const pending = await tx.mealRecipe.findMany({ where: { userId, recipeRevision: { is: { steps: { some: { ingredientId: id } } } }, block: { is: { activity: { is: { lifecycle: "active", completedAt: null } } } } }, include: { recipeRevision: { include: versionInclude }, block: { include: { activity: { include: { schedule: true } } } } } });
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
  return { ingredient, recipes: affected, pending, dataRevision: user.dataRevision.toString() };
}

export function impactView(impact: Awaited<ReturnType<typeof ingredientImpact>>) {
  const meals = new Map(impact.pending.map(dish => [dish.blockId, { id: dish.blockId, name: dish.block.activity.title, startsAt: dish.block.activity.schedule?.startsAt?.toISOString() ?? null }]));
  return { dataRevision: impact.dataRevision, quantity: impact.ingredient.pantry[0]?.quantity.toString() ?? "0", unit: impact.ingredient.unit,
    recipes: impact.recipes.map(recipe => ({ id: recipe.id, name: recipe.versions[0].name })), meals: [...meals.values()],
    pendingRemovalBlocked: impact.pending.some(dish => !dish.recipeRevision.steps.some(step => step.ingredientId && step.ingredientId !== impact.ingredient.id)) };
}
export type IngredientImpact = ReturnType<typeof impactView>;

export async function retireIngredient(tx: Tx, userId: string, command: { id: string; commandId: string; expectedDataRevision: string; replacementId: string | null; updatePending: boolean }) {
  const impact = await ingredientImpact(tx, userId, command.id);
  if (impact.dataRevision !== command.expectedDataRevision) throw new CoreError("CONFLICT", "Cambió Alacena, una receta o una comida. Vuelve a revisar el reemplazo antes de confirmar.");
  const target = command.replacementId ? await tx.ingredient.findFirst({ where: { id: command.replacementId, ...selectableIngredient(userId) } }) : null;
  if (command.replacementId && !target) throw new CoreError("NOT_FOUND", "El sustituto ya no está disponible.");
  if (target && target.unit !== impact.ingredient.unit) throw new CoreError("DEPENDENCY", "El sustituto debe tener la misma unidad. No convertimos gramos, mililitros y piezas automáticamente.");
  const preferences = await tx.ingredientPreference.findMany({ where: { userId, ingredientId: { in: [command.id, ...(target ? [target.id] : [])] } } });
  const sourceMode = preferences.find(row => row.ingredientId === command.id)?.trackingMode ?? "quantity";
  const targetMode = target ? preferences.find(row => row.ingredientId === target.id)?.trackingMode ?? "quantity" : sourceMode;
  if (target && sourceMode !== targetMode) throw new CoreError("DEPENDENCY", "Elige el mismo seguimiento para ambos ingredientes antes de sustituirlos. Al pasar a Por cantidad, indica las existencias reales.");
  const quantity = impact.ingredient.pantry[0]?.quantity ?? new Prisma.Decimal(0);
  if (!target && quantity.gt(0)) throw new CoreError("DEPENDENCY", sourceMode === "availability" ? "Hay un saldo numérico anterior protegido por el historial. Vuelve a Por cantidad e indica cero antes de retirarlo, o elige un sustituto con el mismo seguimiento." : "Todavía tienes existencias. Elige un sustituto o ajusta primero la cantidad a cero en Alacena.");
  if (!target && command.updatePending && impactView(impact).pendingRemovalBlocked) throw new CoreError("DEPENDENCY", "Una comida quedaría sin ingredientes. Elige un sustituto o conserva su versión planificada y edítala después.");

  // Copy each frozen version separately. Older plans never pick up unrelated newer edits.
  const recipeIds = [...new Set([...impact.recipes.map(recipe => recipe.id), ...(command.updatePending ? impact.pending.map(dish => dish.recipeRevision.recipeId) : [])])];
  const replacements = new Map<string, string>();
  for (const recipeId of recipeIds) {
    const latest = await tx.recipeRevision.findFirstOrThrow({ where: { userId, recipeId }, orderBy: { version: "desc" }, include: versionInclude });
    const sources = new Map<string, typeof latest>();
    if (command.updatePending) for (const dish of impact.pending.filter(dish => dish.recipeRevision.recipeId === recipeId)) sources.set(dish.recipeRevision.id, dish.recipeRevision);
    sources.delete(latest.id); sources.set(latest.id, latest); // Keep the actual current definition last.
    let version = latest.version;
    for (const source of sources.values()) {
      const touches = source.steps.some(step => step.ingredientId === command.id);
      if (!touches && sources.size === 1) continue;
      const steps = source.steps.map(step => {
        const changed = step.ingredientId === command.id;
        return { id: randomUUID(), stepKey: step.stepKey, position: step.position, text: step.text, optional: step.optional,
          ingredientId: changed ? target?.id ?? null : step.ingredientId,
          ingredientNameSnapshot: changed ? target?.name ?? null : step.ingredientNameSnapshot,
          unitSnapshot: changed ? target?.unit ?? null : step.unitSnapshot,
          quantityForBaseServings: changed && !target ? null : step.quantityForBaseServings,
          equivalent: changed && !target ? null : step.equivalent, minutesBefore: step.minutesBefore, priorTitle: step.priorTitle, priorGroup: step.priorGroup };
      });
      const saved = await tx.recipeRevision.create({ data: { id: randomUUID(), userId, recipeId, version: ++version,
        name: source.name, description: source.description, baseServings: source.baseServings, cookingMinutes: source.cookingMinutes,
        draft: source.draft || !steps.some(step => step.ingredientId), steps: { create: steps } } });
      replacements.set(source.id, saved.id);
    }
    await tx.recipe.update({ where: { id: recipeId }, data: { revision: { increment: 1 } } });
  }
  if (command.updatePending) for (const dish of impact.pending) {
    const revisionId = replacements.get(dish.recipeRevisionId)!;
    const chosen = mealQuantities(dish.ingredientQuantities);
    if (chosen) {
      const amounts = ingredientAmounts(dish.recipeRevision.steps.map(step => ({ ingredientId:step.ingredientId,unit:step.unitSnapshot,quantity:step.quantityForBaseServings?.toString()??null,optional:step.optional })),dish.recipeRevision.baseServings!.toString(),dish.cookedServings.toString(),chosen);
      for (const optional of [false,true]) {
        const sourceKey=amountKey(command.id,optional), targetKey=target?amountKey(target.id,optional):null;
        if(targetKey&&(chosen[sourceKey]!==undefined||chosen[targetKey]!==undefined)) {
          const total=amounts.filter(row=>row.optional===optional&&(row.ingredientId===command.id||row.ingredientId===target!.id)).reduce((sum,row)=>sum+quantityThousandths(row.quantity),BigInt(0));
          if(total>BigInt("999999999999")) throw new CoreError("DEPENDENCY","La cantidad elegida excedería el máximo después de sustituir el ingrediente.");
          if(total>BigInt(0)) chosen[targetKey]=quantityString(total);
        }
        delete chosen[sourceKey];
      }
    }
    await tx.mealRecipe.update({ where: { id: dish.id }, data: { recipeRevisionId: revisionId,ingredientQuantities:chosen??Prisma.DbNull } });
    await tx.mealStepData.updateMany({ where: { userId, mealRecipeId: dish.id, ingredientId: command.id }, data: {
      ingredientId: target?.id ?? null, ingredientNameSnapshot: target?.name ?? null, unitSnapshot: target?.unit ?? null,
      ...(target ? {} : { quantityPerServing: null, equivalent: null }) } });
    await tx.activity.update({ where: { id: dish.blockId }, data: { revision: { increment: 1 } } });
  }
  // Entries have immutable identity. Replace pending entries, keep receipt-linked originals.
  const entries = await tx.shoppingEntry.findMany({ where: { userId, ingredientId: command.id, retiredAt: null } });
  const targetOverride = target ? await tx.shoppingEntry.findFirst({ where: { userId, ingredientId: target.id, free: false, retiredAt: null } }) : null;
  let overrideQuantity = targetOverride?.quantity ?? null;
  for (const entry of entries) {
    await tx.shoppingEntry.update({ where: { id: entry.id }, data: { retiredAt: new Date() } });
    if (!target || entry.closedAt) continue;
    if (entry.free) await tx.shoppingEntry.create({ data: { userId, ingredientId: target.id, name: target.name, unit: target.unit, free: true, quantity: entry.quantity } });
    else if (entry.quantity) overrideQuantity = (overrideQuantity ?? new Prisma.Decimal(0)).add(entry.quantity);
  }
  if (target && overrideQuantity) {
    if (overrideQuantity.gt("999999999.999")) throw new CoreError("DEPENDENCY", "La suma de cantidades elegidas en Compras supera el máximo.");
    if (targetOverride) await tx.shoppingEntry.update({ where: { id: targetOverride.id }, data: { quantity: overrideQuantity } });
    else await tx.shoppingEntry.create({ data: { userId, ingredientId: target.id, name: target.name, unit: target.unit, quantity: overrideQuantity } });
  }
  if (target) await transferStock(tx, userId, command.commandId, command.id, target.id, quantity);
  const wasAvailable = impact.ingredient.pantry[0]?.available ?? false;
  if (sourceMode === "availability" && target && wasAvailable) await tx.pantryBalance.upsert({ where: { userId_ingredientId: { userId, ingredientId: target.id } }, create: { userId, ingredientId: target.id, quantity: "0", listed: true, available: true }, update: { available: true, listed: true, availabilityReceiptId: null } });
  if (impact.ingredient.pantry[0]) await tx.pantryBalance.update({ where: { userId_ingredientId: { userId, ingredientId: command.id } }, data: { listed: false, available: false, availabilityReceiptId: null } });
  if (target && (quantity.gt(0) || impact.ingredient.pantry[0]?.listed)) await tx.pantryBalance.upsert({ where: { userId_ingredientId: { userId, ingredientId: target.id } }, create: { userId, ingredientId: target.id, quantity: "0", listed: true }, update: { listed: true } });
  await tx.ingredientPreference.upsert({ where: { userId_ingredientId: { userId, ingredientId: command.id } }, create: { userId, ingredientId: command.id, hidden: true, retiredForUser: true, replacementId: target?.id ?? null }, update: { hidden: true, retiredForUser: true, replacementId: target?.id ?? null } });
  return target?.id ?? null;
}
