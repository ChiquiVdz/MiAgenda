import type { LocalCopy } from "./local-contract";
import type { IngredientView } from "../../../reconstruction/core/src/pantry";
import type { MealView } from "../../../reconstruction/core/src/planner";
import type { ShoppingItem } from "../../../reconstruction/core/src/shopping";
import { localReceiptId, type KitchenOperation, type KitchenLedger } from "../../../reconstruction/core/src/local-kitchen-contract";
import { normalizedIngredientName, similarIngredientName, quantityString as text, quantityThousandths as milli } from "../../../reconstruction/core/src/ingredient-input";
import { plannedIngredientSteps } from "../../../reconstruction/core/src/meal-amounts";
import { recipePriorGroups } from "../../../reconstruction/core/src/recipe-prior-groups";
import { projectAvailability } from "../../../reconstruction/core/src/availability";
import { mergeTaskRows } from "./local-tasks";
const ZERO=BigInt(0),MAX=BigInt("999999999999");
export function supportsKitchenLocally(copy:LocalCopy,command:{action:string;id?:string;completed?:boolean}) {
  const ledger=copy.kitchenLedger;if(!ledger)return true; // Enqueue explains that the old copy needs updating.
  if(command.action==="undoShoppingPurchase"){
    const purchase=ledger.purchases.find(p=>p.id===command.id);
    if(purchase?.ingredientId&&!copy.pantry.ingredients.some(i=>i.id===purchase.ingredientId))return false;
  }
  if(command.action==="setCompleted"){
    const ref=ledger.steps.find(s=>s.id===command.id),meal=copy.planners.flatMap(p=>p.meals).find(m=>m.id===(ref?.mealId??command.id));
    if(!meal)return false;
    if(!command.completed&&ledger.completions.find(c=>c.mealId===meal.id)?.amounts.some(a=>!copy.pantry.ingredients.some(i=>i.id===a.ingredientId)))return false;
  }
  return true;
}
type Step=MealView["recipes"][number]["steps"][number];
type AmountStep={stepKey?:string;ingredientId:string|null;ingredientName:string|null;unit:string|null;quantity:string|null;optional:boolean};
type Fraction={n:bigint;d:bigint};
function gcd(a:bigint,b:bigint):bigint {while(b){const rest=a%b;a=b;b=rest;}return a;}
function plus(a:Fraction,b:Fraction):Fraction {const n=a.n*b.d+b.n*a.d,d=a.d*b.d,g=gcd(n,d)||BigInt(1);return {n:n/g,d:d/g};}
function ceil(f:Fraction){return (f.n+f.d-BigInt(1))/f.d;}
function amount9(value:string):Fraction{const [whole,tail=""]=value.split(".");return {n:BigInt(whole)*BigInt(1000000000)+BigInt(tail.padEnd(9,"0")),d:BigInt(1000000)};}
/** Fractions stay exact until aggregation, including plans predating chosen quantities. */
function dishAmounts(dish:{steps:AmountStep[];baseServings:string;cookedServings:string;ingredientQuantities?:Record<string,string>|null}, select:(step:AmountStep)=>boolean, ingredients:IngredientView[]) {
  const rows=new Map<string,{step:AmountStep;amount:Fraction}>();
  const numeric=dish.steps.filter(s=>!s.ingredientId||ingredients.find(i=>i.id===s.ingredientId)?.trackingMode!=="availability");
  const steps=dish.ingredientQuantities!=null?plannedIngredientSteps(numeric,dish.baseServings,dish.cookedServings,dish.ingredientQuantities):numeric;
  for(const step of steps)if(step.ingredientId&&step.quantity&&select(step)){
    const value=dish.ingredientQuantities!=null?amount9(step.quantity):{n:milli(step.quantity)*milli(dish.cookedServings),d:milli(dish.baseServings)};
    const old=rows.get(step.ingredientId);rows.set(step.ingredientId,{step,amount:old?plus(old.amount,value):value});
  }
  return rows;
}
function stock(copy:LocalCopy,id:string,delta:bigint,listed=true){
  const row=copy.pantry.ingredients.find(i=>i.id===id);if(!row)throw new Error("El ingrediente necesario no está descargado.");
  const next=milli(row.quantity)+delta;if(next<ZERO)throw new Error(`No hay suficiente ${row.name} en Alacena.`);if(next>MAX)throw new Error("La cantidad excede el máximo de Alacena.");
  row.quantity=text(next);row.available=row.trackingMode==="availability"?row.available:next>ZERO;row.listed=listed;row.balanceRevision=(row.balanceRevision??0)+1;
}
function pantryItems(copy:LocalCopy){copy.pantry.items=copy.pantry.ingredients.filter(i=>i.listed).map(i=>({ingredient:i,quantity:i.quantity,revision:i.balanceRevision??0}));}
function remaining(ledger:KitchenLedger,id:string){const batch=ledger.batches.find(b=>b.id===id)!;return milli(batch.quantity)-ledger.completions.flatMap(c=>c.uses).filter(u=>u.batchId===id).reduce((sum,u)=>sum+milli(u.quantity),ZERO);}
function plan(meal:MealView){return {id:meal.id,title:meal.title,createdAt:meal.activity.createdAt,startsAt:meal.schedule.startsAt!,cookingEnabled:meal.cookingEnabled,eatingEnabled:meal.eatingEnabled,recipes:meal.recipes.map(d=>({id:d.id,recipeId:d.recipeId,name:d.name,baseServings:d.baseServings,cookedServings:d.cookedServings,eatenServings:d.eatenServings,ingredientQuantities:d.ingredientQuantities,steps:d.steps}))};}
function shopping(copy:LocalCopy){
  const ledger=copy.kitchenLedger!,ingredients=copy.pantry.ingredients,totals=new Map<string,{name:string;unit:string;required:bigint;optional:bigint}>(),presence=new Map<string,{name:string;unit:string;optionalOnly:boolean}>();
  for(const pending of copy.planners[0].resources.plans)if(pending.cookingEnabled){
    const sums=new Map<string,{name:string;unit:string;required:Fraction;optional:Fraction}>();
    for(const dish of pending.recipes)if(milli(dish.cookedServings)>ZERO){
      for(const step of dish.steps)if(step.ingredientId&&(ingredients.find(i=>i.id===step.ingredientId)?.trackingMode==="availability"||!step.quantity)){
        const old=presence.get(step.ingredientId);presence.set(step.ingredientId,{name:step.ingredientName??"Ingrediente",unit:step.unit??"",optionalOnly:(old?.optionalOnly??true)&&step.optional});
      }
      for(const optional of [false,true])for(const [id,row] of dishAmounts(dish,s=>s.optional===optional,ingredients)){
        const sum=sums.get(id)??{name:row.step.ingredientName??"Ingrediente",unit:row.step.unit??"",required:{n:ZERO,d:BigInt(1)},optional:{n:ZERO,d:BigInt(1)}};
        const key=optional?"optional":"required";sum[key]=plus(sum[key],row.amount);sums.set(id,sum);
      }
    }
    for(const[id,sum]of sums){const required=ceil(sum.required),total=ceil(plus(sum.required,sum.optional)),old=totals.get(id)??{name:sum.name,unit:sum.unit,required:ZERO,optional:ZERO};old.required+=required;old.optional+=total-required;totals.set(id,old);}
  }
  const items:ShoppingItem[]=[];
  for(const[id,total]of totals){const quantity=milli(ingredients.find(i=>i.id===id)?.quantity??"0"),required=total.required>quantity?total.required-quantity:ZERO,left=quantity>total.required?quantity-total.required:ZERO,optional=total.optional>left?total.optional-left:ZERO;if(required+optional===ZERO)continue;if(required+optional>MAX)throw new Error("Los faltantes exceden el máximo. Divide tus planes.");const entry=ledger.entries.find(e=>!e.free&&!e.retired&&e.ingredientId===id);items.push({key:`i:${id}`,id:entry?.id??null,ingredientId:id,name:total.name,unit:total.unit,free:false,required:text(required),optional:text(optional),quantity:entry?.quantity??text(required+optional),availabilityOnly:false,optionalOnly:required===ZERO,edited:entry?.quantity!=null});}
  for(const[id,row]of presence)if(!ingredients.find(i=>i.id===id)?.available&&!items.some(i=>i.ingredientId===id)&&!ledger.entries.some(e=>e.free&&!e.closed&&!e.retired&&e.ingredientId===id)){
    const entry=ledger.entries.find(e=>!e.free&&!e.retired&&e.ingredientId===id),availabilityOnly=ingredients.find(i=>i.id===id)?.trackingMode==="availability";
    items.push({key:`i:${id}`,id:entry?.id??null,ingredientId:id,name:row.name,unit:row.unit,free:false,required:"0",optional:"0",quantity:availabilityOnly?"0":entry?.quantity??"",edited:!availabilityOnly&&entry?.quantity!=null,availabilityOnly,optionalOnly:row.optionalOnly});
  }
  items.sort((a,b)=>a.name.localeCompare(b.name,"es"));
  for(const entry of ledger.entries)if(entry.free&&!entry.closed&&!entry.retired){const availabilityOnly=ingredients.find(i=>i.id===entry.ingredientId)?.trackingMode==="availability";items.push({key:`e:${entry.id}`,id:entry.id,ingredientId:entry.ingredientId,name:entry.name,unit:entry.unit,free:true,required:"0",optional:"0",quantity:availabilityOnly?"0":entry.quantity!,edited:true,availabilityOnly,optionalOnly:false});}
  copy.shopping.items=items;
}
function recompute(copy:LocalCopy){
  pantryItems(copy);
  const ledger=copy.kitchenLedger!,meals=copy.planners.flatMap(p=>p.meals);
  for(const planner of copy.planners){
    planner.resources.plans=planner.resources.plans.filter(p=>!meals.some(m=>m.id===p.id&&m.completedAt));
    for(const meal of meals)if(!meal.completedAt&&!planner.resources.plans.some(p=>p.id===meal.id))planner.resources.plans.push(plan(meal));
    planner.resources.balances=copy.pantry.ingredients.filter(i=>milli(i.quantity)>ZERO).map(i=>({ingredientId:i.id,quantity:i.quantity}));
    planner.resources.tracking=copy.pantry.ingredients.map(i=>({ingredientId:i.id,mode:i.trackingMode,available:i.available}));
    planner.resources.realBatches=ledger.batches.flatMap(b=>{const quantity=remaining(ledger,b.id);return quantity>ZERO?[{id:b.id,mealId:b.mealId,title:b.title,startsAt:b.createdAt,recipeId:b.recipeId,recipeName:b.recipeName,version:b.version,quantity:text(quantity)}]:[];});
    planner.availability=projectAvailability(planner.resources);planner.readyRecipes=copy.recipes.items.filter(r=>!r.draft);
  }
  shopping(copy);
  return mergeTaskRows(copy,meals.map(m=>m.activity));
}
function complete(copy:LocalCopy,meal:MealView,op:KitchenOperation,selected:string[]|undefined){
  if(meal.completedAt)return;
  const ledger=copy.kitchenLedger!,refs=ledger.steps.filter(s=>s.mealId===meal.id&&s.role==="preparation"),children=meal.activity.children.filter(c=>refs.some(s=>s.id===c.id)),optionals=children.filter(c=>c.mealOptional);
  if(selected===undefined&&optionals.length)throw new Error("Elige los pasos opcionales utilizados antes de completar.");
  const used=new Set(selected??[]);if([...used].some(id=>!optionals.some(c=>c.id===id)))throw new Error("Un opcional no pertenece a esta comida.");
  const totals=new Map<string,Fraction>();
  if(meal.cookingEnabled)for(const dish of meal.recipes)if(milli(dish.cookedServings)>ZERO){
    const include=(step:AmountStep)=>!step.optional||refs.some(s=>s.dishId===dish.id&&s.stepKey===step.stepKey&&used.has(s.id));
    for(const step of dish.steps)if(include(step)&&step.ingredientId&&(copy.pantry.ingredients.find(i=>i.id===step.ingredientId)?.trackingMode==="availability"||!step.quantity)&&!copy.pantry.ingredients.find(i=>i.id===step.ingredientId)?.available)throw new Error(`Falta ${step.ingredientName}. Registra su disponibilidad en Alacena.`);
    for(const[id,row]of dishAmounts(dish,include,copy.pantry.ingredients))totals.set(id,plus(totals.get(id)??{n:ZERO,d:BigInt(1)},row.amount));
  }
  const completion={id:op.command.commandId,mealId:meal.id,amounts:[...totals].map(([ingredientId,sum])=>({ingredientId,quantity:text(ceil(sum))})).filter(a=>milli(a.quantity)>ZERO),uses:[] as {batchId:string;quantity:string}[]};
  for(const row of completion.amounts)stock(copy,row.ingredientId,-milli(row.quantity),copy.pantry.ingredients.find(i=>i.id===row.ingredientId)!.listed);
  const fresh=meal.cookingEnabled?meal.recipes.filter(d=>milli(d.cookedServings)>ZERO).map((d,index)=>({id:localReceiptId(op.command.commandId,index),completionId:completion.id,mealId:meal.id,title:meal.title,recipeId:d.recipeId,recipeName:d.name,version:d.version,createdAt:op.at,quantity:d.cookedServings})):[];
  ledger.batches.push(...fresh);ledger.completions.push(completion);
  if(meal.eatingEnabled)for(const dish of meal.recipes){let needed=milli(dish.eatenServings);const batches=ledger.batches.filter(b=>b.recipeId===dish.recipeId).sort((a,b)=>Number(b.completionId===completion.id)-Number(a.completionId===completion.id)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));for(const batch of batches){const available=remaining(ledger,batch.id),quantity=available<needed?available:needed;if(quantity>ZERO){const old=completion.uses.find(u=>u.batchId===batch.id);if(old)old.quantity=text(milli(old.quantity)+quantity);else completion.uses.push({batchId:batch.id,quantity:text(quantity)});needed-=quantity;}if(needed===ZERO)break;}if(needed>ZERO)throw new Error(`Faltan ${text(needed)} porciones realmente cocinadas de ${dish.name}. Completa primero su preparación de origen.`);}
  for(const child of children)child.completedAt=!child.mealOptional||used.has(child.id)?child.completedAt??op.at:null;
  meal.completedAt=op.at;meal.activity.completedAt=op.at;meal.activity.lastMealOptionals=[...used];
  meal.portionSources=completion.uses.map((u,index)=>{const b=ledger.batches.find(b=>b.id===u.batchId)!;return {id:localReceiptId(op.command.commandId,index),quantity:u.quantity,name:b.recipeName,version:b.version,createdAt:b.createdAt,mealId:b.mealId};});
}
function undo(copy:LocalCopy,meal:MealView){
  const ledger=copy.kitchenLedger!,completion=ledger.completions.find(c=>c.mealId===meal.id);if(!completion)return;
  const own=ledger.batches.filter(b=>b.completionId===completion.id),dependents=ledger.completions.filter(c=>c.id!==completion.id&&c.uses.some(u=>own.some(b=>b.id===u.batchId)));
  if(dependents.length)throw new Error("Primero deshaz las comidas posteriores que usaron estas sobras.");
  for(const amount of completion.amounts)stock(copy,amount.ingredientId,milli(amount.quantity),copy.pantry.ingredients.find(i=>i.id===amount.ingredientId)!.listed);
  ledger.batches=ledger.batches.filter(b=>b.completionId!==completion.id);ledger.completions=ledger.completions.filter(c=>c.id!==completion.id);
  const priorKeys=new Set(meal.recipes.flatMap(d=>recipePriorGroups(d.steps).flatMap(g=>g.steps.map(s=>`${d.id}:${s.stepKey}`))));
  for(const child of meal.activity.children){const ref=ledger.steps.find(s=>s.id===child.id);if(ref?.role==="preparation"&&!priorKeys.has(`${ref.dishId}:${ref.stepKey}`))child.completedAt=null;}
  meal.completedAt=null;meal.activity.completedAt=null;meal.portionSources=[];
}
function markMeal(copy:LocalCopy,op:KitchenOperation){
  const c=op.command;if(c.action!=="setCompleted")return;
  const ledger=copy.kitchenLedger!,ref=ledger.steps.find(s=>s.id===c.id),meal=copy.planners.flatMap(p=>p.meals).find(m=>m.id===(ref?.mealId??c.id));
  if(!meal)throw new Error("Esta comida no está descargada. Descarga sus fechas antes de modificarla sin conexión.");
  if(c.id===meal.id){if(c.completed)complete(copy,meal,op,c.optionalStepIds);else undo(copy,meal);}
  else{
    const child=meal.activity.children.find(s=>s.id===c.id);if(!child||!ref)throw new Error("El paso no está descargado.");
    if(ref.role==="priorReminder")child.completedAt=c.completed?child.completedAt??op.at:null;
    else{
      const dish=meal.recipes.find(d=>d.id===ref.dishId)!,groups=recipePriorGroups(dish.steps),group=groups.find(g=>g.steps.some(s=>s.stepKey===ref.stepKey)),anchor=group?.anchor.stepKey===ref.stepKey;
      const refs=ledger.steps.filter(s=>s.dishId===dish.id&&s.role==="preparation"),position=(id:string)=>dish.steps.findIndex(s=>s.stepKey===refs.find(r=>r.id===id)?.stepKey);
      const children=meal.activity.children.filter(s=>refs.some(r=>r.id===s.id));
      if(meal.completedAt){if(c.completed)return;if(group||child.mealOptional)throw new Error("Deshaz primero la comida para corregir esta preparación u opcional.");undo(copy,meal);}
      else if(group){
        if(anchor&&c.completed){const start=dish.steps.findIndex(s=>s.stepKey===group.steps[0].stepKey),before=children.find(s=>!s.mealOptional&&!s.completedAt&&position(s.id)<start);if(before)throw new Error(`Completa primero el tramo anterior: ${before.title}.`);for(const item of children)if(group.steps.some(s=>s.stepKey===refs.find(r=>r.id===item.id)?.stepKey)&&(!item.mealOptional||item.id===child.id))item.completedAt=item.completedAt??op.at;}
        else if(!c.completed){const later=children.find(s=>s.completedAt&&position(s.id)>position(child.id));if(later)throw new Error(`Deshaz primero el paso posterior: ${later.title}.`);for(const item of children)if(anchor?group.steps.some(s=>s.stepKey===refs.find(r=>r.id===item.id)?.stepKey):item.id===child.id)item.completedAt=null;}
        else child.completedAt=child.completedAt??op.at;
      }else{
        child.completedAt=c.completed?child.completedAt??op.at:null;
        const required=meal.activity.children.filter(s=>s.mealRole==="preparation"&&!s.mealOptional);
        if(required.length&&required.every(s=>s.completedAt))complete(copy,meal,op,meal.activity.children.filter(s=>s.mealOptional&&s.completedAt).map(s=>s.id));
      }
    }
  }
  meal.revision++;meal.activity.revision=meal.revision;
  for(const dish of meal.recipes)for(const reminder of dish.reminders)reminder.completedAt=meal.activity.children.find(s=>s.id===reminder.id)?.completedAt??null;
}
export function projectKitchen(original:LocalCopy,op:KitchenOperation):{copy:LocalCopy;result:object}{
  if(!original.kitchenLedger)throw new Error("Pulsa Actualizar con internet para preparar Cocina sin conexión.");
  let copy=structuredClone(original);const c=op.command,ledger=copy.kitchenLedger!,ingredients=copy.pantry.ingredients;
  let result:object={changed:true,dataRevision:copy.dataRevision};
  if(c.action==="createIngredient"){
    const normalizedName=normalizedIngredientName(c.name),exact=ingredients.find(i=>i.normalizedName===normalizedName),similar=ingredients.find(i=>similarIngredientName(i.normalizedName,normalizedName));
    if(exact)throw new Error(`Ya existe «${exact.name}». Selecciónalo en el catálogo.`);if(similar&&!c.confirmSimilar)throw new Error(`Existe «${similar.name}». Selecciónalo o confirma que es distinto.`);
    ingredients.push({id:c.id,name:c.name,normalizedName,unit:c.unit,scope:"private",trackingMode:c.trackingMode??"quantity",available:false,revision:0,hidden:false,preferenceRevision:c.trackingMode==="availability"?0:null,unitLocked:false,balanceRevision:null,quantity:"0",listed:false});
  }else if(c.action==="setPantryQuantity"||c.action==="setIngredientTracking"||c.action==="setIngredientHidden"){
    const row=ingredients.find(i=>i.id===c.id);if(!row)throw new Error("El ingrediente no está descargado.");
    if(c.action==="setIngredientHidden"){row.hidden=c.hidden;row.preferenceRevision=(row.preferenceRevision??0)+1;}
    else if(c.action==="setPantryQuantity"){if(row.trackingMode!=="quantity")throw new Error("Este ingrediente se lleva por disponibilidad.");stock(copy,row.id,milli(c.quantity)-milli(row.quantity),c.listed);}
    else{if(c.mode!==row.trackingMode)throw new Error("Cambiar entre cantidad y disponibilidad requiere conexión directa y enviar primero tus cambios.");if(c.mode==="quantity")stock(copy,row.id,milli(c.quantity!)-milli(row.quantity),c.listed);else{row.available=c.available;row.listed=c.listed;row.balanceRevision=(row.balanceRevision??0)+1;ledger.availabilityReceipts[row.id]=null;}row.preferenceRevision=(row.preferenceRevision??0)+1;}
  }else if(c.action==="createRecipe"||c.action==="editRecipe"||c.action==="retireRecipe"){
    if(!("recipe" in c))throw new Error("Receta inválida.");const previous=copy.recipes.items.find(r=>r.id===c.id);if(c.action!=="createRecipe"&&!previous)throw new Error("La receta no está descargada.");
    if(c.action==="retireRecipe"){copy.recipes.items=copy.recipes.items.filter(r=>r.id!==c.id);result={removedId:c.id,dataRevision:copy.dataRevision};}
    else{
      const recipe=c.recipe!;
      const steps=recipe.steps.map(s=>{const ingredient=s.ingredientId?ingredients.find(i=>i.id===s.ingredientId):null;if(s.ingredientId&&!ingredient)throw new Error("El ingrediente no está descargado.");if(ingredient&&s.quantity===null&&ingredient.trackingMode!=="availability")throw new Error(`Indica una cantidad para ${ingredient.name}.`);if(ingredient)ingredient.unitLocked=true;return {stepKey:s.stepKey,text:s.text,optional:s.optional,ingredientId:s.ingredientId,ingredientName:ingredient?.name??null,unit:ingredient?.unit??null,quantity:s.quantity,equivalent:s.equivalent,minutesBefore:s.minutesBefore,priorTitle:s.priorTitle,priorGroup:s.priorGroup??false};});
      const item={id:c.id,revision:(previous?.revision??-1)+1,revisionId:c.commandId,version:(previous?.version??0)+1,name:recipe.name,description:null,draft:recipe.draft,slotIds:recipe.slotIds??previous?.slotIds??[],baseServings:recipe.baseServings,cookingMinutes:recipe.cookingMinutes,steps};
      if(item.slotIds.some(id=>!copy.recipes.slots.some(s=>s.id===id)))throw new Error("El tipo de comida no está descargado.");
      copy.recipes.items=[...copy.recipes.items.filter(r=>r.id!==c.id),item];result={item,dataRevision:copy.dataRevision};
    }
  }else if(c.action==="setCompleted")markMeal(copy,op);
  else if(c.action==="addShoppingEntry"){
    const ingredient=c.ingredientId?ingredients.find(i=>i.id===c.ingredientId):null;if(c.ingredientId&&!ingredient)throw new Error("El ingrediente no está descargado.");
    if(ingredient?.trackingMode==="availability"&&ledger.entries.some(e=>e.free&&!e.closed&&!e.retired&&e.ingredientId===ingredient.id))throw new Error("Este ingrediente ya está pendiente en Compras.");
    ledger.entries.push({id:c.id,ingredientId:c.ingredientId,name:ingredient?.name??c.name,unit:ingredient?.unit??c.unit,free:true,quantity:c.quantity,closed:false,retired:false});
  }else if(c.action==="removeShoppingEntry"){
    const entry=ledger.entries.find(e=>e.id===c.id&&e.free&&!e.retired&&!e.closed);if(!entry)throw new Error("El artículo ya no está pendiente.");entry.retired=true;
  }else if(c.action==="saveShoppingQuantity"){
    const item=copy.shopping.items.find(i=>i.key===c.key);if(!item)throw new Error("El artículo ya no está pendiente.");if(item.availabilityOnly)throw new Error("Este ingrediente usa disponibilidad.");if(item.free&&(c.quantity===null||c.quantity==="0"))throw new Error("Indica una cantidad positiva.");
    let entry=ledger.entries.find(e=>e.id===item.id);if(!entry){entry={id:c.commandId,ingredientId:item.ingredientId,name:item.name,unit:item.unit,free:false,quantity:null,closed:false,retired:false};ledger.entries.push(entry);}entry.quantity=c.quantity;
  }else if(c.action==="buyShoppingItems"){
    for(const[index,selected]of c.items.entries()){
      const item=copy.shopping.items.find(i=>i.key===selected.key);if(!item)throw new Error("El artículo ya no está pendiente.");if(!item.availabilityOnly&&selected.quantity==="0")throw new Error("Compra una cantidad mayor que cero.");
      let entry=ledger.entries.find(e=>e.id===item.id);if(!entry){entry={id:localReceiptId(c.commandId,index+200),ingredientId:item.ingredientId,name:item.name,unit:item.unit,free:false,quantity:null,closed:false,retired:false};ledger.entries.push(entry);}
      const id=localReceiptId(c.commandId,index),ingredient=ingredients.find(i=>i.id===item.ingredientId);
      ledger.purchases.push({id,entryId:entry.id,ingredientId:item.ingredientId,quantity:item.availabilityOnly?"0":selected.quantity,availabilityOnly:item.availabilityOnly,previousAvailable:item.availabilityOnly?ingredient?.available??false:null,previousReceiptId:item.ingredientId?ledger.availabilityReceipts[item.ingredientId]??null:null});
      if(ingredient){ingredient.unitLocked=true;if(item.availabilityOnly){ingredient.available=true;ingredient.listed=true;ingredient.balanceRevision=(ingredient.balanceRevision??0)+1;ledger.availabilityReceipts[ingredient.id]=id;}else stock(copy,ingredient.id,milli(selected.quantity));}
      if(entry.free)entry.closed=true;else entry.quantity=null;
      copy.shopping.purchased.unshift({id,name:item.name,unit:item.unit,quantity:item.availabilityOnly?"0":selected.quantity,availabilityOnly:item.availabilityOnly,required:item.required,optional:item.optional,createdAt:op.at});
    }
  }else if(c.action==="undoShoppingPurchase"){
    const receipt=ledger.purchases.find(p=>p.id===c.id);if(!receipt)throw new Error("Esta compra no está descargada.");
    const entry=ledger.entries.find(e=>e.id===receipt.entryId)!;
    if(receipt.ingredientId){const ingredient=ingredients.find(i=>i.id===receipt.ingredientId);if(!ingredient)throw new Error("Deshacer compras con ingredientes retirados requiere conexión directa.");if(receipt.availabilityOnly){if(ledger.availabilityReceipts[ingredient.id]!==receipt.id)throw new Error("La disponibilidad cambió después de esta compra. Deshaz primero las compras posteriores o corrige Alacena.");ingredient.available=receipt.previousAvailable??false;ledger.availabilityReceipts[ingredient.id]=receipt.previousReceiptId;}else stock(copy,ingredient.id,-milli(receipt.quantity),ingredient.listed);}
    if(!entry.retired){entry.closed=false;if(entry.free||entry.quantity===null)entry.quantity=receipt.availabilityOnly?entry.quantity:receipt.quantity;}
    ledger.purchases=ledger.purchases.filter(p=>p.id!==c.id);copy.shopping.purchased=copy.shopping.purchased.filter(p=>p.id!==c.id);
  }else throw new Error("Esta acción requiere conexión directa.");
  copy=recompute(copy);
  if(["createIngredient","setPantryQuantity","setIngredientTracking","setIngredientHidden"].includes(c.action)&&"id" in c){const ingredient=copy.pantry.ingredients.find(i=>i.id===c.id)!;result={ingredients:[ingredient],items:copy.pantry.items.filter(i=>i.ingredient.id===c.id),removedItemIds:ingredient.listed?[]:[c.id],dataRevision:copy.dataRevision};}
  if(c.action==="setCompleted"){const mealId=ledger.steps.find(s=>s.id===c.id)?.mealId??c.id,meal=copy.planners.flatMap(p=>p.meals).find(m=>m.id===mealId)!;result={activities:[meal.activity,...meal.activity.children.map(c=>({...c,children:[]}))],removedIds:[],calendars:[],dataRevision:copy.dataRevision};}
  return {copy,result};
}
export function projectKitchenOperations(copy:LocalCopy,operations:KitchenOperation[]){return operations.reduce((state,op)=>projectKitchen(state,op).copy,copy);}
