import { dateOnly, instant, revision, uuid } from "./contracts.ts";
import { invalid } from "./errors.ts";
import { quantityInput, quantityThousandths } from "./ingredient-input.ts";
import { mealQuantities } from "./meal-amounts.ts";
export const plannerActions = ["initializeKitchen", "saveMealSlot", "removeMealSlot", "saveMeal", "deleteMeal", "saveMealDefaults", "copyPreviousMealWeek", "deleteMealWeek"];
function object(value: unknown, allowed: string[]) { if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Datos de planificación inválidos."); const row=value as Record<string, unknown>; if(Object.keys(row).some(key=>!allowed.includes(key))) invalid("Hay campos no admitidos."); return row; }
function flag(value: unknown) { if(typeof value!=="boolean") invalid("Opción inválida."); return value; }
function number(value: unknown, max: number, min=0) { if(typeof value!=="number" || !Number.isInteger(value) || value<min || value>max) invalid(`Usa un número entre ${min} y ${max}.`); return value; }
function quantity(value: unknown) { const parsed=quantityInput(value); if(quantityThousandths(parsed)>BigInt(9999999999)) invalid("Demasiadas porciones."); return parsed; }
export function mealDuration(input: { cookingEnabled: boolean; eatingEnabled: boolean; washingEnabled: boolean; eatingMinutes: number; washingMinutes: number; cookingMinutesOverride: number | null }, times: number[]) {
  const max=Math.max(0,...times), cook=input.cookingMinutesOverride ?? Math.ceil((max+(times.reduce((a,b)=>a+b,0)-max)/2)/5)*5;
  return { cooking: input.cookingEnabled ? cook : 0, total: (input.cookingEnabled ? cook : 0)+(input.eatingEnabled ? input.eatingMinutes : 0)+(input.washingEnabled ? input.washingMinutes : 0) };
}
export function parsePlannerCommand(raw: unknown) {
  const row=object(raw,["action","commandId","id","expectedRevision","name","startMinute","destinationId","expectedDataRevision","date","time","slotId","cookingEnabled","eatingEnabled","washingEnabled","eatingMinutes","washingMinutes","cookingMinutesOverride","recipes","reminders","start"]);
  const action=String(row.action); if(!plannerActions.includes(action)) invalid("Acción de planificación desconocida.");
  const common={action,commandId:uuid(row.commandId)};
  if(action==="copyPreviousMealWeek" || action==="deleteMealWeek") {
    const start=dateOnly(row.start);
    if(new Date(`${start}T12:00:00Z`).getUTCDay()!==1) invalid("La semana debe empezar en lunes.");
    if(typeof row.expectedDataRevision!=="string" || !/^\d{1,19}$/.test(row.expectedDataRevision)) invalid("Falta la revisión de la semana.");
    if(action==="deleteMealWeek") return {...common,start,expectedDataRevision:row.expectedDataRevision,weekAction:"delete" as const};
    if(!Array.isArray(row.reminders) || row.reminders.length>600) invalid("Selecciona hasta 600 preparaciones previas.");
    const reminders=row.reminders.map(value=>{
      const item=object(value,["mealRecipeId","stepKey","startsAt","endsAt","manual"]);
      const startsAt=instant(item.startsAt),endsAt=instant(item.endsAt);
      if(startsAt>=endsAt || Date.parse(endsAt)-Date.parse(startsAt)>86400000) invalid("La preparación previa necesita una duración positiva de hasta un día.");
      return {mealRecipeId:uuid(item.mealRecipeId),stepKey:uuid(item.stepKey),startsAt,endsAt,manual:flag(item.manual)};
    });
    if(new Set(reminders.map(item=>item.mealRecipeId+item.stepKey)).size!==reminders.length) invalid("Preparaciones previas duplicadas.");
    return {...common,start,expectedDataRevision:row.expectedDataRevision,weekAction:"copy" as const,reminders};
  }
  if(action==="initializeKitchen") return {...common};
  if(action==="saveMealDefaults") return {...common,eatingMinutes:number(row.eatingMinutes,1440),washingMinutes:number(row.washingMinutes,1440),expectedDataRevision:String(row.expectedDataRevision)};
  const id=uuid(row.id), expectedRevision=row.expectedRevision===null ? null : revision(row.expectedRevision);
  if(action==="deleteMeal") { if(expectedRevision===null) invalid("Falta revisión."); return {...common,id,expectedRevision}; }
  if(action==="saveMealSlot") { if(typeof row.name!=="string" || !row.name.trim() || row.name.trim().length>80) invalid("Escribe un nombre de hasta 80 caracteres."); const startMinute=number(row.startMinute,1439); if(startMinute%15) invalid("La hora usa intervalos de 15 minutos."); return {...common,id,expectedRevision,name:row.name.trim(),startMinute}; }
  if(action==="removeMealSlot") { if(expectedRevision===null) invalid("Falta revisión de fila."); return {...common,id,expectedRevision,destinationId:row.destinationId===null ? null : uuid(row.destinationId),expectedDataRevision:String(row.expectedDataRevision)}; }
  if(typeof row.time!=="string" || !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(row.time)) invalid("Selecciona una hora en intervalos de 15 minutos.");
  if(!Array.isArray(row.recipes) || !row.recipes.length || row.recipes.length>10) invalid("El bloque necesita entre 1 y 10 recetas.");
  const recipes=row.recipes.map(value=>{const item=object(value,["id","recipeRevisionId","cookedServings","eatenServings","cookingMinutesOverride","ingredientQuantities"]); const cookedServings=quantity(item.cookedServings),eatenServings=quantity(item.eatenServings); if(cookedServings==="0" && eatenServings==="0") invalid("Indica porciones a cocinar o comer."); let ingredientQuantities; try { ingredientQuantities=mealQuantities(item.ingredientQuantities); } catch(cause) { return invalid(cause instanceof Error ? cause.message : "Revisa las cantidades de ingredientes."); } return {id:uuid(item.id),recipeRevisionId:uuid(item.recipeRevisionId),cookedServings,eatenServings,ingredientQuantities,cookingMinutesOverride:item.cookingMinutesOverride===null ? null : number(item.cookingMinutesOverride,10080,1)};});
  if(new Set(recipes.map(item=>item.id)).size!==recipes.length) invalid("Recetas duplicadas en el bloque.");
  if(!Array.isArray(row.reminders) || row.reminders.length>600) invalid("Preparaciones previas inválidas.");
  const reminders=row.reminders.map(value=>{const item=object(value,["mealRecipeId","stepKey","startsAt","endsAt","manual"]); const startsAt=instant(item.startsAt),endsAt=instant(item.endsAt); if(startsAt>=endsAt || Date.parse(endsAt)-Date.parse(startsAt)>86400000) invalid("La preparación previa necesita una duración positiva de hasta un día."); if(!recipes.some(recipe=>recipe.id===item.mealRecipeId)) invalid("La preparación no pertenece a una receta elegida."); return {mealRecipeId:uuid(item.mealRecipeId),stepKey:uuid(item.stepKey),startsAt,endsAt,manual:flag(item.manual)};});
  if(new Set(reminders.map(item=>item.mealRecipeId+item.stepKey)).size!==reminders.length) invalid("Preparaciones previas duplicadas.");
  return {...common,id,expectedRevision,date:dateOnly(row.date),time:row.time,slotId:uuid(row.slotId),cookingEnabled:flag(row.cookingEnabled),eatingEnabled:flag(row.eatingEnabled),washingEnabled:flag(row.washingEnabled),eatingMinutes:number(row.eatingMinutes,1440),washingMinutes:number(row.washingMinutes,1440),cookingMinutesOverride:row.cookingMinutesOverride===null ? null : number(row.cookingMinutesOverride,10080,1),recipes,reminders};
}
export type PlannerCommand = ReturnType<typeof parsePlannerCommand>;
