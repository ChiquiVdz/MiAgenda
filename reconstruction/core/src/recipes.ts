import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/client.ts";
import { uuid } from "./contracts.ts";
import { CoreError } from "./errors.ts";
import { parseRecipeCommand } from "./recipe-input.ts";
import { executeOwnerCommand } from "./owner-command.ts";
import { ingredientTracking } from "./ingredient-tracking.ts";
import { selectableIngredient } from "./ingredient-retirement.ts";
export const recipeInclude = { classifications: { where: { slot: { retiredAt: null } }, select: { slotId: true }, orderBy: { slotId: "asc" as const } }, versions: { orderBy: { version: "desc" as const }, take: 1, include: { steps: { orderBy: { position: "asc" as const } } } } } satisfies Prisma.RecipeInclude;
const include = recipeInclude;
type Row = Prisma.RecipeGetPayload<{ include: typeof include }>;
export function recipeView(row: Row) {
  const version = row.versions[0];
  // Historical revisions stay immutable; saving in the new editor derives the flag again.
  const draft = version.draft || !version.baseServings || !version.cookingMinutes || !version.steps.length || !version.steps.some(step => step.ingredientId);
  return { id: row.id, revision: row.revision, revisionId: version.id, version: version.version, name: version.name, description: null, draft, slotIds: row.classifications.map(item => item.slotId),
    baseServings: version.baseServings?.toString() ?? null, cookingMinutes: version.cookingMinutes,
    steps: version.steps.map(step => ({ stepKey: step.stepKey, text: step.text, optional: step.optional, ingredientId: step.ingredientId,
      ingredientName: step.ingredientNameSnapshot, unit: step.unitSnapshot, quantity: step.quantityForBaseServings?.toString() ?? null,
      equivalent: step.equivalent, minutesBefore: step.minutesBefore, priorTitle: step.priorTitle, priorGroup: step.priorGroup })) };
}
const view = recipeView;
export type RecipeView = ReturnType<typeof view>;
export type RecipeSnapshot = { items: RecipeView[]; slots: { id: string; name: string }[]; nextId: string | null; dataRevision: string };
export class RecipeService {
  private readonly db: PrismaClient;
  constructor(db: PrismaClient) { this.db = db; }
  async snapshot(owner: string, after?: string): Promise<RecipeSnapshot> {
    const userId = uuid(owner), afterId = after ? uuid(after) : null;
    return this.db.$transaction(async tx => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { dataRevision: true } });
      if (!user) throw new CoreError("UNAUTHENTICATED", "Inicia sesión.");
      const rows = await tx.recipe.findMany({ where: { userId, retiredAt: null, ...(afterId ? { id: { gt: afterId } } : {}) }, orderBy: { id: "asc" }, take: 31, include });
      const slots = await tx.mealSlot.findMany({ where: { userId, retiredAt: null }, orderBy: [{ position: "asc" }, { id: "asc" }], select: { id: true, name: true } });
      return { items: rows.slice(0, 30).map(view), slots, nextId: rows.length > 30 ? rows[29].id : null, dataRevision: user.dataRevision.toString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }
  async execute(owner: string, raw: unknown) {
    const command = parseRecipeCommand(raw);
    return executeOwnerCommand(this.db, owner, command, async (tx, userId) => {
      const current = await tx.recipe.findFirst({ where: { id: command.id, userId, retiredAt: null }, include });
      if (command.action !== "createRecipe") {
        if (!current) throw new CoreError("NOT_FOUND", "La receta ya no está disponible.");
        if (current.revision !== command.expectedRevision) throw new CoreError("CONFLICT", "La receta cambió. Cierra y vuelve a abrir el editor para revisar su versión actual.");
      }
      if (command.action === "retireRecipe") await tx.recipe.update({ where: { id: command.id }, data: { retiredAt: new Date() } });
      else {
        const input = command.recipe!, ingredients = await tx.ingredient.findMany({ where: { id: { in: input.steps.flatMap(step => step.ingredientId ? [step.ingredientId] : []) }, ...selectableIngredient(userId) } });
        if (input.slotIds !== undefined && await tx.mealSlot.count({ where: { userId, retiredAt: null, id: { in: input.slotIds } } }) !== input.slotIds.length) {
          throw new CoreError("CONFLICT", "Un tipo de comida ya no está disponible. Actualiza el recetario y revisa su clasificación.");
        }
        const tracking = await ingredientTracking(tx, userId);
        for (const step of input.steps) if (step.ingredientId) {
          const ingredient = ingredients.find(item => item.id === step.ingredientId);
          if (!ingredient) throw new CoreError("DEPENDENCY", "Un ingrediente ya no está disponible.");
          if (step.quantity === null && tracking.find(row => row.ingredientId === ingredient.id)?.mode !== "availability") throw new CoreError("DEPENDENCY", `Indica cantidad para ${ingredient.name}, o elige Solo disponibilidad en Alacena.`);
          if (ingredient.revision !== step.expectedIngredientRevision) throw new CoreError("CONFLICT", `Cambió ${ingredient.name}. Actualiza el catálogo antes de guardar.`);
        }
        if (!current) await tx.recipe.create({ data: { id: command.id, userId } });
        else await tx.recipe.update({ where: { id: command.id }, data: { revision: { increment: 1 } } });
        if (input.slotIds !== undefined) {
          await tx.recipeMealSlot.deleteMany({ where: { recipeId: command.id, userId } });
          if (input.slotIds.length) await tx.recipeMealSlot.createMany({ data: input.slotIds.map(slotId => ({ recipeId: command.id, slotId, userId })) });
        }
        await tx.recipeRevision.create({ data: { id: randomUUID(), userId, recipeId: command.id, version: (current?.versions[0].version ?? 0) + 1,
          name: input.name, description: input.description, draft: input.draft, baseServings: input.baseServings, cookingMinutes: input.cookingMinutes,
          steps: { create: input.steps.map((step, position) => { const ingredient = ingredients.find(item => item.id === step.ingredientId); return {
            // Composite parent relation supplies userId; Prisma rejects it in a nested step create.
            id: randomUUID(), stepKey: step.stepKey, position, text: step.text, optional: step.optional, ingredientId: step.ingredientId,
            ingredientNameSnapshot: ingredient?.name ?? null, unitSnapshot: ingredient?.unit ?? null, quantityForBaseServings: step.quantity, equivalent: step.equivalent, minutesBefore: step.minutesBefore, priorTitle: step.priorTitle, priorGroup: step.priorGroup ?? false,
          } satisfies Prisma.RecipeStepUncheckedCreateWithoutRevisionInput; }) } } });
      }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
      const saved = command.action === "retireRecipe" ? null : view(await tx.recipe.findFirstOrThrow({ where: { id: command.id, userId }, include }));
      return { item: saved, removedId: saved ? null : command.id, dataRevision: user.dataRevision.toString() };
    });
  }
}
