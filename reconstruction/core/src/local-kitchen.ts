import { type PrismaClient, type Prisma } from "../generated/client.ts";
import { PantryService } from "./pantry.ts";
import { RecipeService } from "./recipes.ts";
import { ShoppingService } from "./shopping.ts";
import { PlannerService } from "./planner.ts";
import { ActivityService } from "./service.ts";
import { executeOwnerCommand } from "./owner-command.ts";
import { CoreError } from "./errors.ts";
import { parseKitchenBatch, localReceiptId, type KitchenLedger, type KitchenCommand } from "./local-kitchen-contract.ts";

type Tx = Prisma.TransactionClient;
/** Reuse the existing module rules inside ONE already-open transaction and owner lock. */
function transactionClient(tx:Tx):PrismaClient {
  return new Proxy(tx, {get(target,key) {
    if(key === "$transaction") return (work:(inner:Tx)=>Promise<unknown>)=>work(tx);
    const value=Reflect.get(target,key); return typeof value === "function" ? value.bind(target) : value;
  }}) as PrismaClient;
}
function bounded<T>(items:T[]) { if(items.length>5000) throw new CoreError("DEPENDENCY","El historial necesario supera el límite de la copia local. Conservamos la copia anterior."); return items; }
export async function kitchenLedger(tx:Tx,userId:string):Promise<KitchenLedger> {
  const completions=bounded(await tx.mealCompletion.findMany({where:{userId,reversedAt:null},take:5001,include:{operation:{include:{movements:true}},uses:{where:{reversedAt:null}}}}));
  const batches=bounded(await tx.cookedBatch.findMany({where:{userId,revokedAt:null},take:5001,include:{completion:{include:{block:{include:{activity:true}}}},recipeRevision:{select:{recipeId:true,name:true,version:true}}},orderBy:[{createdAt:"asc"},{id:"asc"}]}));
  const steps=bounded(await tx.mealStepData.findMany({where:{userId,activity:{is:{lifecycle:"active"}}},take:5001,select:{activityId:true,mealRecipeId:true,sourceStepKey:true,role:true,mealRecipe:{select:{blockId:true}}}}));
  const entries=bounded(await tx.shoppingEntry.findMany({where:{userId,OR:[{retiredAt:null},{receipts:{some:{reversedAt:null,createdAt:{gte:new Date(Date.now()-30*86400000)}}}}]},take:5001}));
  const purchases=bounded(await tx.shoppingReceipt.findMany({where:{userId,reversedAt:null,createdAt:{gte:new Date(Date.now()-30*86400000)}},take:5001,include:{entry:{select:{ingredientId:true}}}}));
  const balances=await tx.pantryBalance.findMany({where:{userId,availabilityReceiptId:{not:null}},select:{ingredientId:true,availabilityReceiptId:true}});
  return {
    steps:steps.map(s=>({id:s.activityId,mealId:s.mealRecipe.blockId,dishId:s.mealRecipeId,stepKey:s.sourceStepKey,role:s.role})),
    completions:completions.map(c=>({id:c.id,mealId:c.blockId,amounts:c.operation.movements.map(m=>({ingredientId:m.ingredientId,quantity:m.delta.neg().toString()})),uses:c.uses.map(u=>({batchId:u.batchId,quantity:u.quantity.toString()}))})),
    batches:batches.map(b=>({id:b.id,completionId:b.completionId,mealId:b.completion.blockId,title:b.completion.block.activity.title,recipeId:b.recipeRevision.recipeId,recipeName:b.recipeRevision.name,version:b.recipeRevision.version,createdAt:b.createdAt.toISOString(),quantity:b.quantity.toString()})),
    entries:entries.map(e=>({id:e.id,ingredientId:e.ingredientId,name:e.name,unit:e.unit,free:e.free,quantity:e.quantity?.toString()??null,closed:!!e.closedAt,retired:!!e.retiredAt})),
    purchases:purchases.map(p=>({id:p.id,entryId:p.entryId,ingredientId:p.entry.ingredientId,quantity:p.quantity.toString(),availabilityOnly:p.availabilityOnly,previousAvailable:p.previousAvailable,previousReceiptId:p.previousAvailabilityReceiptId})),
    availabilityReceipts:Object.fromEntries(balances.map(b=>[b.ingredientId,b.availabilityReceiptId])),
  };
}
export async function kitchenSnapshot(tx:Tx,userId:string,start:string) {
  const db=transactionClient(tx), pantry=new PantryService(db),recipes=new RecipeService(db),shopping=new ShoppingService(db);
  const stock=await pantry.snapshot(userId);
  while(stock.nextCatalogId){const next=await pantry.snapshot(userId,{catalogAfterId:stock.nextCatalogId});stock.ingredients.push(...next.ingredients);stock.nextCatalogId=next.nextCatalogId;bounded(stock.ingredients);}
  while(stock.nextPantryId){const next=await pantry.snapshot(userId,{pantryAfterId:stock.nextPantryId});stock.items.push(...next.items);stock.nextPantryId=next.nextPantryId;bounded(stock.items);}
  const definitions=await recipes.snapshot(userId);
  while(definitions.nextId){const next=await recipes.snapshot(userId,definitions.nextId);definitions.items.push(...next.items);definitions.nextId=next.nextId;bounded(definitions.items);}
  const purchases=await shopping.snapshot(userId);
  while(purchases.nextPurchaseId){const next=await shopping.snapshot(userId,purchases.nextPurchaseId);purchases.purchased.push(...next.purchased);purchases.nextPurchaseId=next.nextPurchaseId;bounded(purchases.purchased);}
  const planner=await new PlannerService(db).snapshot(userId,start,42,true);
  const ledger=await kitchenLedger(tx,userId);
  return {pantry:stock,recipes:definitions,shopping:purchases,planners:[planner],kitchenLedger:ledger,dataRevision:stock.dataRevision};
}
export type KitchenSnapshot = Awaited<ReturnType<typeof kitchenSnapshot>>;
export class KitchenConflict extends CoreError {
  constructor(readonly snapshot:KitchenSnapshot,readonly operationId:string, message="Hubo cambios en otro dispositivo. Revisa antes de enviar los cambios de Cocina.") {super("CONFLICT",message);}
}
/** Full revision fence is conservative: no manual correction can overwrite unseen stock. */
export async function executeKitchenBatch(db:PrismaClient,owner:string,raw:unknown) {
  const batch=parseKitchenBatch(raw);
  return executeOwnerCommand(db,owner,batch,async(tx,userId)=>{
    const before=await tx.user.findUniqueOrThrow({where:{id:userId},select:{dataRevision:true}});
    if(before.dataRevision.toString()!==batch.expectedDataRevision) throw new KitchenConflict(await kitchenSnapshot(tx,userId,batch.start),batch.operations[0].command.commandId);
    const inner=transactionClient(tx),receiptIds={...batch.receiptIds};
    for(const op of batch.operations){
      let command:KitchenCommand=structuredClone(op.command);
      const current=await tx.user.findUniqueOrThrow({where:{id:userId},select:{dataRevision:true}});
      if("expectedDataRevision" in command) command={...command,expectedDataRevision:current.dataRevision.toString()};
      if(["createIngredient","setIngredientHidden","setPantryQuantity","setIngredientTracking"].includes(command.action)){
        if(command.action!=="createIngredient" && "id" in command){
          const item=await tx.ingredient.findUnique({where:{id:command.id}}),balance=await tx.pantryBalance.findUnique({where:{userId_ingredientId:{userId,ingredientId:command.id}}}),pref=await tx.ingredientPreference.findUnique({where:{userId_ingredientId:{userId,ingredientId:command.id}}});
          if(command.action==="setIngredientTracking" && command.mode!==(pref?.trackingMode??"quantity")) throw new CoreError("DEPENDENCY","Cambiar el seguimiento de un ingrediente necesita conexión directa.");
          if("expectedBalanceRevision" in command) command={...command,expectedBalanceRevision:balance?.revision??null,expectedIngredientRevision:item?.revision??0};
          if("expectedPreferenceRevision" in command) command={...command,expectedPreferenceRevision:pref?.revision??null};
        }
        await new PantryService(inner).execute(userId,command);
      }else if(["createRecipe","editRecipe","retireRecipe"].includes(command.action)){
        if("recipe" in command){
          const recipe=await tx.recipe.findFirst({where:{userId,id:command.id,retiredAt:null}});
          command={...command,expectedRevision:command.action==="createRecipe"?null:recipe?.revision??null};
          if(command.recipe)for(const step of command.recipe.steps)if(step.ingredientId){const ingredient=await tx.ingredient.findUnique({where:{id:step.ingredientId}});step.expectedIngredientRevision=ingredient?.revision??0;}
        }
        await new RecipeService(inner).execute(userId,command);
      }else if(command.action==="setCompleted"){
        const row=await tx.activity.findFirst({where:{userId,id:command.id,lifecycle:"active"},include:{mealStep:true}});
        if(!row || row.kind!=="meal"&&!row.mealStep) throw new CoreError("DEPENDENCY","Esta comida o preparación ya no está disponible.");
        await new ActivityService(inner).execute(userId,{...command,expectedRevision:row.revision},new Date(Math.min(Date.parse(op.at),Date.now())));
      }else{
        if(command.action==="undoShoppingPurchase")command={...command,id:receiptIds[command.id]??command.id};
        if(command.action==="addShoppingEntry" && command.ingredientId){const ingredient=await tx.ingredient.findUnique({where:{id:command.ingredientId}});command={...command,expectedIngredientRevision:ingredient?.revision??0};}
        await new ShoppingService(inner).execute(userId,command);
        if(command.action==="buyShoppingItems"){
          const receipts=await tx.shoppingReceipt.findMany({where:{userId,operation:{is:{commandId:command.commandId}}},include:{entry:true}});
          command.items.forEach((item,index)=>{const receipt=receipts.find(r=>item.key.startsWith("e:")?r.entryId===item.key.slice(2):!r.entry.free&&r.entry.ingredientId===item.key.slice(2));if(!receipt)throw new CoreError("DEPENDENCY","No pudimos identificar una compra confirmada.");receiptIds[localReceiptId(command.commandId,index)]=receipt.id;});
        }
      }
    }
    const final=await tx.user.findUniqueOrThrow({where:{id:userId},select:{dataRevision:true}});
    // Receipts store acknowledgements, never another permanent copy of the user's kitchen.
    return {dataRevision:final.dataRevision.toString(),receiptIds};
  }, 50000);
}
