import type { ActivityView, CommandResult } from "../../../reconstruction/core/src/views";
import { parseSchedule, type CoreCommand, type ScheduleInput } from "../../../reconstruction/core/src/contracts";
import type { LocalGuard, LocalOperation } from "../../../reconstruction/core/src/local-task-contract";
import type { LocalCopy } from "./local-contract";
import { atTime } from "./dates";
import { localInstant, localParts, shiftDate } from "../../../reconstruction/core/src/local-time";
import { stepScheduleDefinition, stepOccurrenceSchedule } from "../../../reconstruction/core/src/series-step-schedule";

function currentDate(row:ActivityView){
  return row.schedule?.mode==="timed"?localParts(row.schedule.startsAt!,row.schedule.timeZone).date:row.schedule?.startDate??row.recurrence?.originalDate;
}
function scopedParentSchedule(schedule:ScheduleInput,date:string):ScheduleInput{
  if(schedule.mode==="allDay")return {...schedule,startDate:date,endDate:shiftDate(date,(Date.parse(schedule.endDate)-Date.parse(schedule.startDate))/86400000)};
  const time=localParts(schedule.startsAt,schedule.timeZone).time,duration=Date.parse(schedule.endsAt)-Date.parse(schedule.startsAt);
  if(duration%900000||Number(time.slice(3))%15||new Date(schedule.startsAt).getUTCSeconds()||new Date(schedule.startsAt).getUTCMilliseconds())throw new Error("Usa intervalos de 15 minutos.");
  const startsAt=localInstant(date,time,schedule.timeZone);
  return {...schedule,startsAt,endsAt:new Date(Date.parse(startsAt)+duration).toISOString()};
}

