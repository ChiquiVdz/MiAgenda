import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/client.ts";
import { uuid } from "./contracts.ts";
import { CoreError, invalid } from "./errors.ts";
import { normalizedIngredientName, quantityString, quantityThousandths, similarIngredientName } from "./ingredient-input.ts";
import { parsePantryCommand } from "./pantry-contracts.ts";
import { executeOwnerCommand } from "./owner-command.ts";
import { ingredientImpact, impactView, retireIngredient, selectableIngredient } from "./ingredient-retirement.ts";

type Tx = Prisma.TransactionClient;
function accessible(userId: string) { return selectableIngredient(userId); }
function ingredientInclude(userId: string) {
  return { preferences: { where: { userId } }, pantry: { where: { userId } }, movements: { where: { userId }, select: { id: true }, take: 1 }, recipeSteps: { where: { userId }, select: { id: true }, take: 1 }, shoppingEntries: { where: { userId }, select: { id: true }, take: 1 } } satisfies Prisma.IngredientInclude;
}
type IngredientRow = Prisma.IngredientGetPayload<{ include: ReturnType<typeof ingredientInclude> }>;
function ingredientView(item: IngredientRow) {
  const preference = item.preferences[0], balance = item.pantry[0];
  return { id: item.id, name: item.name, normalizedName: item.normalizedName, unit: item.unit, scope: item.scope,
    trackingMode: (preference?.trackingMode === "availability" ? "availability" : "quantity") as "quantity" | "availability", available: preference?.trackingMode === "availability" ? balance?.available ?? false : !!balance?.quantity.gt(0),
    revision: item.revision, hidden: preference?.hidden ?? false, preferenceRevision: preference?.revision ?? null,
    unitLocked: item.scope === "global" || item.movements.length > 0 || item.recipeSteps.length > 0 || item.shoppingEntries.length > 0 || (balance ? !balance.quantity.isZero() : false),
    balanceRevision: balance?.revision ?? null, quantity: balance?.quantity.toString() ?? "0", listed: balance?.listed ?? false };
}
export type IngredientView = ReturnType<typeof ingredientView>;
export type PantryItemView = { ingredient: IngredientView; quantity: string; revision: number };
export type PantrySnapshot = { ingredients: IngredientView[]; items: PantryItemView[]; nextCatalogId: string | null; nextPantryId: string | null; dataRevision: string };
export type PantryResult = { ingredients: IngredientView[]; items: PantryItemView[]; removedItemIds: string[]; removedIngredientIds?: string[]; dataRevision: string };

/** Bounded catalog projection. Joins are owner-scoped; history is checked, never loaded. */
async function snapshotIngredients(tx: Tx, userId: string, afterId: string | null, listedOnly: boolean): Promise<IngredientView[]> {
  return tx.$queryRaw<IngredientView[]>(Prisma.sql`
    SELECT i.id, i.name, i."normalizedName", i.unit, i.scope, i.revision,
      COALESCE(p."trackingMode", 'quantity') AS "trackingMode", CASE WHEN p."trackingMode" = 'availability' THEN COALESCE(b.available, false) ELSE COALESCE(b.quantity > 0, false) END AS available,
      COALESCE(p.hidden, false) AS hidden, p.revision AS "preferenceRevision",
      (i.scope = 'global' OR COALESCE(b.quantity <> 0, false)
        OR EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m."userId" = ${userId}::uuid AND m."ingredientId" = i.id)
        OR EXISTS (SELECT 1 FROM public.recipe_steps s WHERE s."userId" = ${userId}::uuid AND s."ingredientId" = i.id)
        OR EXISTS (SELECT 1 FROM public.shopping_entries e WHERE e."userId" = ${userId}::uuid AND e."ingredientId" = i.id)) AS "unitLocked",
      b.revision AS "balanceRevision", COALESCE(b.quantity, 0)::text AS quantity, COALESCE(b.listed, false) AS listed
    FROM public.ingredients i
    LEFT JOIN public.ingredient_preferences p ON p."ingredientId" = i.id AND p."userId" = ${userId}::uuid
    LEFT JOIN public.pantry_balances b ON b."ingredientId" = i.id AND b."userId" = ${userId}::uuid
    WHERE i."retiredAt" IS NULL AND (i.scope = 'global' OR i."ownerUserId" = ${userId}::uuid)
      AND COALESCE(p."retiredForUser", false) = false
      ${afterId ? Prisma.sql`AND i.id > ${afterId}::uuid` : Prisma.empty}
      ${listedOnly ? Prisma.sql`AND b.listed = true` : Prisma.empty}
    ORDER BY i.id ASC LIMIT 101
  `).then(rows => rows.map(row => ({ ...row, quantity: new Prisma.Decimal(row.quantity).toString() })));
}

