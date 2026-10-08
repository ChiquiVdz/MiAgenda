import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/client.ts";
import { dateOnly } from "./contracts.ts";
import { CoreError, invalid } from "./errors.ts";
import { localInstant, localParts, shiftDate } from "./local-time.ts";

type Tx = Prisma.TransactionClient;
export type CopyReminder = { mealRecipeId: string; stepKey: string; startsAt: string; endsAt: string; manual: boolean };
export function weekRange(value: string) {
  const start = dateOnly(value);
  if (new Date(`${start}T12:00:00Z`).getUTCDay() !== 1) invalid("La semana debe empezar en lunes.");
  return { gte: new Date(`${start}T00:00:00Z`), lt: new Date(`${shiftDate(start, 7)}T00:00:00Z`) };
}
function weekWhere(userId: string, start: string) {
  return { userId, activity: { is: { lifecycle: "active" as const } }, cell: { is: { planningDate: weekRange(start) } } };
}
const sourceInclude = { activity: { include: { schedule: true } }, cell: true,
  recipes: { orderBy: { position: "asc" as const }, include: {
    recipeRevision: { include: { steps: { orderBy: { position: "asc" as const } } } },
  } } } satisfies Prisma.MealBlockInclude;
async function sourceMeals(tx: Tx, userId: string, start: string) {
  return tx.mealBlock.findMany({ where: weekWhere(userId, shiftDate(start, -7)), include: sourceInclude,
    orderBy: [{ cell: { planningDate: "asc" } }, { activityId: "asc" }] });
}
function targetSchedule(meal: Prisma.MealBlockGetPayload<{ include: typeof sourceInclude }>) {
  const schedule = meal.activity.schedule;
  if (!schedule || schedule.mode !== "timed" || !schedule.startsAt || !schedule.endsAt || !meal.cell)
    invalid("Una comida de origen no tiene horario válido. Corrígela antes de copiar.");
  const date = shiftDate(meal.cell.planningDate.toISOString().slice(0, 10), 7);
  const startsAt = localInstant(date, localParts(schedule.startsAt, schedule.timeZone).time, schedule.timeZone);
  return { date, startsAt, endsAt: new Date(Date.parse(startsAt) + schedule.endsAt.getTime() - schedule.startsAt.getTime()).toISOString(), timeZone: schedule.timeZone };
}
export async function mealWeekPreview(tx: Tx, userId: string, start: string, mode: "copy" | "delete") {
  const owner = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { dataRevision: true } });
  const destination = await tx.mealBlock.findMany({ where: weekWhere(userId, start), select: { activityId: true, activity: { select: { completedAt: true } } } });
  const meals = mode === "copy" && !destination.length ? await sourceMeals(tx, userId, start) : [];
  const recipes = new Map<string, { id: string; name: string; count: number; versions: number[] }>();
  const reminders: Array<CopyReminder & { title: string; recipeName: string; mealDate: string; timeZone: string }> = [];
  for (const meal of meals) {
    const schedule = targetSchedule(meal);
    for (const dish of meal.recipes) {
      const version = dish.recipeRevision;
      const summary = recipes.get(version.recipeId) ?? { id: version.recipeId, name: version.name, count: 0, versions: [] };
      summary.count++; if (!summary.versions.includes(version.version)) summary.versions.push(version.version);
      recipes.set(version.recipeId, summary);
      if (meal.cookingEnabled && dish.cookedServings.gt(0)) for (const step of version.steps) if (step.minutesBefore) {
        const startsAt = new Date(Date.parse(schedule.startsAt) - step.minutesBefore * 60000).toISOString();
        reminders.push({ mealRecipeId: dish.id, stepKey: step.stepKey, title: step.priorTitle ?? step.text,
          recipeName: version.name, mealDate: schedule.date, timeZone: schedule.timeZone,
          startsAt, endsAt: new Date(Date.parse(startsAt) + 15 * 60000).toISOString(), manual: false });
      }
    }
  }
  return { start, mode, dataRevision: owner.dataRevision.toString(), destinationCount: destination.length,
    completedCount: destination.filter(row => row.activity.completedAt).length, copyCount: meals.length,
    recipes: [...recipes.values()].sort((a,b) => a.name.localeCompare(b.name, "es")), reminders };
}
export type MealWeekPreview = Awaited<ReturnType<typeof mealWeekPreview>>;

