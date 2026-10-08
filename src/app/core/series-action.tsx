"use client";
import { useContext, useState } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import type { SeriesScope } from "../../../reconstruction/core/src/contracts";
import { CoreDialog, CoreFeedback } from "./schedule-editor";
import type { Draft, Mutate } from "./use-core-feed";

export function useSeriesAction(item: ActivityView, enabled: boolean, disabled: boolean, mutate: Mutate, inline = false) {
  const [pending, setPending] = useState<{ command: Draft; success?: () => void; recurrence: NonNullable<ActivityView["recurrence"]> } | null>(null);
  const [scope, setScope] = useState<SeriesScope>("this");
  const feedback = useContext(CoreFeedback);
  const request: Mutate = async (command, success) => {
    const targetId = command.action === "createTask" ? command.parentId : command.id;
    const target = [item, ...item.children].find(candidate => candidate.id === targetId);
    if (enabled && target?.recurrence && ["createTask", "editTask", "deleteTask", "setCompleted", "scheduleTask", "unscheduleTask"].includes(command.action)) {
      setScope("this"); setPending({ command, success, recurrence: target.recurrence });
    } else await mutate(command, success);
  };
  const dialog = pending && <CoreDialog inline={inline} busy={feedback.busy} title={pending.command.action === "deleteTask" ? "Eliminar repetición" : "Aplicar cambio a repeticiones"} close={() => { if (!feedback.busy) setPending(null); }}>
    <p>El alcance usa la posición original dentro de la serie, aunque una instancia se haya movido o modificado.</p>
    <label className="form-field">Aplicar a<select disabled={disabled} value={scope} onChange={event => setScope(event.target.value as SeriesScope)}><option value="this">Solo esta</option><option value="following">Esta y las siguientes</option><option value="all">Toda la serie</option></select></label>
    {pending.command.action === "setCompleted" && <p>Se {pending.command.completed ? "marcará" : "desmarcará"} {"la subtarea o tarea elegida"}. Los pasos eliminados se omiten y las otras marcas se conservan. Para una principal, también se aplica a todos sus hijos.</p>}
    {pending.command.action === "createTask" && scope !== "this" && <p>La nueva subtarea estará disponible en las repeticiones del alcance elegido, inicialmente pendiente.</p>}
    {pending.command.action === "scheduleTask" && scope !== "this" && <p>Se aplican la nueva hora, duración y calendario. Cada instancia conserva su fecha actual. Los hijos mantienen sus horarios propios. Arrastrar cambia solo una instancia.</p>}
    {pending.command.action === "deleteTask" && <p>Esta acción no se puede deshacer. Eliminar la principal retira también sus subtareas y horarios, incluidos los de otros calendarios.</p>}
    {feedback.error && <p className="pantry-error" role="alert">{feedback.error} {feedback.retry && <button type="button" className="core-text-button" disabled={feedback.busy} onClick={feedback.reattempt}>Reintentar cambio</button>}</p>}
    <button type="button" className="pantry-add-button" disabled={disabled} onClick={() => {
      const value = pending;
      void mutate({ ...value.command, scope, ...(scope === "this" ? {} : { expectedSeriesRevision: value.recurrence.seriesRevision }) }, () => { setPending(null); value.success?.(); });
    }}>{pending.command.action === "deleteTask" ? "Confirmar eliminación" : "Aplicar cambio"}</button>
  </CoreDialog>;
  return { request, dialog };
}