export class PantryService {
  private readonly db: PrismaClient;
  constructor(db: PrismaClient) { this.db = db; }
  async impact(owner: string, ingredientId: string) {
    const userId = uuid(owner), id = uuid(ingredientId);
    return this.db.$transaction(async tx => impactView(await ingredientImpact(tx, userId, id)), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }
  async removed(owner: string, after?: string) {
    const userId = uuid(owner), afterId = after ? uuid(after) : null;
    const rows = await this.db.ingredient.findMany({ where: { retiredAt: null, OR: [{ scope: "global" }, { ownerUserId: userId }],
      preferences: { some: { userId, retiredForUser: true, replacementId: null } }, ...(afterId ? { id: { gt: afterId } } : {}) }, orderBy: { id: "asc" }, take: 101, include: ingredientInclude(userId) });
    return { items: rows.slice(0, 100).map(ingredientView), nextId: rows.length > 100 ? rows[99].id : null };
  }
  async snapshot(authenticatedOwner: string, options: { catalogAfterId?: string; pantryAfterId?: string } = {}): Promise<PantrySnapshot> {
    const userId = uuid(authenticatedOwner), catalogAfterId = options.catalogAfterId ? uuid(options.catalogAfterId) : null,
      pantryAfterId = options.pantryAfterId ? uuid(options.pantryAfterId) : null;
    if (catalogAfterId && pantryAfterId) invalid("Carga una lista a la vez.");
    return this.db.$transaction(async tx => {
      const owner = await tx.user.findUnique({ where: { id: userId }, select: { dataRevision: true } });
      if (!owner) throw new CoreError("UNAUTHENTICATED", "Inicia sesión para continuar.");
      const catalog = pantryAfterId ? [] : await snapshotIngredients(tx, userId, catalogAfterId, false);
      const balances = catalogAfterId ? [] : await snapshotIngredients(tx, userId, pantryAfterId, true);
      return { ingredients: catalog.slice(0, 100), items: balances.slice(0, 100).map(ingredient => ({ ingredient, quantity: ingredient.quantity, revision: ingredient.balanceRevision! })),
        nextCatalogId: catalog.length > 100 ? catalog[99].id : null, nextPantryId: balances.length > 100 ? balances[99].id : null, dataRevision: owner.dataRevision.toString() };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }
  async history(authenticatedOwner: string, ingredientId: string) {
    const userId = uuid(authenticatedOwner), id = uuid(ingredientId);
    return this.db.$transaction(async tx => {
      if (!await tx.ingredient.findFirst({ where: { id, ...accessible(userId) }, select: { id: true } })) throw new CoreError("NOT_FOUND", "Ingrediente no disponible.");
      const rows = await tx.inventoryMovement.findMany({ where: { userId, ingredientId: id }, orderBy: [{ operation: { createdAt: "desc" } }, { id: "desc" }], take: 20, include: { operation: { select: { createdAt: true, kind: true } } } });
      return { items: rows.map(item => ({ id: item.id, delta: item.delta.toString(), unit: item.unit, at: item.operation.createdAt.toISOString(), kind: item.operation.kind })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }
  async execute(authenticatedOwner: string, raw: unknown) {
    const command = parsePantryCommand(raw);
    return executeOwnerCommand(this.db, authenticatedOwner, command, async (tx, userId): Promise<PantryResult> => {
      if (command.action === "retireIngredient") {
        const targetId = await retireIngredient(tx, userId, command);
        const target = targetId ? await tx.ingredient.findFirstOrThrow({ where: { id: targetId, ...accessible(userId) }, include: ingredientInclude(userId) }) : null;
        const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
        const item = target ? ingredientView(target) : null, balance = target?.pantry[0];
        return { ingredients: item ? [item] : [], items: item && balance?.listed ? [{ ingredient: item, quantity: balance.quantity.toString(), revision: balance.revision }] : [],
          removedItemIds: [command.id], removedIngredientIds: [command.id], dataRevision: owner.dataRevision.toString() };
      }
      let row = await tx.ingredient.findFirst({ where: { id: command.id, ...(command.action === "setIngredientHidden" && !command.hidden
        ? { retiredAt: null, OR: [{ scope: "global" as const }, { ownerUserId: userId }] } : accessible(userId)) }, include: ingredientInclude(userId) });
      if (command.action === "createIngredient" || command.action === "editIngredient") {
        if (command.action === "editIngredient") {
          if (!row || row.scope !== "private" || row.ownerUserId !== userId) throw new CoreError("DEPENDENCY", "Solo puedes editar tus ingredientes personalizados.");
          if (row.revision !== command.expectedRevision) throw new CoreError("CONFLICT", "El ingrediente cambió. Vuelve a abrir el editor.");
          if (row.unit !== command.unit && ingredientView(row).unitLocked) throw new CoreError("DEPENDENCY", "La unidad no puede cambiar después de usar el ingrediente en recetas, compras, existencias o movimientos.");
        }
        const normalizedName = normalizedIngredientName(command.name);
        const candidates = await tx.ingredient.findMany({ where: { retiredAt: null, OR: [{ scope: "global" }, { ownerUserId: userId }], id: { not: command.id } }, select: { id: true, name: true, normalizedName: true, preferences: { where: { userId } } } });
        const exact = candidates.find(item => item.normalizedName === normalizedName);
        if (exact) {
          const preference = exact.preferences[0];
          if (preference?.retiredForUser) throw new CoreError("CONFLICT", preference.replacementId ? `«${exact.name}» ya fue reemplazado. Usa su sustituto del catálogo.` : `«${exact.name}» ya existe. Recupéralo desde Ingredientes eliminados en Alacena.`);
          throw new CoreError("CONFLICT", `Ya existe «${exact.name}». Selecciónalo en el catálogo; también puedes recuperar las sugerencias ocultas.`);
        }
        const similar = candidates.find(item => !item.preferences[0]?.retiredForUser && similarIngredientName(item.normalizedName, normalizedName));
        if (similar && !command.confirmSimilar) throw new CoreError("DEPENDENCY", `Existe «${similar.name}», que tiene un nombre parecido. Selecciónalo o confirma que el nuevo es distinto.`);
        if (command.action === "createIngredient") await tx.ingredient.create({ data: { id: command.id, scope: "private", ownerUserId: userId, name: command.name, normalizedName, unit: command.unit } });
        else await tx.ingredient.update({ where: { id: command.id }, data: { name: command.name, normalizedName, unit: command.unit } });
        if (command.action === "createIngredient" && command.trackingMode === "availability") await tx.ingredientPreference.create({ data: { userId, ingredientId: command.id, trackingMode: "availability" } });
      } else {
        if (!row) throw new CoreError("NOT_FOUND", "El ingrediente no está disponible.");
        if (command.action === "setIngredientTracking") {
          if (row.revision !== command.expectedIngredientRevision || (row.preferences[0]?.revision ?? null) !== command.expectedPreferenceRevision || (row.pantry[0]?.revision ?? null) !== command.expectedBalanceRevision) throw new CoreError("CONFLICT", "El seguimiento cambió. Actualiza Alacena antes de guardar.");
          const balance = row.pantry[0];
          if (command.mode === "quantity") {
            const delta = quantityThousandths(command.quantity!) - quantityThousandths(balance?.quantity.toString() ?? "0");
            if (delta !== BigInt(0)) {
              await tx.inventoryOperation.create({ data: { id: command.commandId, userId, commandId: command.commandId, kind: "adjustment", sourceKey: row.id, sourceRevision: balance?.revision ?? 0 } });
              await tx.inventoryMovement.create({ data: { id: randomUUID(), userId, operationId: command.commandId, ingredientId: row.id, delta: quantityString(delta), unit: row.unit } });
            }
          }
          await tx.ingredientPreference.upsert({ where: { userId_ingredientId: { userId, ingredientId: row.id } }, create: { userId, ingredientId: row.id, trackingMode: command.mode }, update: { trackingMode: command.mode } });
          await tx.pantryBalance.upsert({ where: { userId_ingredientId: { userId, ingredientId: row.id } }, create: { userId, ingredientId: row.id, quantity: "0", available: command.available, listed: command.listed }, update: { available: command.available, listed: command.listed, availabilityReceiptId: null } });
        } else if (command.action === "setIngredientHidden") {
          const preference = row.preferences[0];
          if ((preference?.revision ?? null) !== command.expectedPreferenceRevision) throw new CoreError("CONFLICT", "La sugerencia cambió en otra pestaña. Actualiza antes de guardar.");
          if (preference?.retiredForUser && preference.replacementId) throw new CoreError("DEPENDENCY", "Este ingrediente se unificó con otro. Usa el sustituto para mantener el historial relacionado.");
          if (!preference || preference.hidden !== command.hidden || preference.retiredForUser) await tx.ingredientPreference.upsert({ where: { userId_ingredientId: { userId, ingredientId: row.id } }, create: { userId, ingredientId: row.id, hidden: command.hidden }, update: { hidden: command.hidden, ...(!command.hidden ? { retiredForUser: false } : {}) } });
        } else {
          if (row.revision !== command.expectedIngredientRevision) throw new CoreError("CONFLICT", "El ingrediente cambió. Actualiza Alacena.");
          if (row.preferences[0]?.trackingMode === "availability") throw new CoreError("DEPENDENCY", "Este ingrediente usa Tengo / Se terminó. Cambia su seguimiento para registrar cantidades.");
          const balance = row.pantry[0];
          if ((balance?.revision ?? null) !== command.expectedBalanceRevision) throw new CoreError("CONFLICT", "La cantidad cambió en otra pestaña. Actualiza para revisar la cantidad actual antes de guardar.");
          const delta = quantityThousandths(command.quantity) - quantityThousandths(balance?.quantity.toString() ?? "0");
          if (delta !== BigInt(0)) {
            const operation = await tx.inventoryOperation.create({ data: { id: command.commandId, userId, commandId: command.commandId, kind: "adjustment", sourceKey: row.id, sourceRevision: balance?.revision ?? 0 } });
            // The DB trigger atomically applies this immutable delta to the balance.
            await tx.inventoryMovement.create({ data: { id: randomUUID(), userId, operationId: operation.id, ingredientId: row.id, delta: quantityString(delta), unit: row.unit } });
          }
          const current = await tx.pantryBalance.findUnique({ where: { userId_ingredientId: { userId, ingredientId: row.id } } });
          if (!current) await tx.pantryBalance.create({ data: { userId, ingredientId: row.id, quantity: "0", listed: command.listed } });
          else if (current.listed !== command.listed) await tx.pantryBalance.update({ where: { userId_ingredientId: { userId, ingredientId: row.id } }, data: { listed: command.listed } });
        }
      }
      row = await tx.ingredient.findFirstOrThrow({ where: { id: command.id, ...accessible(userId) }, include: ingredientInclude(userId) });
      const item = ingredientView(row), balance = row.pantry[0];
      const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
      return { ingredients: [item], items: balance?.listed ? [{ ingredient: item, quantity: balance.quantity.toString(), revision: balance.revision }] : [], removedItemIds: balance?.listed ? [] : [item.id], dataRevision: owner.dataRevision.toString() };
    });
  }
}
