"use client";
import Link from "./local-link";
import { dateParts } from "./dates";
import { useState } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import type { Mutate } from "./use-core-feed";
import { useSeriesAction } from "./series-action";
import { ScheduleButton, scheduleLabel, type CalendarView } from "./schedule-editor";
import { MealCompletionButton } from "./meal-completion-button";
import { TaskEditor } from "./task-editor";
import { PencilIcon, TrashIcon } from "./task-icons";
import { SubtaskComposer } from "./subtask-composer";
import { useLocalStatus } from "./local-data";

export function TaskCard({ item, disabled, mutate, calendars, scopeControls = false }: { scopeControls?: boolean; item: ActivityView; disabled: boolean; mutate: Mutate; calendars: CalendarView[] }) {
  const local = useLocalStatus();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const actions = useSeriesAction(item, scopeControls, disabled, mutate, true);
  const done = item.children.filter(child => child.completedAt).length;
  if (item.kind === "meal") return <li className={`today-item inbox-item core-task${item.completedAt?" today-item-completed":""}`}><MealCompletionButton item={item} disabled={disabled} mutate={mutate}/><div className="today-event-content"><strong>{item.title}</strong><small className="core-schedule-label">{scheduleLabel(item)}</small><p className="core-muted">Comida planificada · Los ingredientes se descuentan al completar</p><div className="core-row-actions core-flags"><label><input type="checkbox" disabled={disabled} checked={item.keep} onChange={event => void mutate({ action: "setFlags", id: item.id, expectedRevision: item.revision, keep: event.target.checked })} />Conservar</label><label><input type="checkbox" disabled={disabled} checked={item.highlighted} onChange={event => void mutate({ action: "setFlags", id: item.id, expectedRevision: item.revision, highlighted: event.target.checked })} />Destacar</label></div>{item.children.length > 0 && <details open className="core-subtasks"><summary>Pasos y preparaciones ({item.children.length})</summary><ul>{item.children.map(child => <SubtaskRow key={child.id} child={child} meal={item} calendars={calendars} disabled={disabled} mutate={mutate} quickMutate={mutate} scopeControls={false} parentDate={item.schedule?.startsAt?dateParts(item.schedule.startsAt,item.schedule.timeZone).date:item.schedule?.startDate??item.recurrence?.originalDate} parentCalendarId={item.schedule?.calendarId} />)}</ul></details>}</div><div className="inbox-actions"><Link prefetch={false} className="core-text-button" href={`/cocina/planificar?meal=${item.id}`}>{item.completedAt?"Ver en Planificar":"Editar en Planificar"}</Link><button disabled={disabled} onClick={() => { if (window.confirm(`¿Eliminar «${item.title}» y sus preparaciones?${item.completedAt?" Esto quita la tarjeta sin devolver ingredientes; sus tandas y consumos se conservan.":""}`)) void mutate({ action: "deleteTask", id: item.id, expectedRevision: item.revision }); }} aria-label={`Eliminar ${item.title}`} title="Eliminar" className="core-text-button core-icon-button"><TrashIcon /></button></div></li>;
  if (item.mealRole === "preparation") return <li className={`today-item inbox-item core-task${item.completedAt?" today-item-completed":""}`}><button type="button" className="today-completion" disabled={disabled} aria-pressed={!!item.completedAt} aria-label={`${item.completedAt?"Deshacer":"Completar"} ${item.title}`} onClick={()=>void mutate({action:"setCompleted",id:item.id,expectedRevision:item.revision,completed:!item.completedAt})}>{item.completedAt?"✓":""}</button><div className="today-event-content"><strong>{item.title}</strong><small className="core-schedule-label">{scheduleLabel(item)}</small><p className="core-muted">{item.description} · Preparación previa. Marca los obligatorios de su tramo sin completar la comida ni descontar ingredientes.</p>{item.schedule&&<div className="core-row-actions core-flags"><label><input type="checkbox" disabled={disabled} checked={item.keep} onChange={event=>void mutate({action:"setFlags",id:item.id,expectedRevision:item.revision,keep:event.target.checked})}/>Conservar</label><label><input type="checkbox" disabled={disabled} checked={item.highlighted} onChange={event=>void mutate({action:"setFlags",id:item.id,expectedRevision:item.revision,highlighted:event.target.checked})}/>Destacar</label></div>}{item.mealPriorGroup&&<ScheduleButton inline item={item} calendars={calendars} disabled={disabled} mutate={mutate}/>}<Link prefetch={false} className="core-text-button" href={`/cocina/planificar?meal=${item.mealBlockId}`}>Ver comida</Link></div></li>;
  return <li className={`today-item inbox-item core-task${item.completedAt ? " today-item-completed" : ""}`}>
    <button type="button" className="today-completion" disabled={disabled} aria-pressed={Boolean(item.completedAt)} aria-label={`${item.completedAt ? "Deshacer completado de" : "Completar"} ${item.title}`}
      onClick={() => void mutate({ action: "setCompleted", id: item.id, expectedRevision: item.revision, completed: !item.completedAt })}>{item.completedAt ? "✓" : ""}</button>
    <div className="today-event-content">
      {editing ? <TaskEditor item={item} calendars={calendars} disabled={disabled} mutate={mutate} close={() => setEditing(false)} scopeControls={scopeControls} applyCompleted={() => void actions.request({ action: "setCompleted", id: item.id, expectedRevision: item.revision, completed: !!item.completedAt })} /> : <div className="inbox-text"><strong>{item.title} {local.pendingIds.includes(item.id) && <small className="local-pending-badge">Sin enviar</small>}</strong>{item.recurrence && <small className="core-muted">↻ Recurrente · Casillas rápidas: solo esta instancia</small>}{item.schedule && <small className="core-schedule-label">{scheduleLabel(item)}</small>}{item.description && <p className="core-description">{item.description}</p>}</div>}
      {!editing && !item.schedule && !item.parentId && <div className="core-task-schedule-action"><ScheduleButton inline iconOnly item={item} calendars={calendars} disabled={disabled} mutate={mutate} /></div>}
      {item.schedule && <div className="core-row-actions core-flags"><label><input type="checkbox" disabled={disabled} checked={item.keep} onChange={event => void mutate({ action: "setFlags", id: item.id, expectedRevision: item.revision, keep: event.target.checked })} />Conservar</label><label><input type="checkbox" disabled={disabled} checked={item.highlighted} onChange={event => void mutate({ action: "setFlags", id: item.id, expectedRevision: item.revision, highlighted: event.target.checked })} />Destacar</label></div>}
      {!item.parentId && <>
      {item.children.length > 0 && <details open className="core-subtasks"><summary>Subtareas {done}/{item.children.length}</summary>
        <ul>{item.children.map(child => <SubtaskRow key={child.id} child={child} calendars={calendars} parentDate={item.schedule?.startsAt?dateParts(item.schedule.startsAt,item.schedule.timeZone).date:item.schedule?.startDate??item.recurrence?.originalDate} parentCalendarId={item.schedule?.calendarId} disabled={disabled} mutate={actions.request} quickMutate={mutate} scopeControls={scopeControls} />)}</ul>
      </details>}
      <SubtaskComposer item={item} disabled={disabled} mutate={mutate} />
      </>}
      {actions.dialog}
      {deleting && <section className="core-inline-panel" aria-label="Confirmar borrado"><p>¿Borrar «{item.title}» y sus subtareas? También se quitarán sus horarios.</p><button type="button" className="core-text-button" disabled={disabled} onClick={() => void actions.request({ action: "deleteTask", id: item.id, expectedRevision: item.revision })}>Confirmar borrado</button><button type="button" className="core-text-button" disabled={disabled} onClick={() => setDeleting(false)}>Cancelar</button></section>}
    </div><div className="inbox-actions core-task-corner-actions">
      <button type="button" className="core-text-button core-icon-button" aria-label={`Editar ${item.title}`} title="Editar" disabled={disabled || editing} onClick={() => { setDeleting(false); setEditing(true); }}><PencilIcon /></button>
      <button type="button" className="core-text-button core-icon-button" aria-label={`Eliminar ${item.title}`} title="Eliminar" disabled={disabled} onClick={() => { if (scopeControls && item.recurrence) void actions.request({ action: "deleteTask", id: item.id, expectedRevision: item.revision }); else setDeleting(true); }}><TrashIcon /></button>
    </div>
  </li>;
}

