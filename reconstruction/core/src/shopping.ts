import { mealQuantities } from "./meal-amounts.ts";
import { inventoryIngredientSteps } from "./meal-amounts-server.ts";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/client.ts";
import { uuid } from "./contracts.ts";
import { CoreError, invalid } from "./errors.ts";
import { quantityString, quantityThousandths, type IngredientUnit } from "./ingredient-input.ts";
import { executeOwnerCommand } from "./owner-command.ts";
import { parseShoppingCommand } from "./shopping-input.ts";
import { ingredientTracking } from "./ingredient-tracking.ts";
import { reversalIngredient, selectableIngredient, transferStock } from "./ingredient-retirement.ts";
type Tx = Prisma.TransactionClient;
export type ShoppingItem = { key: string; id: string | null; ingredientId: string | null; name: string; unit: string; free: boolean; required: string; optional: string; quantity: string; edited: boolean; availabilityOnly: boolean; optionalOnly: boolean };
async function currentItems(tx: Tx, userId: string): Promise<ShoppingItem[]> {
  const plans = await tx.mealBlock.findMany({ where: { userId, cookingEnabled: true, activity: { is: { lifecycle: "active", completedAt: null } }, cell: { isNot: null } }, select: { recipes: { select: { cookedServings: true, ingredientQuantities:true, recipeRevision: { select: { baseServings: true, steps: { select: { stepKey:true, ingredientId: true, ingredientNameSnapshot: true, unitSnapshot: true, quantityForBaseServings: true, optional: true } } } } } } } });
  const balances = await tx.pantryBalance.findMany({ where: { userId, quantity: { gt: 0 } }, select: { ingredientId: true, quantity: true } });
  const entries = await tx.shoppingEntry.findMany({ where: { userId, retiredAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const tracking = await ingredientTracking(tx,userId);
  const trackingById = new Map(tracking.map(row => [row.ingredientId, row]));
  const presence = new Map<string,{name:string;unit:string;optionalOnly:boolean}>();
  const stocks = new Map(balances.map(row => [row.ingredientId, row.quantity.toString()]));
  const overrides = new Map(entries.filter(row => !row.free).map(row => [row.ingredientId, row]));
  const totals = new Map<string, { name: string; unit: string; required: bigint; optional: bigint }>();
  for (const plan of plans) {
    const grouped = new Map<string, { name: string; unit: string; required: Prisma.Decimal; optional: Prisma.Decimal }>();
    for (const dish of plan.recipes) if (dish.cookedServings.gt(0)) for (const step of inventoryIngredientSteps(dish.recipeRevision.steps.map(step=>({ingredientId:step.ingredientId,ingredientName:step.ingredientNameSnapshot,unit:step.unitSnapshot,quantity:step.quantityForBaseServings?.toString()??null,optional:step.optional,stepKey:step.stepKey})),dish.recipeRevision.baseServings!.toString(),dish.cookedServings.toString(),mealQuantities(dish.ingredientQuantities))) if (step.ingredientId) {
      if(trackingById.get(step.ingredientId)?.mode==="availability" || !step.quantity){
        const old=presence.get(step.ingredientId);presence.set(step.ingredientId,{name:step.ingredientName!,unit:step.unit!,optionalOnly:(old?.optionalOnly??true)&&step.optional});continue;
      }
      const sum = grouped.get(step.ingredientId) ?? { name: step.ingredientName!, unit: step.unit!, required: new Prisma.Decimal(0), optional: new Prisma.Decimal(0) };
      const key = step.optional ? "optional" : "required";
      sum[key] = sum[key].add(new Prisma.Decimal(step.quantity)); grouped.set(step.ingredientId, sum);
    }
    // Round once per block/ingredient, matching actual consumption. Mandatory amounts take stock first.
    for (const [id, group] of grouped) {
      const required = quantityThousandths(group.required.toDecimalPlaces(3, Prisma.Decimal.ROUND_CEIL).toString());
      const total = quantityThousandths(group.required.add(group.optional).toDecimalPlaces(3, Prisma.Decimal.ROUND_CEIL).toString());
      const sum = totals.get(id) ?? { name: group.name, unit: group.unit, required: BigInt(0), optional: BigInt(0) };
      sum.required += required; sum.optional += total - required; totals.set(id, sum);
    }
  }
  const items: ShoppingItem[] = [];
  for (const [id, total] of totals) {
    const stock = quantityThousandths(stocks.get(id) ?? "0");
    const required = total.required > stock ? total.required - stock : BigInt(0);
    const remaining = stock > total.required ? stock - total.required : BigInt(0);
    const optional = total.optional > remaining ? total.optional - remaining : BigInt(0);
    if (required + optional === BigInt(0)) continue;
    if (required + optional > BigInt("999999999999")) invalid("Los faltantes superan la cantidad máxima. Divide tus planes.");
    const entry = overrides.get(id);
    items.push({ key: `i:${id}`, id: entry?.id ?? null, ingredientId: id, name: total.name, unit: total.unit, free: false, required: quantityString(required), optional: quantityString(optional), quantity: entry?.quantity?.toString() ?? quantityString(required + optional), availabilityOnly:false, optionalOnly:required===BigInt(0), edited: entry?.quantity !== null && entry?.quantity !== undefined });
  }
  for(const [id,row] of presence)if(!trackingById.get(id)?.available&&!items.some(item=>item.ingredientId===id)&&!entries.some(entry=>entry.free&&!entry.closedAt&&entry.ingredientId===id)){
    const entry=overrides.get(id), availabilityOnly=trackingById.get(id)?.mode==="availability";
    items.push({key:`i:${id}`,id:entry?.id??null,ingredientId:id,name:row.name,unit:row.unit,free:false,required:"0",optional:"0",quantity:availabilityOnly?"0":entry?.quantity?.toString()??"",edited:!availabilityOnly&&entry?.quantity!=null,availabilityOnly,optionalOnly:row.optionalOnly});
  }
  items.sort((a, b) => a.name.localeCompare(b.name, "es"));
  for (const entry of entries) if (entry.free && !entry.closedAt) items.push({ key: `e:${entry.id}`, id: entry.id, ingredientId: entry.ingredientId, name: entry.name, unit: entry.unit, free: true, required: "0", optional: "0", quantity:tracking.find(row=>row.ingredientId===entry.ingredientId)?.mode==="availability"?"0":entry.quantity!.toString(), availabilityOnly:tracking.find(row=>row.ingredientId===entry.ingredientId)?.mode==="availability",optionalOnly:false, edited: true });
  return items;
}
export class ShoppingService {
  constructor(private readonly db: PrismaClient) {}
  async snapshot(owner: string, after?: string) {
    const userId = uuid(owner), afterId = after ? uuid(after) : null;
    return this.db.$transaction(async tx => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true, timeZone: true } });
      const cursor = afterId ? await tx.shoppingReceipt.findFirst({ where: { id: afterId, userId }, select: { createdAt: true, id: true } }) : null;
      if (afterId && !cursor) invalid("Actualiza el historial de compras.");
      const rows = await tx.shoppingReceipt.findMany({ where: { userId, reversedAt: null, createdAt: { gte: new Date(Date.now() - 30 * 86400000) }, ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 51 });
      return { dataRevision: user.dataRevision.toString(), timeZone: user.timeZone, items: await currentItems(tx, userId), purchased: rows.slice(0, 50).map(row => ({ id: row.id, name: row.name, unit: row.unit, availabilityOnly:row.availabilityOnly, quantity: row.quantity.toString(), required: row.requiredQuantity.toString(), optional: row.optionalQuantity.toString(), createdAt: row.createdAt.toISOString() })), nextPurchaseId: rows.length > 50 ? rows[49].id : null };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 10000, timeout: 15000 });
  }
  async execute(owner: string, raw: unknown) {
    const command = parseShoppingCommand(raw);
    return executeOwnerCommand(this.db, owner, command, async (tx, userId) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
      if (user.dataRevision.toString() !== command.expectedDataRevision) throw new CoreError("CONFLICT", "Cambió la lista o Alacena. Actualiza Compras y revisa las cantidades antes de continuar.");
      if (command.action === "addShoppingEntry") {
        const ingredient = command.ingredientId ? await tx.ingredient.findFirst({ where: { id: command.ingredientId, ...selectableIngredient(userId) } }) : null;
        if (command.ingredientId && (!ingredient || ingredient.revision !== command.expectedIngredientRevision)) throw new CoreError("CONFLICT", "El ingrediente cambió. Actualiza su catálogo.");
        if(ingredient){const preference=await tx.ingredientPreference.findUnique({where:{userId_ingredientId:{userId,ingredientId:ingredient.id}}});if(preference?.trackingMode==="availability"&&await tx.shoppingEntry.findFirst({where:{userId,ingredientId:ingredient.id,free:true,closedAt:null,retiredAt:null}}))invalid("Este ingrediente ya está pendiente en Compras.");}
        await tx.shoppingEntry.create({ data: { id: command.id, userId, ingredientId: ingredient?.id ?? null, name: ingredient?.name ?? command.name, unit: ingredient?.unit ?? command.unit, free: true, quantity: command.quantity } });
      } else if (command.action === "removeShoppingEntry") {
        const entry = await tx.shoppingEntry.findFirst({ where: { id: command.id, userId, free: true, retiredAt: null, closedAt: null } });
        if (!entry) throw new CoreError("NOT_FOUND", "El artículo ya no está pendiente.");
        await tx.shoppingEntry.update({ where: { id: entry.id }, data: { retiredAt: new Date() } });
      } else if (command.action === "undoShoppingPurchase") {
        const receipt = await tx.shoppingReceipt.findFirst({ where: { id: command.id, userId }, include: { entry: true, operation: { include: { movements: true } } } });
        if (!receipt) throw new CoreError("NOT_FOUND", "La compra ya no está disponible.");
        if (!receipt.reversedAt) {
          if(receipt.availabilityOnly){
            const ingredientId=receipt.entry.ingredientId!;
            const balance=await tx.pantryBalance.findUnique({where:{userId_ingredientId:{userId,ingredientId}}});
            const preference=await tx.ingredientPreference.findUnique({where:{userId_ingredientId:{userId,ingredientId}}});
            if(preference?.trackingMode!=="availability"||balance?.availabilityReceiptId!==receipt.id)throw new CoreError("DEPENDENCY", "La disponibilidad cambió después de esta compra. Deshaz primero las compras posteriores; si la cambiaste manualmente, corrígela desde Alacena.");
            await tx.pantryBalance.update({where:{userId_ingredientId:{userId,ingredientId}},data:{available:receipt.previousAvailable!,availabilityReceiptId:receipt.previousAvailabilityReceiptId}});
          }
          for (const movement of receipt.operation.movements) {
            const targetId = await reversalIngredient(tx, userId, movement.ingredientId);
            const stock = await tx.pantryBalance.findUnique({ where: { userId_ingredientId: { userId, ingredientId: movement.ingredientId } } });
            const ownQuantity = stock?.quantity ?? new Prisma.Decimal(0);
            if (ownQuantity.lt(movement.delta)) {
              const shortage = movement.delta.sub(ownQuantity);
              if (targetId === movement.ingredientId) throw new CoreError("DEPENDENCY", `No puedes deshacer «${receipt.name}»: parte de esa cantidad ya no está en Alacena.`);
              await transferStock(tx, userId, command.commandId, targetId, movement.ingredientId, shortage);
            }
          }
          const now = new Date(), operationId = randomUUID();
          await tx.inventoryOperation.create({ data: { id: operationId, userId, kind: "reversal", commandId: command.commandId, sourceKey: receipt.id, sourceRevision: receipt.entry.revision, reversalOfId: receipt.operationId } });
          if (receipt.operation.movements.length) await tx.inventoryMovement.createMany({ data: receipt.operation.movements.map(movement => ({ id: randomUUID(), userId, operationId, ingredientId: movement.ingredientId, unit: movement.unit, delta: movement.delta.neg().toString() })) });
          await tx.shoppingReceipt.update({ where: { id: receipt.id }, data: { reversedAt: now } });
          if (!receipt.entry.retiredAt) await tx.shoppingEntry.update({ where: { id: receipt.entryId }, data: { closedAt: null, ...(receipt.entry.free || receipt.entry.quantity === null ? { quantity: receipt.availabilityOnly ? receipt.entry.quantity : receipt.quantity } : {}) } });
        }
      } else {
        const items = await currentItems(tx, userId);
        if (command.action === "saveShoppingQuantity") {
          const item = items.find(row => row.key === command.key); if (!item) throw new CoreError("CONFLICT", "Este artículo ya no está en la lista actual.");
          if(item.availabilityOnly)invalid("Este ingrediente se lleva por disponibilidad, sin cantidad calculada.");
          if (item.free && (command.quantity === null || command.quantity === "0")) invalid("El artículo libre necesita una cantidad positiva.");
          if (item.id) await tx.shoppingEntry.update({ where: { id: item.id }, data: { quantity: command.quantity } });
          else await tx.shoppingEntry.create({ data: { userId, ingredientId: item.ingredientId, name: item.name, unit: item.unit, quantity: command.quantity } });
        } else {
          const selected = command.items.map(row => { const item = items.find(item => item.key === row.key); if (!item) throw new CoreError("CONFLICT", "Un artículo cambió. Revisa la lista antes de comprar."); if(!item.availabilityOnly&&row.quantity==="0")invalid("Compra una cantidad mayor que cero.");return { ...item, quantity: item.availabilityOnly?"0":row.quantity, entryId: item.id ?? randomUUID(), receiptId: randomUUID(), operationId: randomUUID() }; });
          const additions = new Map<string, Prisma.Decimal>();
          for (const item of selected) if (item.ingredientId && !item.availabilityOnly) additions.set(item.ingredientId, (additions.get(item.ingredientId) ?? new Prisma.Decimal(0)).add(item.quantity));
          const balances = await tx.pantryBalance.findMany({ where: { userId, ingredientId: { in: [...additions.keys()] } } });
          const ingredients = await tx.ingredient.findMany({ where: { id: { in: [...additions.keys()] }, ...selectableIngredient(userId) } });
          for (const [id, quantity] of additions) {
            if (!ingredients.some(row => row.id === id)) throw new CoreError("DEPENDENCY", "Un ingrediente está retirado. Edita la comida pendiente para actualizar su receta antes de comprarlo.");
            if (quantity.add(balances.find(row => row.ingredientId === id)?.quantity ?? 0).gt("999999999.999")) invalid("La compra excedería la cantidad máxima de Alacena.");
          }
          const missingEntries = selected.filter(item => !item.id);
          if (missingEntries.length) await tx.shoppingEntry.createMany({ data: missingEntries.map(item => ({ id: item.entryId, userId, ingredientId: item.ingredientId, name: item.name, unit: item.unit, free: false })) });
          await tx.inventoryOperation.createMany({ data: selected.map(item => ({ id: item.operationId, userId, kind: "purchase", commandId: command.commandId, sourceKey: item.receiptId, sourceRevision: 0 })) });
          const numericReceipts = selected.filter(item => !item.availabilityOnly);
          if (numericReceipts.length) await tx.shoppingReceipt.createMany({ data: numericReceipts.map(item => ({ id:item.receiptId,userId,entryId:item.entryId,operationId:item.operationId,name:item.name,unit:item.unit,quantity:item.quantity,requiredQuantity:item.required,optionalQuantity:item.optional })) });
          for(const item of selected.filter(item => item.availabilityOnly)){
            const before=item.availabilityOnly?await tx.pantryBalance.findUnique({where:{userId_ingredientId:{userId,ingredientId:item.ingredientId!}}}):null;
            await tx.shoppingReceipt.create({data:{id:item.receiptId,userId,entryId:item.entryId,operationId:item.operationId,name:item.name,unit:item.unit,quantity:item.quantity,requiredQuantity:item.required,optionalQuantity:item.optional,availabilityOnly:item.availabilityOnly,previousAvailable:item.availabilityOnly?before?.available??false:null,previousAvailabilityReceiptId:item.availabilityOnly?before?.availabilityReceiptId??null:null}});
            if(item.availabilityOnly){
              if(!await tx.ingredient.findFirst({where:{id:item.ingredientId!,...selectableIngredient(userId)}}))throw new CoreError("DEPENDENCY","El ingrediente está retirado. Actualiza su receta antes de comprar.");
              await tx.pantryBalance.upsert({where:{userId_ingredientId:{userId,ingredientId:item.ingredientId!}},create:{userId,ingredientId:item.ingredientId!,quantity:"0",available:true,listed:true,availabilityReceiptId:item.receiptId},update:{available:true,listed:true,availabilityReceiptId:item.receiptId}});
            }
          }
          const movements = selected.filter(item => item.ingredientId && !item.availabilityOnly).map(item => ({ id: randomUUID(), userId, operationId: item.operationId, ingredientId: item.ingredientId!, unit: ingredients.find(row => row.id === item.ingredientId)!.unit as IngredientUnit, delta: item.quantity }));
          if (movements.length) await tx.inventoryMovement.createMany({ data: movements });
          if (additions.size) await tx.pantryBalance.updateMany({ where: { userId, ingredientId: { in: [...additions.keys()] }, listed: false }, data: { listed: true } });
          await tx.shoppingEntry.updateMany({ where: { userId, id: { in: selected.filter(item => item.free).map(item => item.entryId) } }, data: { closedAt: new Date() } });
          await tx.shoppingEntry.updateMany({ where: { userId, id: { in: selected.filter(item => !item.free).map(item => item.entryId) } }, data: { quantity: null } });
        }
      }
      const current = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
      return { changed: true, dataRevision: current.dataRevision.toString() };
    });
  }
}
export type ShoppingSnapshot = Awaited<ReturnType<ShoppingService["snapshot"]>>;
