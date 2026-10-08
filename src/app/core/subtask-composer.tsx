"use client";
import { useContext, useRef, useState } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import type { SeriesScope } from "../../../reconstruction/core/src/contracts";
import type { Mutate } from "./use-core-feed";
import { CoreFeedback } from "./schedule-editor";
import { TrashIcon } from "./task-icons";

export function SubtaskComposer({ item, disabled, mutate }: { item: ActivityView; disabled: boolean; mutate: Mutate }) {
  const [open, setOpen] = useState(false), [draft, setDraft] = useState("");
  const [children, setChildren] = useState<{ id: string; title: string }[]>([]);
  const [confirm, setConfirm] = useState(false), [scope, setScope] = useState<SeriesScope>("this");
  const [source, setSource] = useState(item);
  const input = useRef<HTMLInputElement>(null);
  const feedback = useContext(CoreFeedback);
  function append() {
    if (disabled || !draft.trim() || children.length >= 50) return;
    setChildren(current => [...current, { id: crypto.randomUUID(), title: draft.trim() }]); setDraft(""); input.current?.focus();
  }
  function finish() {
    if (disabled || (!children.length && !draft.trim())) return;
    if (draft.trim() && children.length < 50) { setChildren(current => [...current, { id: crypto.randomUUID(), title: draft.trim() }]); setDraft(""); }
    setConfirm(true);
  }
  function close() { setOpen(false); setDraft(""); setChildren([]); setConfirm(false); }
  if (!open) return <button className="core-text-button" type="button" aria-label={`Agregar subtareas a ${item.title}`} disabled={disabled} onClick={() => { setSource(item); setScope("this"); setOpen(true); }}>＋</button>;
  return <section className="core-subtask-composer" aria-label={`Nuevas subtareas de ${item.title}`}>
    {!!children.length && <ul className="core-subtask-drafts">{children.map(child => <li key={child.id}><span>{child.title}<small>Sin guardar</small></span>{!confirm && <button className="core-text-button core-icon-button" type="button" disabled={disabled} aria-label={`Quitar borrador ${child.title}`} onClick={() => setChildren(current => current.filter(value => value.id !== child.id))}><TrashIcon /></button>}</li>)}</ul>}
    {confirm ? <div className="core-inline-panel"><p>¿Guardar {children.length} {children.length === 1 ? "subtarea" : "subtareas"}?</p>
      {source.recurrence && <label className="form-field">Agregar a<select disabled={disabled} value={scope} onChange={event => setScope(event.target.value as SeriesScope)}><option value="this">Solo esta</option><option value="following">Esta y las siguientes</option><option value="all">Toda la serie</option></select></label>}
      {source.recurrence && scope !== "this" && <p className="core-muted">Todas estas subtareas se agregarán pendientes al alcance elegido.</p>}
      {feedback.error && <p className="pantry-error" role="alert">{feedback.error}</p>}
      <div className="core-row-actions"><button className="pantry-add-button" type="button" disabled={disabled} onClick={() => void mutate({ action: "addSubtasks", id: source.id, expectedRevision: source.revision, children, ...(source.recurrence ? { scope, ...(scope !== "this" ? { expectedSeriesRevision: source.recurrence.seriesRevision } : {}), ...(source.recurrence.virtual ? { occurrence: { seriesId: source.recurrence.seriesId, ordinal: source.recurrence.ordinal, seriesRevision: source.recurrence.seriesRevision } } : {}) } : {}) }, close)}>Guardar</button><button className="core-text-button" type="button" disabled={disabled} onClick={() => { setConfirm(false); requestAnimationFrame(() => input.current?.focus()); }}>Seguir agregando</button><button className="core-text-button" type="button" disabled={disabled} onClick={close}>Descartar</button></div>
      {feedback.retry && <button className="core-text-button" type="button" disabled={feedback.busy} onClick={feedback.reattempt}>Reintentar guardado</button>}
    </div> : <><form className="core-subtask-add" onSubmit={event => { event.preventDefault(); append(); }}><input ref={input} autoFocus aria-label={`Nueva subtarea de ${item.title}`} maxLength={source.recurrence ? 150 : 250} placeholder="Escribe una subtarea y pulsa Enter" value={draft} disabled={disabled || children.length >= 50} onChange={event => setDraft(event.target.value)} /><button className="core-text-button" type="submit" disabled={disabled || !draft.trim() || children.length >= 50}>Agregar</button></form>
      <div className="core-row-actions"><button className="core-text-button" type="button" disabled={disabled || (!children.length && !draft.trim())} onClick={finish}>Listo</button><button className="core-text-button" type="button" disabled={disabled} onClick={() => { if ((!children.length && !draft.trim()) || window.confirm("¿Descartar las subtareas sin guardar?")) close(); }}>Cancelar</button></div>
      <small className="core-muted">Agrega las que necesites con Enter. Al terminar pulsa Listo para guardarlas juntas.</small></>}
  </section>;
}
