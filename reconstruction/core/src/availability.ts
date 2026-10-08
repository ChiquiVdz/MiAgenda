import { plannedIngredientSteps, type MealQuantities } from "./meal-amounts.ts";
/** Pure provisional projection. Never writes balances, batches or completion. */
export type AvailabilityStep = { stepKey?: string; ingredientId: string | null; ingredientName: string | null; unit: string | null; quantity: string | null; optional: boolean };
export type AvailabilityDish = { id: string; recipeId: string; name: string; baseServings: string; cookedServings: string; eatenServings: string; ingredientQuantities?: MealQuantities | null; steps: AvailabilityStep[] };
export type AvailabilityPlan = { id: string; title: string; startsAt: string; createdAt: string; cookingEnabled: boolean; eatingEnabled: boolean; recipes: AvailabilityDish[] };
export type AvailabilityContext = { plans: AvailabilityPlan[]; tracking?: { ingredientId: string; mode: "quantity" | "availability"; available: boolean }[]; balances: { ingredientId: string; quantity: string }[]; realBatches?: { id:string; mealId:string; title:string; startsAt:string; recipeId:string; recipeName:string; version:number; quantity:string }[] };
export type Shortage = { ingredientId: string; name: string; unit: string; quantity: string; optional: boolean; mealRecipeId: string; availabilityOnly?: boolean };
export type MealAvailability = { shortages: Shortage[]; missingPortions: { mealRecipeId: string; recipeId: string; name: string; quantity: string; ingredients: Shortage[] }[]; dependencies: { mealRecipeId: string; mealId: string; title: string; startsAt: string; quantity: string; recipeName: string; shortages: Shortage[]; real:boolean; version?:number }[] };
const SCALE = BigInt(1000000000), ZERO = BigInt(0);
function amount(value: string) {
  const text=value.trim().replace(",", ".");
  if (!/^\d{1,12}(?:\.\d{1,9})?$/.test(text)) throw new Error("Revisa las cantidades para calcular disponibilidad.");
  const [whole,fraction=""]=text.split(".");
  return BigInt(whole)*SCALE+BigInt(fraction.padEnd(9,"0"));
}
function ceilDiv(n: bigint,d: bigint) { if(d<=ZERO)throw new Error("La receta necesita porciones base positivas.");return (n+d-BigInt(1))/d; }
function display(n: bigint) {
  // Round shortages upward to the stock's three decimals, never hide a deficit.
  const value=ceilDiv(n,BigInt(1000000)),tail=String(value%BigInt(1000)).padStart(3,"0").replace(/0+$/,"");
  return `${value/BigInt(1000)}${tail?`.${tail}`:""}`;
}
function demands(dish: AvailabilityDish,portions: bigint,optional: boolean, uncounted = new Set<string>(), useChosen=true) {
  if(useChosen&&dish.ingredientQuantities!=null){
    const grouped=new Map<string,{step:AvailabilityStep;quantity:bigint}>();
    for(const step of plannedIngredientSteps(dish.steps.filter(step=>!step.ingredientId||!uncounted.has(step.ingredientId)),dish.baseServings,dish.cookedServings,dish.ingredientQuantities))if(step.ingredientId&&step.quantity&&step.optional===optional){const old=grouped.get(step.ingredientId);grouped.set(step.ingredientId,{step,quantity:(old?.quantity??ZERO)+amount(step.quantity)});}
    return [...grouped.values()];
  }
  const grouped=new Map<string,{step:AvailabilityStep;quantity:bigint}>();
  for(const step of dish.steps)if(step.ingredientId && step.quantity && !uncounted.has(step.ingredientId) && step.optional===optional){
    const old=grouped.get(step.ingredientId);
    grouped.set(step.ingredientId,{step,quantity:(old?.quantity??ZERO)+amount(step.quantity)});
  }
  return [...grouped.values()].map(({step,quantity})=>({step,quantity:ceilDiv(quantity*portions,amount(dish.baseServings))}));
}
export function projectAvailability(context: AvailabilityContext): Record<string,MealAvailability> {
  const plans=[...context.plans].sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
  const uncounted=new Set((context.tracking??[]).filter(row=>row.mode==="availability").map(row=>row.ingredientId));
  const available=new Set((context.tracking??[]).filter(row=>row.available).map(row=>row.ingredientId));
  const stock=new Map(context.balances.map(row=>[row.ingredientId,amount(row.quantity)]));
  function presence(dish:AvailabilityDish,optional:boolean):Shortage[] {
    const seen=new Set<string>();
    return dish.steps.flatMap(step=>{
      if(!step.ingredientId || step.optional!==optional || (!uncounted.has(step.ingredientId)&&step.quantity!==null) || (uncounted.has(step.ingredientId) ? available.has(step.ingredientId) : (stock.get(step.ingredientId)??ZERO)>ZERO) || seen.has(step.ingredientId))return [];
      seen.add(step.ingredientId);return [{ingredientId:step.ingredientId,name:step.ingredientName??"Ingrediente",unit:step.unit??"",quantity:"0",optional,mealRecipeId:dish.id,availabilityOnly:true}];
    });
  }
  const result:Record<string,MealAvailability>={};
  const before=new Map<string,Map<string,bigint>>();
  function shortage(step:AvailabilityStep,quantity:bigint,optional:boolean,mealRecipeId:string):Shortage{return {ingredientId:step.ingredientId!,name:step.ingredientName??"Ingrediente",unit:step.unit??"",quantity:display(quantity),optional,mealRecipeId};}
  // All mandatory demands, chronologically, before any optional reservations.
  for(const plan of plans){
    result[plan.id]={shortages:[],missingPortions:[],dependencies:[]};
    for(const dish of plan.recipes){
      if(plan.cookingEnabled && amount(dish.cookedServings)>ZERO){
        result[plan.id].shortages.push(...presence(dish,false));
        for(const {step,quantity} of demands(dish,amount(dish.cookedServings),false,uncounted)){
          const available=stock.get(step.ingredientId!)??ZERO,used=available<quantity?available:quantity;
          stock.set(step.ingredientId!,available-used);
          if(used<quantity)result[plan.id].shortages.push(shortage(step,quantity-used,false,dish.id));
        }
      }
    }
    const relevant=plan.recipes.flatMap(dish=>dish.steps.flatMap(step=>step.ingredientId?[step.ingredientId]:[]));
    before.set(plan.id,new Map(relevant.map(id=>[id,stock.get(id)??ZERO])));
  }
  for(const plan of plans)if(plan.cookingEnabled)for(const dish of plan.recipes){
    if(amount(dish.cookedServings)>ZERO)result[plan.id].shortages.push(...presence(dish,true));
    for(const {step,quantity} of demands(dish,amount(dish.cookedServings),true,uncounted)){
    const available=stock.get(step.ingredientId!)??ZERO,used=available<quantity?available:quantity;
    stock.set(step.ingredientId!,available-used);
    if(used<quantity)result[plan.id].shortages.push(shortage(step,quantity-used,true,dish.id));
  }
  }
  // Supplies here are forecasts only; real batches will be integrated with consumption.
  const supplies=new Map<string,{plan:AvailabilityPlan;quantity:bigint;shortages:Shortage[];real:boolean;version?:number}[]>();
  for(const batch of context.realBatches??[]){const list=supplies.get(batch.recipeId)??[];list.push({plan:{id:batch.mealId,title:batch.title,startsAt:batch.startsAt,createdAt:batch.startsAt,cookingEnabled:false,eatingEnabled:false,recipes:[]},quantity:amount(batch.quantity),shortages:[],real:true,version:batch.version});supplies.set(batch.recipeId,list);}
  for(const plan of plans){
    for(const dish of plan.recipes)if(plan.cookingEnabled && amount(dish.cookedServings)>ZERO){
      const batches=supplies.get(dish.recipeId)??[];
      batches.push({plan,quantity:amount(dish.cookedServings),shortages:result[plan.id].shortages.filter(s=>!s.optional&&s.mealRecipeId===dish.id),real:false});
      supplies.set(dish.recipeId,batches);
    }
    for(const dish of plan.recipes){
      const batches=supplies.get(dish.recipeId)??[];
      supplies.set(dish.recipeId,batches);
      if(!plan.eatingEnabled)continue;
      let needed=amount(dish.eatenServings);
      // Fresh portions from this meal first, then oldest earlier supplies.
      const ordered=[...batches.filter(b=>b.plan.id===plan.id),...batches.filter(b=>b.plan.id!==plan.id)];
      for(const batch of ordered){
        const used=batch.quantity<needed?batch.quantity:needed;
        batch.quantity-=used;needed-=used;
        if(used>ZERO && batch.plan.id!==plan.id)result[plan.id].dependencies.push({mealRecipeId:dish.id,mealId:batch.plan.id,title:batch.plan.title,startsAt:batch.plan.startsAt,quantity:display(used),recipeName:dish.name,shortages:batch.shortages,real:batch.real,version:batch.version});
        if(needed===ZERO)break;
      }
      if(needed>ZERO){
        // A cooking deficit already has its ingredient warning. Additional cooking
        // is informative, never an automatic stock reservation or phase activation.
        const additional=needed;
        const ingredients=[...presence(dish,false),...demands(dish,additional,false,uncounted,false).flatMap(({step,quantity})=>{
          const available=before.get(plan.id)!.get(step.ingredientId!)??ZERO;
          return quantity>available?[shortage(step,quantity-available,false,dish.id)]:[];
        })];
        result[plan.id].missingPortions.push({mealRecipeId:dish.id,recipeId:dish.recipeId,name:dish.name,quantity:display(needed),ingredients});
      }
    }
  }
  return result;
}