function SubtaskRow({ child, disabled, mutate, calendars, parentCalendarId, parentDate, quickMutate, scopeControls, meal }: { meal?: ActivityView; quickMutate: Mutate; scopeControls: boolean; child: ActivityView["children"][number]; disabled: boolean; mutate: Mutate; calendars: CalendarView[]; parentCalendarId?: string; parentDate?: string }) {
  const local = useLocalStatus();
  const [editing, setEditing] = useState(false), [text, setText] = useState(child.title), [editRevision, setEditRevision] = useState(child.revision);
  const finishingMeal=meal && !meal.completedAt && meal.children.some(step=>step.mealPriorGroup) && !child.completedAt && !child.mealOptional && !child.mealPriorMember && meal.children.filter(step=>step.mealRole==="preparation" && !step.mealOptional && step.id!==child.id).every(step=>!!step.completedAt);
  return <li className={`core-subtask${child.completedAt ? " core-subtask-completed" : ""}`}>
    {finishingMeal ? <MealCompletionButton item={meal!} label={child.title} disabled={disabled} mutate={quickMutate}/> : <button type="button" className="today-completion" disabled={disabled} title={child.mealPriorMember ? "Completa este tramo sin terminar la comida ni descontar ingredientes" : child.mealRole === "preparation" ? "Al terminar los pasos obligatorios se completará la comida" : undefined} aria-pressed={Boolean(child.completedAt)} aria-label={`${child.completedAt ? "Deshacer completado de" : "Completar"} ${child.title}`}
      onClick={() => void quickMutate({ action: "setCompleted", id: child.id, expectedRevision: child.revision, completed: !child.completedAt })}>{child.completedAt ? "✓" : ""}</button>}
    {editing ? <form className="core-subtask-edit" onSubmit={event => { event.preventDefault(); void mutate({ action: "editTask", id: child.id, expectedRevision: editRevision, title: text.trim() }, () => setEditing(false)); }}>
      <input aria-label="Nombre de subtarea" maxLength={250} required value={text} disabled={disabled} onChange={event => setText(event.target.value)} />
      <button type="submit" className="core-text-button" disabled={disabled || !text.trim() || text.trim() === child.title}>Guardar</button>
      <button type="button" className="core-text-button" disabled={disabled} onClick={() => setEditing(false)}>Cancelar</button>
    </form> : <span className="core-subtask-name">{child.title}{child.mealOptional&&<small>Opcional</small>}{child.schedule && <small>Agendada · {scheduleLabel(child)}</small>}</span>}
    {local.pendingIds.includes(child.id) && <small className="local-pending-badge">Sin enviar</small>}
    {(child.mealRole !== "preparation" || child.mealPriorGroup) && <ScheduleButton inline iconOnly item={child} calendars={calendars} parentDate={parentDate} parentCalendarId={parentCalendarId} disabled={disabled} mutate={quickMutate} />}
    {!editing && child.mealRole !== "preparation" && <button type="button" className="core-text-button core-icon-button" disabled={disabled} aria-label={`Editar subtarea ${child.title}`} title={`Editar ${child.title}`} onClick={() => { setText(child.title); setEditRevision(child.revision); setEditing(true); }}><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5" /></svg></button>}
    <button type="button" className="core-text-button core-icon-button" disabled={disabled || child.mealRole === "preparation"} aria-label={`Eliminar subtarea ${child.title}`} title={`Eliminar ${child.title}`} onClick={() => {
      if ((scopeControls && child.recurrence) || window.confirm(`¿Eliminar la subtarea “${child.title}”${child.schedule ? " y su horario" : ""}?`)) void mutate({ action: "deleteTask", id: child.id, expectedRevision: child.revision });
    }}><TrashIcon /></button>
  </li>;
}
