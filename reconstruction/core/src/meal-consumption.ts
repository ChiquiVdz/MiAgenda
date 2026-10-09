import { mealQuantities } from "./meal-amounts.ts";
import { inventoryIngredientSteps } from "./meal-amounts-server.ts";
import { recipePriorGroups } from "./recipe-prior-groups.ts";
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/client.ts";
import { CoreError } from "./errors.ts";
import { quantityString, quantityThousandths } from "./ingredient-input.ts";
import { ingredientTracking } from "./ingredient-tracking.ts";
import { returnHistoricalStock, reversalIngredient } from "./ingredient-retirement.ts";
type Tx=Prisma.TransactionClient;
const ZERO=BigInt(0);
const include={activity:true,recipes:{orderBy:{position:"asc" as const},include:{recipeRevision:{include:{steps:true}},steps:{where:{role:"preparation" as const,activity:{is:{lifecycle:"active" as const}}},include:{activity:true}}}}} satisfies Prisma.MealBlockInclude;
/** Real operations use actual available stock, never provisional reservations. */
export async function completeMeal(tx:Tx,userId:string,blockId:string,commandId:string,optionalIds?:string[],actionTime?:Date){
  const meal=await tx.mealBlock.findFirstOrThrow({where:{activityId:blockId,userId},include});
  if(meal.activity.completedAt)return;
  const steps=meal.recipes.flatMap(r=>r.steps),optional=steps.filter(s=>s.optional);
  if(optionalIds===undefined&&optional.length)throw new CoreError("DEPENDENCY","Elige los pasos opcionales utilizados antes de completar esta comida.");
  const selected=new Set(optionalIds??[]);
  if([...selected].some(id=>!optional.some(s=>s.activityId===id)))throw new CoreError("INVALID_INPUT","Un opcional no pertenece a esta comida.");
  const tracking=await ingredientTracking(tx,userId);
  const trackingById=new Map(tracking.map(row=>[row.ingredientId,row]));
  const presence=new Map<string,string>();
  const totals=new Map<string,{quantity:Prisma.Decimal;unit:"g"|"ml"|"piece";name:string}>();
  if(meal.cookingEnabled)for(const dish of meal.recipes)if(dish.cookedServings.gt(0)){
    for(const step of inventoryIngredientSteps(dish.recipeRevision.steps.map(step=>({stepKey:step.stepKey,ingredientId:step.ingredientId,ingredientName:step.ingredientNameSnapshot,unit:step.unitSnapshot,quantity:step.quantityForBaseServings?.toString()??null,optional:step.optional})),dish.recipeRevision.baseServings!.toString(),dish.cookedServings.toString(),mealQuantities(dish.ingredientQuantities))){
      if(step.optional&&!dish.steps.some(s=>s.sourceStepKey===step.stepKey&&selected.has(s.activityId)))continue;
      if(!step.ingredientId||!step.unit)continue;
      if(trackingById.get(step.ingredientId)?.mode==="availability" || !step.quantity){presence.set(step.ingredientId,step.ingredientName??"Ingrediente");continue;}
      const quantity=new Prisma.Decimal(step.quantity),old=totals.get(step.ingredientId);
      totals.set(step.ingredientId,{quantity:(old?.quantity??new Prisma.Decimal(0)).add(quantity),unit:step.unit,name:step.ingredientName??"Ingrediente"});
    }
  }
  for(const [ingredientId,name] of presence)if(!trackingById.get(ingredientId)?.available)throw new CoreError("DEPENDENCY", `Falta ${name}. ${trackingById.get(ingredientId)?.mode==="availability"?"Márcalo como Tengo":"Registra sus existencias"} en Alacena o registra su compra.`);
  // Round the aggregate once per ingredient to stock precision, upward.
  const amounts=[...totals].map(([ingredientId,row])=>({ingredientId,...row,quantity:row.quantity.toDecimalPlaces(3,Prisma.Decimal.ROUND_CEIL)})).filter(r=>r.quantity.gt(0));
  const balances=await tx.pantryBalance.findMany({where:{userId,ingredientId:{in:amounts.map(r=>r.ingredientId)}}});
  for(const row of amounts){const stock=balances.find(b=>b.ingredientId===row.ingredientId)?.quantity??new Prisma.Decimal(0);if(row.quantity.gt(stock))throw new CoreError("DEPENDENCY",`Falta ${row.quantity.sub(stock).toString()} ${row.unit==="piece"?"piezas":row.unit} de ${row.name}. Ajusta Alacena o la comida antes de completar.`);}
  const now=actionTime??new Date(),completionId=randomUUID();
  const operation=await tx.inventoryOperation.create({data:{id:randomUUID(),userId,kind:"mealCompletion",commandId,sourceKey:completionId,sourceActivityId:blockId,sourceRevision:meal.activity.revision}});
  const completion=await tx.mealCompletion.create({data:{id:completionId,userId,blockId,operationId:operation.id,optionalSteps:[...selected],createdAt:now}});
  if(amounts.length)await tx.inventoryMovement.createMany({data:amounts.map(row=>({id:randomUUID(),userId,operationId:operation.id,ingredientId:row.ingredientId,delta:row.quantity.neg().toString(),unit:row.unit}))});
  const newBatches=meal.cookingEnabled?meal.recipes.filter(r=>r.cookedServings.gt(0)).map(r=>({id:randomUUID(),userId,completionId:completion.id,recipeRevisionId:r.recipeRevisionId,quantity:r.cookedServings,createdAt:now})):[];
  if(newBatches.length)await tx.cookedBatch.createMany({data:newBatches});
  const batches=await tx.cookedBatch.findMany({where:{userId,revokedAt:null,recipeRevision:{is:{recipeId:{in:meal.recipes.map(r=>r.recipeRevision.recipeId)}}}},include:{recipeRevision:{select:{recipeId:true}},uses:{where:{reversedAt:null},select:{quantity:true}}},orderBy:[{createdAt:"asc"},{id:"asc"}]});
  const available=new Map(batches.map(batch=>[batch.id,quantityThousandths(batch.quantity.toString())-batch.uses.reduce((sum,use)=>sum+quantityThousandths(use.quantity.toString()),ZERO)]));
  const useAmounts=new Map<string,bigint>();
  if(meal.eatingEnabled)for(const dish of meal.recipes){
    let needed=quantityThousandths(dish.eatenServings.toString());
    const same=batches.filter(b=>b.recipeRevision.recipeId===dish.recipeRevision.recipeId);
    const ordered=[...same.filter(b=>b.completionId===completion.id),...same.filter(b=>b.completionId!==completion.id)];
    for(const batch of ordered){const stock=available.get(batch.id)!,used=stock<needed?stock:needed;available.set(batch.id,stock-used);needed-=used;if(used>ZERO)useAmounts.set(batch.id,(useAmounts.get(batch.id)??ZERO)+used);if(needed===ZERO)break;}
    if(needed>ZERO)throw new CoreError("DEPENDENCY",`Faltan ${quantityString(needed)} porciones realmente cocinadas de ${dish.recipeRevision.name}. Completa la preparación de origen o ajusta las porciones; las sobras previstas aún no existen.`);
  }
  if(useAmounts.size)await tx.portionUse.createMany({data:[...useAmounts].map(([batchId,quantity])=>({id:randomUUID(),userId,completionId:completion.id,batchId,quantity:quantityString(quantity)}))});
  const usedIds=steps.filter(s=>!s.optional||selected.has(s.activityId)).map(s=>s.activityId);
  const skippedIds=optional.filter(s=>!selected.has(s.activityId)).map(s=>s.activityId);
  if(skippedIds.length)await tx.activity.updateMany({where:{userId,id:{in:skippedIds},completedAt:{not:null}},data:{completedAt:null}});
  if(usedIds.length)await tx.activity.updateMany({where:{userId,id:{in:usedIds},completedAt:null},data:{completedAt:now}});
  await tx.activity.update({where:{id:blockId},data:{completedAt:now}});
}
export async function undoMeal(tx:Tx,userId:string,blockId:string,commandId:string,actionTime?:Date){
  const completion=await tx.mealCompletion.findFirst({where:{userId,blockId,reversedAt:null},include:{operation:{include:{movements:true}},batches:true},orderBy:{createdAt:"desc"}});
  if(!completion)return;
  const dependents=await tx.portionUse.findMany({where:{userId,batchId:{in:completion.batches.map(b=>b.id)},reversedAt:null,completionId:{not:completion.id}},include:{completion:{include:{block:{include:{activity:{include:{schedule:true}}}}}}}});
  if(dependents.length){const names=[...new Set(dependents.map(use=>{const activity=use.completion.block.activity;return activity.lifecycle==="active"?`«${activity.title}» (${activity.schedule?.startsAt?.toISOString().slice(0,10)??"sin horario"})`:`una comida retirada (registro ${use.completion.blockId})`;}))];throw new CoreError("DEPENDENCY",`Primero deshaz las comidas que usaron estas sobras: ${names.join(", ")}.`);}
  const balances=await tx.pantryBalance.findMany({where:{userId,ingredientId:{in:completion.operation.movements.map(m=>m.ingredientId)}}});
  for(const movement of completion.operation.movements){const next=(balances.find(b=>b.ingredientId===movement.ingredientId)?.quantity??new Prisma.Decimal(0)).sub(movement.delta);if(next.gt("999999999.999"))throw new CoreError("DEPENDENCY","Alacena excedería la cantidad máxima al devolver ingredientes. Ajusta sus existencias primero.");}
  // Transfers after exact reversal can converge on the same replacement; validate aggregate bounds.
  const returned = new Map<string, Prisma.Decimal>();
  for (const movement of completion.operation.movements) { const id = await reversalIngredient(tx, userId, movement.ingredientId); returned.set(id, (returned.get(id) ?? new Prisma.Decimal(0)).sub(movement.delta)); }
  const destinationBalances = await tx.pantryBalance.findMany({ where: { userId, ingredientId: { in: [...returned.keys()] } } });
  for (const [id, amount] of returned) if (amount.add(destinationBalances.find(b => b.ingredientId === id)?.quantity ?? 0).gt("999999999.999")) throw new CoreError("DEPENDENCY", "Alacena excedería la cantidad máxima al devolver ingredientes al sustituto.");
  const now=actionTime??new Date();
  const operation=await tx.inventoryOperation.create({data:{id:randomUUID(),userId,kind:"reversal",commandId,sourceKey:completion.id,sourceActivityId:blockId,sourceRevision:completion.operation.sourceRevision,reversalOfId:completion.operationId}});
  if(completion.operation.movements.length)await tx.inventoryMovement.createMany({data:completion.operation.movements.map(m=>({id:randomUUID(),userId,operationId:operation.id,ingredientId:m.ingredientId,unit:m.unit,delta:m.delta.neg().toString()}))});
  for (const movement of completion.operation.movements) await returnHistoricalStock(tx, userId, commandId, movement.ingredientId, movement.delta.neg());
  await tx.portionUse.updateMany({where:{userId,completionId:completion.id,reversedAt:null},data:{reversedAt:now}});
  await tx.cookedBatch.updateMany({where:{userId,completionId:completion.id,revokedAt:null},data:{revokedAt:now}});
  await tx.mealCompletion.update({where:{id:completion.id},data:{reversedAt:now}});
  const steps=await tx.mealStepData.findMany({where:{userId,role:"preparation",mealRecipe:{is:{blockId}}},select:{activityId:true,sourceStepKey:true,mealRecipe:{select:{recipeRevision:{select:{steps:{orderBy:{position:"asc"},select:{stepKey:true,priorGroup:true,minutesBefore:true}}}}}}}});
  const resetIds=steps.filter(step=>!recipePriorGroups(step.mealRecipe.recipeRevision.steps).some(group=>group.steps.some(item=>item.stepKey===step.sourceStepKey))).map(step=>step.activityId);
  await tx.activity.updateMany({where:{userId,id:{in:resetIds},lifecycle:"active",completedAt:{not:null}},data:{completedAt:null}});
  await tx.activity.update({where:{id:blockId},data:{completedAt:null}});
}
export async function setMealStep(tx:Tx,userId:string,activityId:string,completed:boolean,commandId:string,actionTime?:Date){
  const step=await tx.mealStepData.findFirstOrThrow({where:{activityId,userId,role:"preparation"},include:{mealRecipe:{include:{recipeRevision:{include:{steps:{orderBy:{position:"asc"}}}},block:{include:{activity:true}}}}}}),block=step.mealRecipe.block;
  const steps=await tx.mealStepData.findMany({where:{userId,role:"preparation",mealRecipe:{is:{blockId:block.activityId}},activity:{is:{lifecycle:"active"}}},include:{activity:true}});
  const changedIds=steps.map(item=>item.activityId);
  if(block.activity.completedAt){if(completed)return changedIds;if(recipePriorGroups(step.mealRecipe.recipeRevision.steps).some(group=>group.steps.some(item=>item.stepKey===step.sourceStepKey)))throw new CoreError("DEPENDENCY","Deshaz primero la comida para corregir una preparación previa.");if(step.optional)throw new CoreError("DEPENDENCY","Deshaz primero la comida para corregir los opcionales consumidos.");await undoMeal(tx,userId,block.activityId,commandId,actionTime);return changedIds;}
  const source=step.mealRecipe.recipeRevision.steps;
  const groups=recipePriorGroups(source);
  const group=groups.find(item=>item.steps.some(sourceStep=>sourceStep.stepKey===step.sourceStepKey));
  const anchor=group?.anchor.stepKey===step.sourceStepKey;
  const dishSteps=steps.filter(item=>item.mealRecipeId===step.mealRecipeId);
  const sourceByKey=new Map(source.map(item=>[item.stepKey,item]));
  const currentPosition=sourceByKey.get(step.sourceStepKey)!.position;
  if(group && anchor && completed){
    const start=group.steps[0].position;
    const pendingBefore=dishSteps.find(item=>!item.optional && !item.activity.completedAt && sourceByKey.get(item.sourceStepKey)!.position<start);
    if(pendingBefore)throw new CoreError("DEPENDENCY",`Completa primero el tramo anterior: falta «${pendingBefore.activity.title}».`);
    const keys=new Set(group.steps.map(item=>item.stepKey));
    const ids=dishSteps.filter(item=>keys.has(item.sourceStepKey)&&(!item.optional||item.activityId===activityId)).map(item=>item.activityId);
    await tx.activity.updateMany({where:{userId,id:{in:ids},completedAt:null},data:{completedAt:actionTime??new Date()}});
    return changedIds; // A prior group never completes the meal or consumes stock.
  }
  if(group && !completed){
    const boundary=anchor?group.anchor.position:currentPosition;
    const later=dishSteps.filter(item=>item.activity.completedAt && sourceByKey.get(item.sourceStepKey)!.position>boundary).sort((a,b)=>sourceByKey.get(b.sourceStepKey)!.position-sourceByKey.get(a.sourceStepKey)!.position)[0];
    if(later)throw new CoreError("DEPENDENCY",`Deshaz primero los pasos posteriores, empezando por «${later.activity.title}».`);
    const keys=new Set(anchor?group.steps.map(item=>item.stepKey):[step.sourceStepKey]);
    await tx.activity.updateMany({where:{userId,id:{in:dishSteps.filter(item=>keys.has(item.sourceStepKey)).map(item=>item.activityId)},completedAt:{not:null}},data:{completedAt:null}});
    return changedIds;
  }
  await tx.activity.update({where:{id:activityId},data:{completedAt:completed?(actionTime??new Date()):null}});
  if(group)return changedIds;
  const refreshed=steps.map(item=>item.activityId===activityId?{...item,activity:{...item.activity,completedAt:completed?(actionTime??new Date()):null}}:item);
  const required=refreshed.filter(s=>!s.optional);
  if(required.length&&required.every(s=>s.activity.completedAt))await completeMeal(tx,userId,block.activityId,commandId,refreshed.filter(s=>s.optional&&s.activity.completedAt).map(s=>s.activityId),actionTime);
  return changedIds;
}