/** Runs inside the common owner lock/receipt transaction. No stock or consumption writes. */
export async function copyPreviousMealWeek(tx: Tx, userId: string, start: string, reminders: CopyReminder[]) {
  if (await tx.mealBlock.count({ where: weekWhere(userId, start) }))
    throw new CoreError("CONFLICT", "La semana de destino ya tiene comidas. Solo se puede copiar a una semana vacía.");
  const sources = await sourceMeals(tx, userId, start);
  if (!sources.length) { if(reminders.length) invalid("No hay comidas de origen para esas preparaciones."); return 0; }
  const calendar = await tx.calendar.findFirst({ where: { userId, moduleKey: "kitchen" }, select: { id: true } });
  if (!calendar) invalid("Abre primero Cocina para preparar su calendario.");
  const activeSlots = new Set((await tx.mealSlot.findMany({ where: { userId, retiredAt: null }, select: { id: true } })).map(row => row.id));
  const activities: Prisma.ActivityCreateManyInput[] = [], blocks: Prisma.MealBlockCreateManyInput[] = [],
    cells: Prisma.MealCellCreateManyInput[] = [], dishes: Prisma.MealRecipeCreateManyInput[] = [],
    children: Prisma.ActivityCreateManyInput[] = [], steps: Prisma.MealStepDataCreateManyInput[] = [],
    schedules: Prisma.ActivityScheduleCreateManyInput[] = [];
  const accepted = new Set<string>();
  for (const meal of sources) {
    if (!activeSlots.has(meal.cell!.slotId)) invalid("Una fila del origen ya no está disponible. Actualiza antes de copiar.");
    const id = randomUUID(), schedule = targetSchedule(meal);
    activities.push({ id, userId, kind: "meal", title: meal.activity.title, description: meal.activity.description });
    blocks.push({ activityId: id, userId, cookingEnabled: meal.cookingEnabled, eatingEnabled: meal.eatingEnabled,
      washingEnabled: meal.washingEnabled, eatingMinutes: meal.eatingMinutes, washingMinutes: meal.washingMinutes,
      cookingMinutesOverride: meal.cookingMinutesOverride, durationMinutesOverride: meal.durationMinutesOverride });
    cells.push({ blockId: id, userId, slotId: meal.cell!.slotId, planningDate: new Date(`${schedule.date}T00:00:00Z`) });
    schedules.push({ activityId: id, userId, calendarId: calendar.id, mode: "timed", timeZone: schedule.timeZone,
      startsAt: new Date(schedule.startsAt), endsAt: new Date(schedule.endsAt) });
    for (const dish of meal.recipes) {
      const dishId = randomUUID(), version = dish.recipeRevision;
      if (version.draft || !version.baseServings || !version.cookingMinutes || !version.steps.some(step => step.ingredientId))
        invalid("Una versión de receta del origen no está lista para planificar.");
      dishes.push({ id: dishId, userId, blockId: id, recipeRevisionId: version.id, position: dish.position,
        cookedServings: dish.cookedServings, eatenServings: dish.eatenServings, cookingMinutesOverride: dish.cookingMinutesOverride, ingredientQuantities:dish.ingredientQuantities??{} });
      if (!meal.cookingEnabled || !dish.cookedServings.gt(0)) continue;
      for (const step of version.steps) for (const role of ["preparation", "priorReminder"] as const) {
        const reminder = reminders.find(row => row.mealRecipeId === dish.id && row.stepKey === step.stepKey);
        if (role === "priorReminder" && (step.priorGroup || !step.minutesBefore || !reminder)) continue;
        const scheduledPrior = role === "priorReminder" || (role === "preparation" && step.priorGroup && !!reminder);
        const activityId = randomUUID();
        children.push({ id: activityId, userId, parentId: id, title: (role === "priorReminder" ? step.priorTitle! : step.text).slice(0,250),
          description: version.name, position: dish.position * 120 + step.position * 2 + (role === "priorReminder" ? 1 : 0) });
        steps.push({ activityId, userId, mealRecipeId: dishId, sourceStepKey: step.stepKey, role, optional: step.optional,
          ingredientId: role === "preparation" ? step.ingredientId : null,
          ingredientNameSnapshot: role === "preparation" ? step.ingredientNameSnapshot : null,
          unitSnapshot: role === "preparation" ? step.unitSnapshot : null,
          quantityPerServing: role === "preparation" && step.quantityForBaseServings ? step.quantityForBaseServings.div(version.baseServings).toDecimalPlaces(9).toString() : null,
          equivalent: role === "preparation" ? step.equivalent : null, suggestedMinutesBefore: step.minutesBefore,
          scheduleManuallyAdjusted: scheduledPrior ? reminder!.manual : false });
        if (scheduledPrior) {
          accepted.add(`${dish.id}:${step.stepKey}`);
          schedules.push({ activityId, userId, calendarId: calendar.id, mode: "timed", timeZone: schedule.timeZone,
            startsAt: new Date(reminder!.startsAt), endsAt: new Date(reminder!.endsAt) });
        }
      }
    }
  }
  if (accepted.size !== reminders.length) invalid("Una preparación previa no pertenece a las comidas que se copiarán.");
  // Bounded statements avoid PostgreSQL parameter limits for long recipes.
  for (let i=0;i<activities.length;i+=500) await tx.activity.createMany({ data: activities.slice(i,i+500) });
  for (let i=0;i<blocks.length;i+=500) await tx.mealBlock.createMany({ data: blocks.slice(i,i+500) });
  for (let i=0;i<cells.length;i+=500) await tx.mealCell.createMany({ data: cells.slice(i,i+500) });
  for (let i=0;i<dishes.length;i+=500) await tx.mealRecipe.createMany({ data: dishes.slice(i,i+500) });
  for (let i=0;i<children.length;i+=500) await tx.activity.createMany({ data: children.slice(i,i+500) });
  for (let i=0;i<steps.length;i+=500) await tx.mealStepData.createMany({ data: steps.slice(i,i+500) });
  for (let i=0;i<schedules.length;i+=500) await tx.activitySchedule.createMany({ data: schedules.slice(i,i+500) });
  return sources.length;
}
export async function mealWeekIds(tx: Tx, userId: string, start: string) {
  return (await tx.mealBlock.findMany({ where: weekWhere(userId, start), select: { activityId: true } })).map(row => row.activityId);
}