export function taskRows(copy: LocalCopy) {
  const rows = new Map<string, ActivityView>();
  for (const item of [...copy.inbox.items, ...copy.agenda.items, ...copy.highlighted.items]) {
    rows.set(item.id, item);
    for (const child of item.children) rows.set(child.id, { ...child, children: [] });
  }
  return rows;
}
export function taskGuard(copy: LocalCopy, id: string): LocalGuard {
  const row = taskRows(copy).get(id);
  return { id, revision: row?.revision ?? null, children: row?.children.map(c => ({ id: c.id, revision: c.revision })) ?? [], ...(row?.recurrence?.virtual ? { occurrence: { seriesId: row.recurrence.seriesId, ordinal: row.recurrence.ordinal, seriesRevision: row.recurrence.seriesRevision }, ...(row.recurrence.originalDate ? {date:row.recurrence.originalDate} : {}) } : {}) };
}
export function mergeTaskRows(copy: LocalCopy, updates: ActivityView[], removed: string[] = []): LocalCopy {
  const rows = taskRows(copy);
  for (const item of updates) {
    const previous = rows.get(item.id);
    if (!item.parentId && previous) for (const child of previous.children) rows.delete(child.id);
    rows.set(item.id, item);
    for (const child of item.children) rows.set(child.id, { ...child, children: [] });
  }
  removed.forEach(id => rows.delete(id));
  const items = [...rows.values()];
  const overlaps = (item: ActivityView, start: string, end: string) => item.schedule && (item.schedule.mode === "allDay" ? item.schedule.startDate! < end && item.schedule.endDate! > start : item.schedule.startsAt! < atTime(end) && item.schedule.endsAt! > atTime(start));
  const year = copy.today.slice(0, 4);
  return { ...copy,
    inbox: { ...copy.inbox, items: items.filter(i => i.kind === "task" && !i.parentId && !i.schedule).sort((a,b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) },
    agenda: { ...copy.agenda, items: items.filter(i => !!i.schedule).sort((a,b) => a.id.localeCompare(b.id)) },
    highlighted: { ...copy.highlighted, items: items.filter(i => i.highlighted && overlaps(i, `${year}-01-01`, `${Number(year)+1}-01-01`)).sort((a,b) => a.id.localeCompare(b.id)) } };
}
function newTask(id: string, title: string, parentId: string | null, at: string, position = 0): ActivityView {
  return { id, title, parentId, kind: "task", description: null, position, revision: 1, stepKeyId: null, completedAt: null, keep: false, highlighted: false, createdAt: at, updatedAt: at, schedule: null, recurrence: null, parentCalendarId: undefined, children: [] };
}
function setTaskSchedule(copy: LocalCopy, root: ActivityView, selected: ActivityView | ActivityView["children"][number], value: ScheduleInput | null) {
  if (!value) { selected.schedule = null; selected.keep = false; selected.highlighted = false; }
  else {
    const schedule = parseSchedule(value);
    const calendarId = selected.parentId && root.schedule ? root.schedule.calendarId : schedule.calendarId;
    if (!copy.calendars.some(calendar => calendar.id === calendarId)) throw new Error("Elige un calendario descargado en este dispositivo.");
    selected.schedule = { calendarId, mode: schedule.mode, timeZone: schedule.timeZone,
      startsAt: schedule.mode === "timed" ? schedule.startsAt : null, endsAt: schedule.mode === "timed" ? schedule.endsAt : null,
      startDate: schedule.mode === "allDay" ? schedule.startDate : null, endDate: schedule.mode === "allDay" ? schedule.endDate : null };
  }
  for (const child of root.children) {
    child.parentCalendarId = root.schedule?.calendarId;
    if (root.schedule && child.schedule) child.schedule = { ...child.schedule, calendarId: root.schedule.calendarId };
  }
}

/** Project downloaded instances; the server applies the same scopes to future definitions. */
export function projectTask(copy: LocalCopy, op: LocalOperation): { copy: LocalCopy; result: CommandResult } {
  const c = op.command, rows = taskRows(copy);
  if(c.action==="stopRecurrence"&&op.seriesChange){
    const updates:ActivityView[]=[],removedIds:string[]=[];
    const orphan=[...rows.values()].find(row=>row.parentId&&!rows.has(row.parentId)&&row.recurrence?.seriesId===c.seriesId&&row.recurrence.originalDate&&row.recurrence.originalDate>=c.effectiveDate);
    if(orphan)throw new Error(`Descarga primero la fecha ${orphan.recurrence!.originalDate} de la principal de «${orphan.title}» para separar la serie sin dejar subtareas incompletas en la copia.`);
    for(const source of rows.values()){
      if(source.parentId||source.recurrence?.seriesId!==c.seriesId)continue;
      const chosen=source.id===c.id;
      if(!chosen&&(source.completedAt||!source.recurrence.originalDate||source.recurrence.originalDate<c.effectiveDate))continue;
      // Virtual progress is preserved as history, not expanded into independent copies.
      if(!chosen&&source.recurrence.virtual&&source.children.some(child=>child.completedAt))continue;
      if(!chosen&&(source.recurrence.virtual||!c.preserveModified)){
        removedIds.push(source.id,...source.children.map(child=>child.id));continue;
      }
      const root=structuredClone(source);root.recurrence=null;root.updatedAt=op.at;
      root.children=root.children.map(child=>({...child,stepKeyId:null,recurrence:null,parentCalendarId:chosen?undefined:root.schedule?.calendarId}));
      if(chosen){root.schedule=null;root.keep=false;root.highlighted=false;}
      updates.push(root);
    }
    return {copy:mergeTaskRows(copy,updates,removedIds),result:{activities:updates.flatMap(root=>[root,...root.children.map(child=>({...child,children:[]}))]),removedIds,calendars:[],dataRevision:copy.dataRevision}};
  }
  if(op.seriesChange){
    const ref=op.seriesChange,removedIds:string[]=[],updates:ActivityView[]=[];
    const belongs=(row:ActivityView)=>row.recurrence?.seriesId===ref.seriesId&&(ref.fromDate===null||!!row.recurrence.originalDate&&row.recurrence.originalDate>=ref.fromDate);
    const roots=[...rows.values()].filter(row=>!row.parentId&&row.kind==="task"&&!row.mealRole&&belongs(row));
    const additions=c.action==="addSubtasks"?c.children:c.action==="createTask"?[c]:[];
    const changesSchedule=c.action==="scheduleTask"||c.action==="unscheduleTask"||c.action==="saveTask"&&c.schedule!==undefined;
    const schedule=c.action==="scheduleTask"?c.schedule:c.action==="saveTask"?c.schedule:null;
    const definition=changesSchedule&&schedule&&ref.stepKeyId?stepScheduleDefinition(schedule,ref.anchorDate!):null;
    if(changesSchedule&&ref.stepKeyId&&[...rows.values()].some(row=>row.parentId&&belongs(row)&&(row.stepKeyId??row.id)===ref.stepKeyId&&!rows.has(row.parentId)&&!row.completedAt))throw new Error("Descarga primero las fechas de las principales de estas subtareas para calcular sus horarios sin conexión.");
    const position=Math.max(-1,...roots.flatMap(root=>root.children.map(child=>child.position)))+1;
    for(const source of roots){
      const root=structuredClone(source);
      if(additions.length){
        if(root.children.length+additions.length>500)throw new Error("Una instancia superaría las 500 subtareas. Reduce el cambio.");
        for(const [index,child] of additions.entries()){
          const id=ref.childIds?.[root.id]?.[child.id];if(!id)throw new Error("Falta preparar la identidad de una subtarea.");
          root.children.push({...newTask(id,child.title,root.id,op.at,position+index),stepKeyId:child.id,recurrence:root.recurrence,parentCalendarId:root.schedule?.calendarId});
        }
        root.completedAt=null;
      }else if(c.action==="editTask"||c.action==="saveTask"||c.action==="scheduleTask"||c.action==="unscheduleTask"){
        const selected=ref.stepKeyId===null?root:root.children.find(item=>(item.stepKeyId??item.id)===ref.stepKeyId);
        if(selected){
          if((c.action==="editTask"||c.action==="saveTask")&&c.title!==undefined)selected.title=c.title;
          if(changesSchedule&&(!selected.parentId||!selected.completedAt)){
            if(!selected.parentId&&!schedule)throw new Error("Quita el horario solo de esta instancia; la serie principal necesita fechas para repetirse.");
            const date=currentDate(root);if(!date)throw new Error("Falta la fecha original de la principal.");
            const next=selected.parentId?(definition?stepOccurrenceSchedule(definition,date,undefined,root.schedule?.calendarId):null):scopedParentSchedule(schedule!,date);
            setTaskSchedule(copy,root,selected,next);
          }
          selected.updatedAt=op.at;
        }
      }else if(c.action==="setCompleted"){
        const selected=ref.stepKeyId===null?[root,...root.children]:root.children.filter(child=>(child.stepKeyId??child.id)===ref.stepKeyId);
        for(const item of selected)if(!!item.completedAt!==c.completed)item.completedAt=c.completed?op.at:null;
        if(ref.stepKeyId&&selected.length&&root.children.length){
          if(root.children.some(child=>!child.completedAt))root.completedAt=null;
          else root.completedAt??=op.at;
        }
      }else if(c.action==="deleteTask"&&ref.stepKeyId){
        const matches=root.children.filter(child=>(child.stepKeyId??child.id)===ref.stepKeyId);
        removedIds.push(...matches.map(child=>child.id));root.children=root.children.filter(child=>!matches.includes(child));
        if(matches.length&&root.children.length){if(root.children.some(child=>!child.completedAt))root.completedAt=null;else root.completedAt??=op.at;}
      }else throw new Error("Esta acción de serie necesita conexión directa.");
      root.updatedAt=op.at;updates.push(root);
    }
    // Scheduled children can be downloaded even when their parent's date is outside the window.
    for(const row of rows.values())if(row.parentId&&!roots.some(root=>root.id===row.parentId)&&belongs(row)&&(row.stepKeyId??row.id)===ref.stepKeyId){
      if(c.action==="deleteTask")removedIds.push(row.id);
      else if(c.action==="setCompleted")updates.push({...row,completedAt:c.completed?(row.completedAt??op.at):null,updatedAt:op.at});
      else if((c.action==="editTask"||c.action==="saveTask")&&c.title!==undefined)updates.push({...row,title:c.title,updatedAt:op.at});
    }
    return {copy:mergeTaskRows(copy,updates,removedIds),result:{activities:updates.flatMap(root=>[root,...root.children.map(child=>({...child,children:[]}))]),removedIds,calendars:[],dataRevision:copy.dataRevision}};
  }
  if (op.seriesDeletion && c.action === "deleteTask") {
    const ref = op.seriesDeletion;
    const removedIds = [...new Set([...rows.values()].filter(row=>row.recurrence?.seriesId===ref.seriesId && (ref.fromDate===null || !!row.recurrence.originalDate && row.recurrence.originalDate>=ref.fromDate)).flatMap(row=>[row.id,...row.children.map(child=>child.id)]))];
    return {copy:mergeTaskRows(copy,[],removedIds),result:{activities:[],removedIds,calendars:[],dataRevision:copy.dataRevision}};
  }
  let root = rows.get(op.rootId);
  const target = "id" in c ? rows.get(c.id) : undefined;
  if (c.action === "createTask" && !c.parentId) {
    if (root) throw new Error("Esa tarea ya existe.");
    root = { ...newTask(c.id, c.title, null, op.at, c.position), description: c.description };
    if (c.schedule) setTaskSchedule(copy, root, root, c.schedule);
  } else {
    if (!root || root.parentId || root.kind !== "task" || root.mealRole) throw new Error("La tarea principal no está descargada o necesita conexión.");
    root = structuredClone(root);
    if (c.action !== "createTask" && (!target || target.kind !== "task" || target.mealRole)) throw new Error("La tarea no está disponible en esta copia.");
    const selected = c.action === "createTask" ? root : c.id === root.id ? root : root.children.find(child => child.id === c.id);
    if (!selected) throw new Error("La subtarea ya no está disponible.");
    if (c.action === "createTask") {
      if (c.parentId !== root.id) throw new Error("Solo se admite un nivel de subtareas.");
      const child = { ...newTask(c.id, c.title, root.id, op.at, c.position), description: c.description, parentCalendarId: root.schedule?.calendarId, ...(root.recurrence?{stepKeyId:c.id,recurrence:root.recurrence}:{}) };
      root.children.push(child);
      if (c.schedule) setTaskSchedule(copy, root, child, c.schedule);
    } else if (c.action === "addSubtasks") {
      if (selected.parentId) throw new Error("Solo se admite un nivel de subtareas.");
      const position = Math.max(-1, ...root.children.map(child => child.position)) + 1;
      root.children.push(...c.children.map((child, index) => ({...newTask(child.id, child.title, root!.id, op.at, position + index), parentCalendarId: root!.schedule?.calendarId,...(root!.recurrence?{stepKeyId:child.id,recurrence:root!.recurrence}:{})})));
    } else if (c.action === "editTask" || c.action === "saveTask") {
      if (c.title !== undefined) selected.title = c.title;
      if (c.action === "editTask") { if (c.description !== undefined) selected.description = c.description; if (c.position !== undefined) selected.position = c.position; }
      if (c.action === "saveTask" && c.schedule !== undefined) setTaskSchedule(copy, root, selected, c.schedule);
      selected.updatedAt = op.at;
    } else if (c.action === "scheduleTask" || c.action === "unscheduleTask") {
      setTaskSchedule(copy, root, selected, c.action === "scheduleTask" ? c.schedule : null);
      selected.updatedAt = op.at;
    } else if (c.action === "setCompleted") {
      const mark = (item: typeof selected) => { if (!!item.completedAt !== c.completed) item.completedAt = c.completed ? op.at : null; };
      mark(selected); if (!selected.parentId) root.children.forEach(mark);
    } else if (c.action === "deleteTask") {
      if (c.id === root.id) {
        const removedIds = [root.id, ...root.children.map(child => child.id)];
        return { copy: mergeTaskRows(copy, [], removedIds), result: { activities: [], removedIds, calendars: [], dataRevision: copy.dataRevision } };
      }
      root.children = root.children.filter(child => child.id !== c.id);
    }
    else throw new Error("Esta acción requiere conexión.");
    if (root.children.length) {
      if (root.children.some(child => !child.completedAt)) root.completedAt = null;
      else if (!root.completedAt) root.completedAt = op.at;
    }
  }
  const removedIds = c.action === "deleteTask" ? [c.id] : [];
  const activities: ActivityView[] = [root, ...root.children.map(child => ({ ...child, children: [] }))];
  return { copy: mergeTaskRows(copy, [root], removedIds), result: { activities, removedIds, calendars: [], dataRevision: copy.dataRevision } };
}
export function projectTasks(base: LocalCopy, operations: LocalOperation[]) {
  return operations.reduce((value, op) => projectTask(value, op).copy, base);
}
export function rootFor(copy: LocalCopy, command: CoreCommand) {
  const id = command.action === "createTask" ? command.parentId ?? command.id : command.id;
  const row = taskRows(copy).get(id);
  return row?.parentId ?? id;
}
