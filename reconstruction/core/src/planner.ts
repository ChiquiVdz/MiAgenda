import { ingredientAmounts, mealQuantities, amountKey } from "./meal-amounts.ts";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type Activity } from "../generated/client.ts";
import { dateOnly, uuid, type ScheduleInput } from "./contracts.ts";
import { CoreError, invalid } from "./errors.ts";
import { parsePlannerCommand, mealDuration } from "./planner-input.ts";
import { executeOwnerCommand } from "./owner-command.ts";
import { localInstant, localParts } from "./local-time.ts";
import { activityView } from "./views.ts";
import { recipeInclude, recipeView, type RecipeView } from "./recipes.ts";
import { ingredientTracking } from "./ingredient-tracking.ts";
import { projectAvailability, type AvailabilityContext, type MealAvailability } from "./availability.ts";
import { copyPreviousMealWeek, mealWeekIds, mealWeekPreview, weekRange } from "./meal-weeks.ts";
type Tx=Prisma.TransactionClient;
const mealInclude={activity:{include:{schedule:true}},cell:true,completions:{orderBy:[{createdAt:"desc" as const},{id:"desc" as const}],take:1,include:{uses:{where:{reversedAt:null},include:{batch:{include:{recipeRevision:{select:{name:true,version:true}},completion:{select:{createdAt:true,blockId:true}}}}}}}},recipes:{orderBy:{position:"asc" as const},include:{recipeRevision:{include:{steps:{orderBy:{position:"asc" as const}}}},steps:{include:{activity:{include:{schedule:true}}}}}}} satisfies Prisma.MealBlockInclude;
type MealRow=Prisma.MealBlockGetPayload<{include:typeof mealInclude}>;
const mealReadInclude = { ...mealInclude, completions: {
  orderBy: mealInclude.completions.orderBy, take: 1,
  select: { id: true, optionalSteps: true, reversedAt: true },
} } satisfies Prisma.MealBlockInclude;
type MealReadRow = Prisma.MealBlockGetPayload<{ include: typeof mealReadInclude }>;
type PortionSourceRow = { completionId: string; id: string; quantity: string; name: string; version: number; createdAt: Date; mealId: string };
type MealViewRow = Omit<MealRow, "completions"> & { completions: {
  optionalSteps: Prisma.JsonValue; reversedAt: Date | null;
  uses: { id: string; quantity: Prisma.Decimal; batch: { recipeRevision: { name: string; version: number }; completion: { createdAt: Date; blockId: string } } }[];
}[] };
async function hydratePortionSources(tx: Tx, userId: string, rows: MealReadRow[]): Promise<MealViewRow[]> {
  const completionIds = rows.flatMap(row => row.completions.filter(item => !item.reversedAt).map(item => item.id));
  // Source information is a small read projection. Avoid fetching the full
  // batch and its completion as separate relation trees for every meal.
  const sources = completionIds.length ? await tx.$queryRaw<PortionSourceRow[]>(Prisma.sql`
    SELECT u."completionId", u.id, u.quantity::text AS quantity, r.name, r.version,
      c."createdAt", c."blockId" AS "mealId"
    FROM public.portion_uses u
    JOIN public.cooked_batches b ON b.id = u."batchId" AND b."userId" = u."userId"
    JOIN public.recipe_revisions r ON r.id = b."recipeRevisionId" AND r."userId" = b."userId"
    JOIN public.meal_completions c ON c.id = b."completionId" AND c."userId" = b."userId"
    WHERE u."userId" = ${userId}::uuid AND u."reversedAt" IS NULL
      AND u."completionId" IN (${Prisma.join(completionIds.map(id => Prisma.sql`${id}::uuid`))})
  `) : [];
  const byCompletion = new Map<string, MealViewRow["completions"][number]["uses"]>();
  for (const source of sources) {
    const uses = byCompletion.get(source.completionId) ?? [];
    uses.push({ id: source.id, quantity: new Prisma.Decimal(source.quantity), batch: {
      recipeRevision: { name: source.name, version: source.version },
      completion: { createdAt: source.createdAt, blockId: source.mealId },
    } });
    byCompletion.set(source.completionId, uses);
  }
  return rows.map(row => ({ ...row, completions: row.completions.map(item => ({ ...item, uses: byCompletion.get(item.id) ?? [] })) }));
}
function mealView(row:MealViewRow, availabilityIds: ReadonlySet<string> = new Set()) {
  // The frozen revisions and step activities are already loaded for the editor.
  // Reuse them to build the common activity card instead of fetching them again.
  const children = row.recipes.flatMap(recipe => recipe.steps
    .filter(step => step.activity.lifecycle === "active")
    .map(step => ({ ...step.activity, mealStep: { ...step, mealRecipe: {
      blockId: row.activityId, cookedServings: recipe.cookedServings, ingredientQuantities:recipe.ingredientQuantities,
      recipeRevision: recipe.recipeRevision,
    } } })))
    .sort((a,b) => a.position - b.position || a.id.localeCompare(b.id));
  const activity = activityView({ ...row.activity, children, occurrence: null,
    parent: null, mealStep: null, mealBlock: { completions: row.completions } }, availabilityIds);
  return {id:row.activityId,revision:row.activity.revision,title:row.activity.title,activity,completedAt:row.activity.completedAt?.toISOString()??null,portionSources:row.completions.filter(completion=>!completion.reversedAt).flatMap(completion=>completion.uses.map(use=>({id:use.id,quantity:use.quantity.toString(),name:use.batch.recipeRevision.name,version:use.batch.recipeRevision.version,createdAt:use.batch.completion.createdAt.toISOString(),mealId:use.batch.completion.blockId}))),date:row.cell!.planningDate.toISOString().slice(0,10),slotId:row.cell!.slotId,schedule:activity.schedule!,cookingEnabled:row.cookingEnabled,eatingEnabled:row.eatingEnabled,washingEnabled:row.washingEnabled,eatingMinutes:row.eatingMinutes,washingMinutes:row.washingMinutes,cookingMinutesOverride:row.cookingMinutesOverride,durationMinutesOverride:row.durationMinutesOverride,
  recipes:row.recipes.map(item=>({id:item.id,recipeRevisionId:item.recipeRevisionId,recipeId:item.recipeRevision.recipeId,version:item.recipeRevision.version,name:item.recipeRevision.name,baseServings:item.recipeRevision.baseServings!.toString(),cookingMinutes:item.recipeRevision.cookingMinutes!,cookedServings:item.cookedServings.toString(),eatenServings:item.eatenServings.toString(),cookingMinutesOverride:item.cookingMinutesOverride,ingredientQuantities:mealQuantities(item.ingredientQuantities),steps:item.recipeRevision.steps.map(step=>({stepKey:step.stepKey,text:step.text,optional:step.optional,ingredientId:step.ingredientId,ingredientName:step.ingredientNameSnapshot,unit:step.unitSnapshot,quantity:step.quantityForBaseServings?.toString()??null,equivalent:step.equivalent,minutesBefore:step.minutesBefore,priorTitle:step.priorTitle,priorGroup:step.priorGroup})),reminders:item.steps.filter(step=>(step.role==="priorReminder" || step.role==="preparation" && item.recipeRevision.steps.some(source=>source.stepKey===step.sourceStepKey && source.priorGroup)) && step.activity.lifecycle==="active").map(step=>({id:step.activityId,stepKey:step.sourceStepKey,completedAt:step.activity.completedAt?.toISOString()??null,manual:step.scheduleManuallyAdjusted,schedule:step.activity.schedule?{startsAt:step.activity.schedule.startsAt!.toISOString(),endsAt:step.activity.schedule.endsAt!.toISOString()}:null}))}))}; }
