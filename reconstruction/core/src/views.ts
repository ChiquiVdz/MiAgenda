import { mealQuantities } from "./meal-amounts.ts";
import { inventoryIngredientSteps, displayIngredientAmount } from "./meal-amounts-server.ts";
import type { Prisma } from "../generated/client.ts";

export const activityInclude = {
  schedule: true,
  mealStep: { select: { role: true, optional:true, ingredientNameSnapshot:true, unitSnapshot:true, quantityPerServing:true, equivalent:true, sourceStepKey:true, mealRecipe: { select: { blockId: true, cookedServings:true, ingredientQuantities:true, recipeRevision:{select:{baseServings:true,steps:{select:{stepKey:true,quantityForBaseServings:true,ingredientId:true,unitSnapshot:true,optional:true,priorGroup:true,position:true}}}} } } } },
  mealBlock: { select: { completions: { orderBy:[{createdAt:"desc" as const},{id:"desc" as const}],take:1,select:{optionalSteps:true} } } },
  occurrence: { include: { series: { select: { revision: true } } } },
  parent: { select: { schedule:{select:{calendarId:true}}, occurrence: { include: { series: { select: { revision: true } } } } } },
  children: {
    where: { lifecycle: "active" as const },
    orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
    include: { schedule: true, mealStep: { select: { role: true, optional:true, ingredientNameSnapshot:true, unitSnapshot:true, quantityPerServing:true, equivalent:true, sourceStepKey:true, mealRecipe: { select: { blockId: true, cookedServings:true, ingredientQuantities:true, recipeRevision:{select:{baseServings:true,steps:{select:{stepKey:true,quantityForBaseServings:true,ingredientId:true,unitSnapshot:true,optional:true,priorGroup:true,position:true}}}} } } } } },
  },
} satisfies Prisma.ActivityInclude;

type Row = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>;
type ChildRow = Row["children"][number];
type ScheduleRow = NonNullable<Row["schedule"]>;
type OccurrenceViewRow = Pick<NonNullable<Row["occurrence"]>, "seriesId" | "ordinal"> & { originalLocal?: string } & { series: { revision: number } };
type ViewRow = Omit<Row, "occurrence" | "parent"> & {
  occurrence: OccurrenceViewRow | null;
  parent: { schedule?: {calendarId:string} | null; occurrence: OccurrenceViewRow | null } | null;
};

function scheduleView(schedule: ScheduleRow | null) {
  if (!schedule) return null;
  return {
    calendarId: schedule.calendarId,
    mode: schedule.mode,
    timeZone: schedule.timeZone,
    startsAt: schedule.startsAt?.toISOString() ?? null,
    endsAt: schedule.endsAt?.toISOString() ?? null,
    startDate: schedule.startDate?.toISOString().slice(0, 10) ?? null,
    endDate: schedule.endDate?.toISOString().slice(0, 10) ?? null,
  };
}
function itemView(activity: ViewRow | ChildRow, inherited?: OccurrenceViewRow | null, amountsCache=new WeakMap<object,Map<string,string|null>>(), availabilityIds: ReadonlySet<string> = new Set(), parentCalendarId?: string) {
  const occurrence = ("occurrence" in activity ? activity.occurrence : null) ?? ("parent" in activity ? activity.parent?.occurrence : inherited);
  const ingredientStep = activity.mealStep?.mealRecipe.recipeRevision.steps.find(step => step.stepKey === activity.mealStep?.sourceStepKey);
  const baseServings = activity.mealStep?.mealRecipe.recipeRevision.baseServings;
  let ingredientQuantity:string|null=null;
  if(activity.mealStep&&ingredientStep&&baseServings){
    const recipe=activity.mealStep.mealRecipe;
    let amounts=amountsCache.get(recipe.recipeRevision);
    if(!amounts){amounts=new Map(inventoryIngredientSteps(recipe.recipeRevision.steps.map(step=>({stepKey:step.stepKey,ingredientId:step.ingredientId,unit:step.unitSnapshot,optional:step.optional,quantity:step.quantityForBaseServings?.toString()??null})),baseServings.toString(),recipe.cookedServings.toString(),mealQuantities(recipe.ingredientQuantities)).map(step=>[step.stepKey,displayIngredientAmount(step.quantity)]));amountsCache.set(recipe.recipeRevision,amounts);}
    ingredientQuantity=amounts.get(ingredientStep.stepKey)??null;
  }
  return {
    id: activity.id, kind: activity.kind, title: activity.title,
    ...(activity.mealStep ? { mealRole: activity.mealStep.role, mealOptional:activity.mealStep.optional, mealPriorGroup:!!ingredientStep?.priorGroup, mealPriorMember:!!ingredientStep && activity.mealStep.mealRecipe.recipeRevision.steps.some(step=>step.priorGroup && step.position>=ingredientStep.position), mealBlockId: activity.mealStep.mealRecipe.blockId, mealIngredient: activity.mealStep.ingredientNameSnapshot ? { name:activity.mealStep.ingredientNameSnapshot, unit:activity.mealStep.unitSnapshot, quantity:ingredientQuantity, tracksQuantity: !!ingredientStep?.ingredientId && !availabilityIds.has(ingredientStep.ingredientId) && ingredientQuantity !== null && Number(ingredientQuantity) > 0, equivalent:activity.mealStep.equivalent, cookedServings:activity.mealStep.mealRecipe.cookedServings.toString() } : null } : {}),
    ...("mealBlock" in activity && activity.mealBlock ? {lastMealOptionals:Array.isArray(activity.mealBlock.completions[0]?.optionalSteps)?(activity.mealBlock.completions[0].optionalSteps as unknown[]).filter((id):id is string=>typeof id==="string"):[]} : {}),
    description: activity.description, parentId: activity.parentId, parentCalendarId: ("parent" in activity ? activity.parent?.schedule?.calendarId : parentCalendarId),
    position: activity.position, revision: activity.revision,
    stepKeyId: activity.stepKeyId,
    completedAt: activity.completedAt?.toISOString() ?? null,
    keep: activity.keep, highlighted: activity.highlighted,
    createdAt: activity.createdAt.toISOString(), updatedAt: activity.updatedAt.toISOString(),
    schedule: scheduleView(activity.schedule),
    recurrence: occurrence ? {
      seriesId: occurrence.seriesId, ordinal: Number(occurrence.ordinal), seriesRevision: occurrence.series.revision, virtual: false, originalDate: occurrence.originalLocal?.slice(0,10),
    } : null,
  };
}
export function activityView(activity: ViewRow, availabilityIds: ReadonlySet<string> = new Set()) {
  const amountsCache=new WeakMap<object,Map<string,string|null>>();
  return { ...itemView(activity,undefined,amountsCache,availabilityIds), children: activity.children.map(child => itemView(child, activity.occurrence ?? activity.parent?.occurrence,amountsCache,availabilityIds,activity.schedule?.calendarId)) };
}
export type ActivityView = ReturnType<typeof activityView>;
export type CommandResult = {
  baseDataRevision?: string;
  activities: ActivityView[];
  removedIds: string[];
  calendars: { id: string; name: string; color: string; revision: number }[];
  dataRevision: string;
};
