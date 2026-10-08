import { Prisma } from "../generated/client.ts";
import { activityInclude, activityView } from "./views.ts";

const readInclude = {
  schedule: true, mealStep: true,
  children: { ...activityInclude.children, include: { schedule: true, mealStep: true } },
} satisfies Prisma.ActivityInclude;

/** Load the common tree once and hydrate kitchen metadata only when present. */
export async function readActivities(tx: Prisma.TransactionClient, userId: string,
  options: Pick<Prisma.ActivityFindManyArgs, "where" | "orderBy" | "take">) {
  const rows = await tx.activity.findMany({ ...options,
    where: { AND: [options.where ?? {}, { userId }] }, include: readInclude });
  // Recurrence ancestry needs only three fields. One owner-scoped join replaces
  // the separate parent/occurrence/series relation queries for the whole page.
  type Ancestry = { parentCalendarId: string | null; originalLocal: string | null; parentOriginalLocal: string | null; id: string; seriesId: string | null; ordinal: bigint | null; seriesRevision: number | null;
    parentSeriesId: string | null; parentOrdinal: bigint | null; parentSeriesRevision: number | null };
  const ancestry = rows.some(row => row.occurrenceId || row.parentId) ? await tx.$queryRaw<Ancestry[]>(Prisma.sql`
    SELECT a.id, parent_schedule."calendarId" AS "parentCalendarId", o."originalLocal", po."originalLocal" AS "parentOriginalLocal", o."seriesId", o.ordinal, s.revision AS "seriesRevision",
      po."seriesId" AS "parentSeriesId", po.ordinal AS "parentOrdinal", ps.revision AS "parentSeriesRevision"
    FROM public.activities a
    LEFT JOIN public.occurrence_overrides o ON o.id = a."occurrenceId" AND o."userId" = a."userId"
    LEFT JOIN public.recurrence_series s ON s.id = o."seriesId" AND s."userId" = o."userId"
    LEFT JOIN public.activities p ON p.id = a."parentId" AND p."userId" = a."userId"
    LEFT JOIN public.activity_schedules parent_schedule ON parent_schedule."activityId"=p.id AND parent_schedule."userId"=p."userId"
    LEFT JOIN public.occurrence_overrides po ON po.id = p."occurrenceId" AND po."userId" = p."userId"
    LEFT JOIN public.recurrence_series ps ON ps.id = po."seriesId" AND ps."userId" = po."userId"
    WHERE a."userId" = ${userId}::uuid AND a.id IN (${Prisma.join(rows.map(row => Prisma.sql`${row.id}::uuid`))})
  `) : [];
  const ancestryById = new Map(ancestry.map(item => [item.id, item]));
  const recipeIds = [...new Set(rows.flatMap(row => [row, ...row.children])
    .flatMap(row => row.mealStep ? [row.mealStep.mealRecipeId] : []))];
  const recipes = recipeIds.length ? await tx.mealRecipe.findMany({ where: { userId, id: { in: recipeIds } },
    select: { id: true, blockId: true, cookedServings: true, ingredientQuantities:true,
      recipeRevision: { select: { baseServings: true, steps: { select: { stepKey: true, quantityForBaseServings: true, ingredientId:true,unitSnapshot:true,optional:true,priorGroup:true,position:true } } } } } }) : [];
  const recipeById = new Map(recipes.map(recipe => [recipe.id, recipe]));
  const ingredientIds = [...new Set(recipes.flatMap(recipe => recipe.recipeRevision.steps.flatMap(step => step.ingredientId ? [step.ingredientId] : [])))];
  const availabilityPreferences = ingredientIds.length ? await tx.ingredientPreference.findMany({
    where: { userId, ingredientId: { in: ingredientIds }, trackingMode: "availability" }, select: { ingredientId: true },
  }) : [];
  const availabilityIds = new Set(availabilityPreferences.map(item => item.ingredientId));
  const mealIds = rows.filter(row => row.kind === "meal").map(row => row.id);
  const blocks = mealIds.length ? await tx.mealBlock.findMany({ where: { userId, activityId: { in: mealIds } },
    select: { activityId: true, completions: activityInclude.mealBlock.select.completions } }) : [];
  const blockById = new Map(blocks.map(block => [block.activityId, block]));
  function mealStep(step: typeof rows[number]["mealStep"]) {
    if (!step) return null;
    const recipe = recipeById.get(step.mealRecipeId);
    if (!recipe) throw new Error("La relación del paso de comida no está disponible.");
    return { ...step, mealRecipe: recipe };
  }
  return rows.map(row => {
    const link = ancestryById.get(row.id);
    return activityView({ ...row,
    occurrence: link?.seriesId && link.ordinal !== null && link.seriesRevision !== null
      ? { originalLocal: link.originalLocal??undefined, seriesId: link.seriesId, ordinal: link.ordinal, series: { revision: link.seriesRevision } } : null,
    parent: row.parentId ? { schedule: link?.parentCalendarId?{calendarId:link.parentCalendarId}:null, occurrence: link?.parentSeriesId && link.parentOrdinal !== null && link.parentSeriesRevision !== null
      ? { originalLocal: link.parentOriginalLocal??undefined, seriesId: link.parentSeriesId, ordinal: link.parentOrdinal, series: { revision: link.parentSeriesRevision } } : null } : null,
    mealStep: mealStep(row.mealStep),
    mealBlock: blockById.get(row.id) ?? null,
    children: row.children.map(child => ({ ...child, mealStep: mealStep(child.mealStep) })) }, availabilityIds);
  });
}