export type MealView=ReturnType<typeof mealView>;
export type SlotView={id:string;name:string;position:number;startMinute:number;revision:number};
export type PlannerSnapshot={initialized:boolean;dataRevision:string;timeZone:string;eatingMinutes:number;washingMinutes:number;calendarId:string|null;slots:SlotView[];meals:MealView[];start:string;days:number;availability:Record<string,MealAvailability>;resources:AvailabilityContext;readyRecipes:RecipeView[]};
async function retireMeals(tx:Tx,userId:string,roots:string[]) {
  const children=await tx.activity.findMany({where:{userId,parentId:{in:roots},lifecycle:"active"},select:{id:true}}),ids=[...roots,...children.map(item=>item.id)];
  await tx.mealCell.deleteMany({where:{blockId:{in:roots},userId}});
  await tx.activitySchedule.deleteMany({where:{userId,activityId:{in:ids}}});
  await tx.activity.updateMany({where:{userId,id:{in:ids}},data:{lifecycle:"retired",title:"",description:null,keep:false,highlighted:false}});
  return ids;
}
export async function retireMeal(tx:Tx,userId:string,id:string) { return retireMeals(tx,userId,[id]); }
export async function moveMeal(tx:Tx,userId:string,row:Activity,schedule:ScheduleInput) {
  if(schedule.mode!=="timed") throw new CoreError("DEPENDENCY","Las comidas necesitan hora de inicio y fin.");
  const cell=await tx.mealCell.findFirst({where:{blockId:row.id,userId}}),calendar=await tx.calendar.findFirst({where:{id:schedule.calendarId,userId,moduleKey:"kitchen"}});
  if(!cell || !calendar) throw new CoreError("DEPENDENCY","La comida debe permanecer en el calendario Cocina.");
  const date=localParts(schedule.startsAt,schedule.timeZone).date;
  if(await tx.mealCell.findFirst({where:{userId,slotId:cell.slotId,planningDate:new Date(`${date}T00:00:00Z`),blockId:{not:row.id}}})) throw new CoreError("CONFLICT","Ya hay una comida en esa fila y fecha. Combina sus recetas desde Planificar.");
  const duration=(Date.parse(schedule.endsAt)-Date.parse(schedule.startsAt))/60000;
  if(!Number.isInteger(duration)||duration<1||duration>12960) invalid("Duración de comida inválida.");
  await tx.mealCell.update({where:{blockId:row.id},data:{planningDate:new Date(`${date}T00:00:00Z`)}});
  await tx.mealBlock.update({where:{activityId:row.id},data:{durationMinutesOverride:duration}});
  await tx.activitySchedule.update({where:{activityId:row.id},data:{mode:"timed",timeZone:schedule.timeZone,startsAt:new Date(schedule.startsAt),endsAt:new Date(schedule.endsAt)}});
}
export class PlannerService {
  private readonly db:PrismaClient;
  constructor(db:PrismaClient){this.db=db;}
  async cell(owner:string,dateValue:string,slotValue:string){
    const userId=uuid(owner),date=dateOnly(dateValue),slotId=uuid(slotValue);
    const row=await this.db.mealBlock.findFirst({where:{userId,activity:{is:{lifecycle:"active"}},cell:{is:{slotId,planningDate:new Date(`${date}T00:00:00Z`)}}},include:mealInclude});
    const preferences = row ? await this.db.ingredientPreference.findMany({ where: { userId, trackingMode: "availability" }, select: { ingredientId: true } }) : [];
    return {meal:row?mealView(row,new Set(preferences.map(item=>item.ingredientId))):null};
  }
  async snapshot(owner:string,startValue:string,days=7,localDownload=false):Promise<PlannerSnapshot>{
    const userId=uuid(owner),start=dateOnly(startValue); if(days!==7 && days!==14 && !(localDownload && days===42)) invalid("Elige una o dos semanas."); const end=new Date(`${start}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+days);
    return this.db.$transaction(async tx=>{
      const user=await tx.user.findUniqueOrThrow({where:{id:userId}}),calendar=await tx.calendar.findFirst({where:{userId,moduleKey:"kitchen"},select:{id:true}}),slots=await tx.mealSlot.findMany({where:{userId,retiredAt:null},orderBy:[{position:"asc"},{id:"asc"}]});
      const page=await tx.mealBlock.findMany({where:{userId,activity:{is:{lifecycle:"active"}},cell:{is:{planningDate:{gte:new Date(`${start}T00:00:00Z`),lt:end}}}},include:mealReadInclude});
      const rows=await hydratePortionSources(tx,userId,page);
      // One coherent projection over every pending plan, independent of visible dates/calendars.
      const plans=await tx.mealBlock.findMany({where:{userId,activity:{is:{lifecycle:"active",completedAt:null}},cell:{isNot:null}},select:{activityId:true,cookingEnabled:true,eatingEnabled:true,activity:{select:{title:true,createdAt:true,schedule:{select:{startsAt:true}}}},recipes:{orderBy:{position:"asc"},select:{id:true,cookedServings:true,eatenServings:true,ingredientQuantities:true,recipeRevision:{select:{recipeId:true,name:true,baseServings:true,steps:{select:{stepKey:true,ingredientId:true,ingredientNameSnapshot:true,unitSnapshot:true,quantityForBaseServings:true,optional:true}}}}}}}});
      const balances=await tx.pantryBalance.findMany({where:{userId,quantity:{gt:0}},select:{ingredientId:true,quantity:true}});
      const definitions=await tx.recipe.findMany({where:{userId,retiredAt:null},include:recipeInclude});
      const resources:AvailabilityContext={tracking:await ingredientTracking(tx,userId),balances:balances.map(row=>({ingredientId:row.ingredientId,quantity:row.quantity.toString()})),plans:plans.map(plan=>({id:plan.activityId,title:plan.activity.title,createdAt:plan.activity.createdAt.toISOString(),startsAt:plan.activity.schedule!.startsAt!.toISOString(),cookingEnabled:plan.cookingEnabled,eatingEnabled:plan.eatingEnabled,recipes:plan.recipes.map(dish=>({id:dish.id,recipeId:dish.recipeRevision.recipeId,name:dish.recipeRevision.name,baseServings:dish.recipeRevision.baseServings!.toString(),cookedServings:dish.cookedServings.toString(),eatenServings:dish.eatenServings.toString(),ingredientQuantities:mealQuantities(dish.ingredientQuantities),steps:dish.recipeRevision.steps.map(step=>({stepKey:step.stepKey,ingredientId:step.ingredientId,ingredientName:step.ingredientNameSnapshot,unit:step.unitSnapshot,quantity:step.quantityForBaseServings?.toString()??null,optional:step.optional}))}))}))};
      type BatchProjection = Omit<NonNullable<AvailabilityContext["realBatches"]>[number], "startsAt"> & { createdAt: Date };
      // Aggregate consumption at the database. Fully used batches and their
      // historical PortionUse rows do not need to travel to the server/client.
      const batches = await tx.$queryRaw<BatchProjection[]>(Prisma.sql`
        SELECT b.id, c."blockId" AS "mealId", COALESCE(NULLIF(a.title, ''), r.name) AS title,
          b."createdAt", r."recipeId", r.name AS "recipeName", r.version,
          (b.quantity - COALESCE(used.quantity, 0))::text AS quantity
        FROM public.cooked_batches b
        JOIN public.recipe_revisions r ON r.id = b."recipeRevisionId" AND r."userId" = b."userId"
        JOIN public.meal_completions c ON c.id = b."completionId" AND c."userId" = b."userId"
        JOIN public.activities a ON a.id = c."blockId" AND a."userId" = b."userId"
        LEFT JOIN LATERAL (SELECT SUM(u.quantity) AS quantity FROM public.portion_uses u
          WHERE u."batchId" = b.id AND u."userId" = b."userId" AND u."reversedAt" IS NULL) used ON true
        WHERE b."userId" = ${userId}::uuid AND b."revokedAt" IS NULL
          AND b.quantity > COALESCE(used.quantity, 0)
        ORDER BY b."createdAt" ASC, b.id ASC
      `);
      resources.realBatches=batches.map(({createdAt,...batch})=>({...batch,startsAt:createdAt.toISOString(),quantity:new Prisma.Decimal(batch.quantity).toString()}));
      const availabilityIds = new Set(resources.tracking?.filter(item=>item.mode==="availability").map(item=>item.ingredientId));
      return {initialized:user.kitchenInitialized,dataRevision:user.dataRevision.toString(),timeZone:user.timeZone,eatingMinutes:user.eatingMinutes,washingMinutes:user.washingMinutes,calendarId:calendar?.id??null,slots:slots.map(({id,name,position,startMinute,revision})=>({id,name,position,startMinute,revision})),meals:rows.map(row=>mealView(row,availabilityIds)),start,days,resources,availability:projectAvailability(resources),readyRecipes:definitions.map(recipeView).filter(recipe=>!recipe.draft)};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:15000});
  }
  async slotImpact(owner:string,idValue:string,destinationValue?:string){ const userId=uuid(owner),id=uuid(idValue),destinationId=destinationValue?uuid(destinationValue):null;
    return this.db.$transaction(async tx=>{
      const slot=await tx.mealSlot.findFirst({where:{id,userId,retiredAt:null}}); if(!slot) throw new CoreError("NOT_FOUND","La fila ya no está disponible.");
      if(destinationId && !await tx.mealSlot.findFirst({where:{id:destinationId,userId,retiredAt:null}})) invalid("Elige una fila disponible.");
      const cells=await tx.mealCell.findMany({where:{userId,slotId:id},include:{block:{include:{activity:{select:{title:true}}}}},orderBy:{planningDate:"asc"}}),user=await tx.user.findUniqueOrThrow({where:{id:userId},select:{dataRevision:true}});
      const collisions=destinationId?await tx.mealCell.findMany({where:{userId,slotId:destinationId,planningDate:{in:cells.map(cell=>cell.planningDate)}},select:{planningDate:true}}):[];
      return {revision:slot.revision,dataRevision:user.dataRevision.toString(),count:cells.length,examples:cells.slice(0,10).map(cell=>({date:cell.planningDate.toISOString().slice(0,10),title:cell.block.activity.title})),collisions:collisions.map(cell=>cell.planningDate.toISOString().slice(0,10))};
    },{isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead});
  }
  async weekPreview(owner:string,start:string,mode:string) {
    const userId=uuid(owner); weekRange(start);
    if(mode!=="copy" && mode!=="delete") invalid("Elige copiar o borrar una semana.");
    return this.db.$transaction(tx=>mealWeekPreview(tx,userId,start,mode),
      {isolationLevel:Prisma.TransactionIsolationLevel.RepeatableRead,maxWait:10000,timeout:15000});
  }
  async execute(owner:string,raw:unknown){const command=parsePlannerCommand(raw);
    return executeOwnerCommand(this.db,owner,command,async(tx,userId)=>{
      const user=await tx.user.findUniqueOrThrow({where:{id:userId}});
      if("weekAction" in command) {
        if(!user.kitchenInitialized) invalid("Abre primero Cocina para preparar el planificador.");
        if(user.dataRevision.toString()!==command.expectedDataRevision)
          throw new CoreError("CONFLICT","La planificación o Alacena cambió. Actualiza la revisión de la semana antes de confirmar.");
        let count=0;
        if(command.weekAction==="copy") count=await copyPreviousMealWeek(tx,userId,command.start,command.reminders);
        else {const ids=await mealWeekIds(tx,userId,command.start);count=ids.length;if(count)await retireMeals(tx,userId,ids);}
        const updated=await tx.user.findUniqueOrThrow({where:{id:userId},select:{dataRevision:true}});
        return {changed:true,dataRevision:updated.dataRevision.toString(),weekAction:command.weekAction,count};
      } else if(command.action==="initializeKitchen"){
        if(!user.kitchenInitialized){
          let calendar=await tx.calendar.findFirst({where:{userId,moduleKey:"kitchen"}});
          if(!calendar) calendar=await tx.calendar.create({data:{id:randomUUID(),userId,name:"Cocina",color:"#b77936",moduleKey:"kitchen",preference:{create:{visible:true}}}});
          for(const [position,[name,startMinute]] of ([ ["Desayuno",480],["Comida",840],["Cena",1200] ] as const).entries()) await tx.mealSlot.create({data:{id:randomUUID(),userId,name,startMinute,position}});
          await tx.user.update({where:{id:userId},data:{kitchenInitialized:true}});
        }
      } else if("recipes" in command){
        if(!user.kitchenInitialized) invalid("Abre primero el planificador para preparar Cocina.");
        const current=await tx.mealBlock.findFirst({where:{activityId:command.id,userId,activity:{is:{lifecycle:"active"}}},include:mealInclude});
        if(current?.activity.completedAt)throw new CoreError("DEPENDENCY","Deshaz primero esta comida para cambiar recetas, fases o porciones. Sus consumos reales se conservan.");
        if(command.expectedRevision===null ? !!current : !current || current.activity.revision!==command.expectedRevision) throw new CoreError("CONFLICT","La comida cambió. Cierra y vuelve a abrir para revisar la versión actual.");
        const slot=await tx.mealSlot.findFirst({where:{id:command.slotId,userId,retiredAt:null}}),calendar=await tx.calendar.findFirst({where:{userId,moduleKey:"kitchen"}}); if(!slot||!calendar) invalid("Elige una fila disponible.");
        const date=new Date(`${command.date}T00:00:00Z`);
        if(await tx.mealCell.findFirst({where:{userId,slotId:slot.id,planningDate:date,blockId:{not:command.id}}})) throw new CoreError("CONFLICT","Esa celda ya tiene una comida. Edita ese bloque para agregar recetas.");
        const versions=await tx.recipeRevision.findMany({where:{userId,id:{in:command.recipes.map(item=>item.recipeRevisionId)},draft:false},include:{steps:{orderBy:{position:"asc"}},recipe:true}});
        if (versions.some(version => !version.baseServings || !version.cookingMinutes || !version.steps.length || !version.steps.some(step => step.ingredientId))) throw new CoreError("DEPENDENCY", "La receta es un borrador: necesita porciones, tiempo, pasos y al menos un ingrediente.");
        for(const item of command.recipes){const version=versions.find(v=>v.id===item.recipeRevisionId); if(!version || (!current?.recipes.some(old=>old.recipeRevisionId===version.id) && version.recipe.retiredAt)) throw new CoreError("DEPENDENCY","Una receta está retirada o es borrador. Elige una receta lista."); const stored=await tx.mealRecipe.findUnique({where:{id:item.id},select:{userId:true,blockId:true}}); if(stored && (stored.userId!==userId || stored.blockId!==command.id)) invalid("Una receta de bloque no puede trasladarse entre comidas."); }
        const recipeIdentities=command.recipes.map(item=>versions.find(version=>version.id===item.recipeRevisionId)!.recipeId);
        if(new Set(recipeIdentities).size!==recipeIdentities.length) invalid("La misma receta ya está en el bloque. Cambia sus porciones o quita la repetida.");
        if(!command.cookingEnabled && command.reminders.length) invalid("Las preparaciones previas solo se agendan al cocinar.");
        const times=command.recipes.filter(item=>item.cookedServings!=="0").map(item=>item.cookingMinutesOverride??versions.find(v=>v.id===item.recipeRevisionId)!.cookingMinutes!),duration=mealDuration(command,times);
        if(duration.total<1 || duration.total>12960) invalid("Activa una fase con duración positiva. El bloque admite hasta nueve días.");
        const startsAt=localInstant(command.date,command.time,user.timeZone),endsAt=new Date(Date.parse(startsAt)+duration.total*60000);
        const title=command.recipes.map(item=>versions.find(v=>v.id===item.recipeRevisionId)!.name).join(" + ").slice(0,250);
        if(!current) await tx.activity.create({data:{id:command.id,userId,kind:"meal",title}});
        else await tx.activity.update({where:{id:command.id},data:{title,revision:{increment:1}}});
        const phases={cookingEnabled:command.cookingEnabled,eatingEnabled:command.eatingEnabled,washingEnabled:command.washingEnabled,eatingMinutes:command.eatingMinutes,washingMinutes:command.washingMinutes,cookingMinutesOverride:command.cookingMinutesOverride,durationMinutesOverride:null};
        await tx.mealBlock.upsert({where:{activityId:command.id},create:{activityId:command.id,userId,...phases},update:phases});
        await tx.mealCell.upsert({where:{blockId:command.id},create:{blockId:command.id,userId,slotId:slot.id,planningDate:date},update:{slotId:slot.id,planningDate:date}});
        await tx.activitySchedule.upsert({where:{activityId:command.id},create:{activityId:command.id,userId,calendarId:calendar.id,timeZone:user.timeZone,mode:"timed",startsAt:new Date(startsAt),endsAt},update:{calendarId:calendar.id,timeZone:user.timeZone,startsAt:new Date(startsAt),endsAt}});
        const kept=new Set<string>(),itemIds=new Set(command.recipes.map(item=>item.id));
        const newActivities:Prisma.ActivityCreateManyInput[]=[],newSteps:Prisma.MealStepDataCreateManyInput[]=[],newSchedules:Prisma.ActivityScheduleCreateManyInput[]=[];
        for(const [position,item] of command.recipes.entries()){
          const version=versions.find(v=>v.id===item.recipeRevisionId)!;
          const old=current?.recipes.find(old=>old.id===item.id);
          const chosen=item.ingredientQuantities ?? (old ? mealQuantities(old.ingredientQuantities) : {});
          const amountSteps=version.steps.map(step=>({stepKey:step.stepKey,ingredientId:step.ingredientId,ingredientName:step.ingredientNameSnapshot,unit:step.unitSnapshot,quantity:step.quantityForBaseServings?.toString()??null,optional:step.optional}));
          const allowedKeys=new Set(amountSteps.filter(step=>step.ingredientId&&step.quantity).map(step=>amountKey(step.ingredientId!,step.optional)));
          if(Object.keys(chosen??{}).some(key=>!allowedKeys.has(key))) invalid("Una cantidad no pertenece a los ingredientes de esta receta. Revisa el plan.");
          for(const amount of ingredientAmounts(amountSteps,version.baseServings!.toString(),item.cookedServings,chosen)) if(new Prisma.Decimal(amount.quantity).gt("999999999.999")) invalid("La cantidad planeada excede el máximo de Alacena.");
          const data={recipeRevisionId:version.id,position,cookedServings:item.cookedServings,eatenServings:item.eatenServings,cookingMinutesOverride:item.cookingMinutesOverride,ingredientQuantities:chosen===null?Prisma.DbNull:chosen};
          await tx.mealRecipe.upsert({where:{id:item.id},create:{id:item.id,userId,blockId:command.id,...data},update:data});
          for(const step of version.steps){
            for(const role of ["preparation","priorReminder"] as const){
              const reminder=command.reminders.find(r=>r.mealRecipeId===item.id && r.stepKey===step.stepKey),previous=old?.steps.find(s=>s.sourceStepKey===step.stepKey && s.role===role);
              if(!command.cookingEnabled || item.cookedServings==="0" || (role==="priorReminder" && (step.priorGroup || !step.minutesBefore || !reminder))) continue;
              const scheduledPrior=role==="priorReminder" || (role==="preparation" && step.priorGroup && !!reminder);
              const activityId=previous?.activityId??randomUUID(),stepTitle=(role==="priorReminder"?step.priorTitle!:step.text).slice(0,250);
              const stepPosition=position*120+step.position*2+(role==="priorReminder"?1:0);
              if(previous) {
                if(previous.activity.lifecycle!=="active" || previous.activity.position!==stepPosition || (old!.recipeRevisionId!==version.id && previous.activity.title!==stepTitle)) await tx.activity.update({where:{id:activityId},data:{...(old!.recipeRevisionId!==version.id?{title:stepTitle}:{}),position:stepPosition,lifecycle:"active"}});
              } else newActivities.push({id:activityId,userId,parentId:command.id,title:stepTitle,description:version.name,position:stepPosition});
              kept.add(activityId);
              const metadata={mealRecipeId:item.id,sourceStepKey:step.stepKey,role,ingredientId:role==="preparation"?step.ingredientId:null,ingredientNameSnapshot:role==="preparation"?step.ingredientNameSnapshot:null,unitSnapshot:role==="preparation"?step.unitSnapshot:null,quantityPerServing:role==="preparation" && step.quantityForBaseServings?step.quantityForBaseServings.div(version.baseServings!).toDecimalPlaces(9).toString():null,equivalent:role==="preparation"?step.equivalent:null,optional:step.optional,suggestedMinutesBefore:step.minutesBefore,scheduleManuallyAdjusted:scheduledPrior?reminder!.manual:false};
              if(!previous) newSteps.push({activityId,userId,...metadata});
              else if(old!.recipeRevisionId!==version.id || previous.scheduleManuallyAdjusted!==metadata.scheduleManuallyAdjusted) await tx.mealStepData.update({where:{activityId},data:metadata});
              if(scheduledPrior){
                // Preserve completed preparations and their original schedule when moving a meal.
                if(!previous?.activity.completedAt) {
                  const schedule=previous?.activity.schedule;
                  if(!schedule) newSchedules.push({activityId,userId,calendarId:calendar.id,timeZone:user.timeZone,mode:"timed",startsAt:new Date(reminder!.startsAt),endsAt:new Date(reminder!.endsAt)});
                  else if(schedule.startsAt?.toISOString()!==reminder!.startsAt || schedule.endsAt?.toISOString()!==reminder!.endsAt) await tx.activitySchedule.update({where:{activityId},data:{mode:"timed",startDate:null,endDate:null,startsAt:new Date(reminder!.startsAt),endsAt:new Date(reminder!.endsAt)}});
                }
              } else if(role==="preparation" && previous?.activity.schedule && !previous.activity.completedAt) {
                await tx.activity.update({where:{id:activityId},data:{keep:false,highlighted:false}});
                await tx.activitySchedule.deleteMany({where:{userId,activityId}});
              }
            }
          }
        }
        if(newActivities.length) await tx.activity.createMany({data:newActivities});
        if(newSteps.length) await tx.mealStepData.createMany({data:newSteps});
        if(newSchedules.length) await tx.activitySchedule.createMany({data:newSchedules});
        const obsolete=current?.recipes.flatMap(item=>item.steps).filter(step=>!kept.has(step.activityId))??[];
        if(obsolete.length){const ids=obsolete.map(step=>step.activityId);await tx.activitySchedule.deleteMany({where:{userId,activityId:{in:ids}}});await tx.activity.updateMany({where:{userId,id:{in:ids}},data:{lifecycle:"retired",title:"",description:null,keep:false,highlighted:false}});await tx.mealStepData.deleteMany({where:{userId,activityId:{in:ids}}});}
        await tx.mealRecipe.deleteMany({where:{userId,blockId:command.id,id:{notIn:[...itemIds]}}});
        if(command.reminders.some(reminder=>!versions.find(v=>v.id===command.recipes.find(item=>item.id===reminder.mealRecipeId)!.recipeRevisionId)!.steps.some(step=>step.stepKey===reminder.stepKey && step.minutesBefore))) invalid("Preparación previa ajena a la receta.");
      } else if("id" in command){
        if(command.action==="deleteMeal"){
          const row=await tx.activity.findFirst({where:{id:command.id,userId,kind:"meal",lifecycle:"active"}}); if(!row||row.revision!==command.expectedRevision) throw new CoreError("CONFLICT","La comida cambió. Actualiza antes de eliminar."); await retireMeal(tx,userId,row.id);
        } else if("name" in command){
          const row=await tx.mealSlot.findFirst({where:{id:command.id,userId,retiredAt:null}});
          if(command.expectedRevision===null){if(await tx.mealSlot.count({where:{userId,retiredAt:null}})>=20) invalid("Puedes tener hasta 20 filas."); const max=await tx.mealSlot.aggregate({where:{userId},_max:{position:true}});await tx.mealSlot.create({data:{id:command.id,userId,name:command.name,startMinute:command.startMinute,position:(max._max.position??-1)+1}});}
          else {if(!row||row.revision!==command.expectedRevision) throw new CoreError("CONFLICT","La fila cambió. Vuelve a abrirla.");await tx.mealSlot.update({where:{id:row.id},data:{name:command.name,startMinute:command.startMinute}});}
        } else if("destinationId" in command){
          const row=await tx.mealSlot.findFirst({where:{id:command.id,userId,retiredAt:null}}); if(!row||row.revision!==command.expectedRevision||user.dataRevision.toString()!==command.expectedDataRevision) throw new CoreError("CONFLICT","El alcance cambió. Actualiza la revisión antes de eliminar la fila.");
          const cells=await tx.mealCell.findMany({where:{userId,slotId:row.id}});
          if(command.destinationId){if(command.destinationId===row.id||!await tx.mealSlot.findFirst({where:{userId,id:command.destinationId,retiredAt:null}})) invalid("Elige otra fila disponible."); if(await tx.mealCell.count({where:{userId,slotId:command.destinationId,planningDate:{in:cells.map(cell=>cell.planningDate)}}})) throw new CoreError("CONFLICT","Hay fechas ocupadas en el destino. No se pueden combinar bloques automáticamente.");await tx.mealCell.updateMany({where:{userId,slotId:row.id},data:{slotId:command.destinationId}});}
          else await retireMeals(tx,userId,cells.map(cell=>cell.blockId));
          const classified = await tx.recipeMealSlot.findMany({ where: { userId, slotId: row.id }, select: { recipeId: true } });
          await tx.recipeMealSlot.deleteMany({ where: { userId, slotId: row.id } });
          if (classified.length) await tx.recipe.updateMany({ where: { userId, id: { in: classified.map(item => item.recipeId) } }, data: { revision: { increment: 1 } } });
          await tx.mealSlot.update({where:{id:row.id},data:{retiredAt:new Date()}});
        }
      } else if("eatingMinutes" in command){
        if(user.dataRevision.toString()!==command.expectedDataRevision) throw new CoreError("CONFLICT","Los datos cambiaron. Actualiza antes de guardar preferencias.");
        await tx.user.update({where:{id:userId},data:{eatingMinutes:command.eatingMinutes,washingMinutes:command.washingMinutes}});await tx.$executeRaw`SELECT public.miagenda_touch_owner(${userId}::uuid)`;
      }
      const updated=await tx.user.findUniqueOrThrow({where:{id:userId},select:{dataRevision:true}});
      return {changed:true,dataRevision:updated.dataRevision.toString()};
    });
  }
}
