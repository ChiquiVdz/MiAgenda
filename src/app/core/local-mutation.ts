import type { LocalCopy } from "./local-contract";
import type { ActivityView, CommandResult } from "../../../reconstruction/core/src/views";
import type { RecipeView } from "../../../reconstruction/core/src/recipes";
import { atTime } from "./dates";

/** Apply only complete, revision-fenced deltas. Kitchen/series projections
 * deliberately fall back to a server snapshot instead of guessing their rules. */
export function localMutation(copy: LocalCopy, command: Record<string, unknown>, result: CommandResult & { replayed?: boolean; item?: RecipeView; removedId?: string }) : LocalCopy | null {
  if (result.replayed || result.baseDataRevision !== copy.dataRevision || typeof result.dataRevision !== "string") return null;
  const dataRevision = result.dataRevision;
  const next: LocalCopy = { ...copy, dataRevision, savedAt: new Date().toISOString(),
    inbox: { ...copy.inbox, dataRevision }, agenda: { ...copy.agenda, dataRevision }, highlighted: { ...copy.highlighted, dataRevision },
    pantry: { ...copy.pantry, dataRevision }, recipes: { ...copy.recipes, dataRevision }, shopping: { ...copy.shopping, dataRevision }, planners: copy.planners.map(item => ({ ...item, dataRevision })) };
  if (["createRecipe", "editRecipe", "retireRecipe"].includes(String(command.action))) {
    if (!result.item && !result.removedId) return null;
    next.recipes.items = copy.recipes.items.filter(item => item.id !== (result.item?.id ?? result.removedId));
    if (result.item) next.recipes.items.push(result.item);
    next.recipes.items.sort((a, b) => a.id.localeCompare(b.id));
    next.planners = next.planners.map(item => ({ ...item, readyRecipes: next.recipes.items.filter(recipe => !recipe.draft) }));
    const used = new Set(result.item?.steps.map(step => step.ingredientId).filter(Boolean));
    // Recipe revisions remain immutable even after retirement, so units stay locked.
    const ingredients = next.pantry.ingredients.map(item => used.has(item.id) ? { ...item, unitLocked: true } : item);
    const byId = new Map(ingredients.map(item => [item.id, item]));
    next.pantry = { ...next.pantry, ingredients, items: next.pantry.items.map(item => ({ ...item, ingredient: byId.get(item.ingredient.id) ?? item.ingredient })) };
    return next;
  }
  if (!["createTask", "editTask", "saveTask", "addSubtasks", "setCompleted", "setFlags", "scheduleTask", "unscheduleTask", "deleteTask"].includes(String(command.action)) || command.frequency || command.occurrence || command.scope && command.scope !== "this" || !Array.isArray(result.activities) || !Array.isArray(result.removedIds)) return null;
  const old = [...copy.inbox.items, ...copy.agenda.items, ...copy.highlighted.items];
  const related = old.flatMap(item => [item, ...item.children]).filter(item => item.id === command.id || item.id === command.parentId || result.removedIds.includes(item.id));
  if (!related.length && (command.action !== "createTask" || command.parentId)) return null;
  if ([...related, ...result.activities].some(item => item.kind !== "task" || item.mealRole || item.recurrence)) return null;
  const rows = new Map(old.map(item => [item.id, item]));
  for (const item of result.activities) {
    rows.set(item.id, item);
    for (const child of item.children) rows.set(child.id, { ...child, children: [] });
  }
  for (const id of result.removedIds) rows.delete(id);
  const items = [...rows.values()];
  const overlaps = (item: ActivityView, start: string, end: string) => item.schedule && (item.schedule.mode === "allDay"
    ? item.schedule.startDate! < end && item.schedule.endDate! > start
    : item.schedule.startsAt! < atTime(end) && item.schedule.endsAt! > atTime(start));
  next.inbox.items = items.filter(item => item.kind === "task" && !item.parentId && !item.schedule).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  next.agenda.items = items.filter(item => overlaps(item, copy.start, copy.end)).sort((a, b) => a.id.localeCompare(b.id));
  const year = copy.today.slice(0, 4);
  next.highlighted.items = items.filter(item => item.highlighted && overlaps(item, `${year}-01-01`, `${Number(year) + 1}-01-01`)).sort((a, b) => a.id.localeCompare(b.id));
  return next;
}
