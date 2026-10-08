"use client";
import { coreFetch, localMode, refreshLocalCopy } from "./local-data";
import { useContext, useEffect, useState } from "react";
import type { ActivityView } from "../../../reconstruction/core/src/views";
import type { RecurrenceRule } from "../../../reconstruction/core/src/recurrence";
import type { Draft, Mutate } from "./use-core-feed";
import { CoreDialog, CoreFeedback } from "./schedule-editor";
import { RecurrenceFields } from "./recurrence-fields";

type Info = { rule: RecurrenceRule; originalDate: string; anchorDate: string; seriesRevision: number; dataRevision: string };
type Summary = { effectiveDate: string; previewEndDate: string; added: number; removed: number; preserved: number };
export function FrequencyButton({ item, disabled, mutate, inline = false }: { item: ActivityView; disabled: boolean; mutate: Mutate; inline?: boolean }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" disabled={disabled} onClick={() => setOpen(true)}>Cambiar repetición</button>
    {open && <FrequencyEditor inline={inline} item={item} disabled={disabled} mutate={mutate} close={() => setOpen(false)} />}</>;
}
function FrequencyEditor({ item, disabled, mutate, close, inline }: { item: ActivityView; disabled: boolean; mutate: Mutate; close: () => void; inline: boolean }) {
  const feedback = useContext(CoreFeedback);
  const [info, setInfo] = useState<Info | null>(null), [rule, setRule] = useState<RecurrenceRule | null>(null);
  const [scope, setScope] = useState<"following" | "all">("following");
  const [preview, setPreview] = useState<{ summary: Summary; command: Draft } | null>(null);
  const [reading, setReading] = useState(false), [error, setError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setReading(true); setError(null); setPreview(null);
    const params = new URLSearchParams({ view: "recurrence", seriesId: item.recurrence!.seriesId, ordinal: String(item.recurrence!.ordinal) });
    void coreFetch(`/api/core?${params}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "No pudimos leer la repetición.");
      if (!controller.signal.aborted) { setInfo(result); setRule(result.rule); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "No pudimos leer la repetición."); })
      .finally(() => { if (!controller.signal.aborted) setReading(false); });
    return () => controller.abort();
  }, [item.recurrence!.seriesId, item.recurrence!.ordinal, refresh]);
  async function review() {
    if (!info || !rule) return;
    setReading(true); setError(null); setPreview(null);
    const command: Draft = { action: "changeRecurrence", id: item.id, expectedRevision: item.revision, seriesId: item.recurrence!.seriesId, ordinal: item.recurrence!.ordinal,
      expectedSeriesRevision: info.seriesRevision, expectedDataRevision: info.dataRevision, scope, rule };
    try {
      const params = new URLSearchParams({ view: "recurrencePreview", command: JSON.stringify({ ...command, commandId: crypto.randomUUID() }) });
      const response = await coreFetch(`/api/core?${params}`, { cache: "no-store" });
      const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "No pudimos revisar el cambio.");
      setPreview({ summary: result, command });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos revisar el cambio."); }
    finally { setReading(false); }
  }
  return <CoreDialog inline={inline} busy={feedback.busy} title="Cambiar repetición" close={() => { if (!feedback.busy) close(); }}>
    <p>Las completadas y las pendientes pasadas se conservan. Las futuras que modificaste también conservan su horario, subtareas y progreso.</p>
    {reading && <p role="status">Revisando repetición…</p>}
    {info && <form onSubmit={event => { event.preventDefault(); void review(); }}>
      <label className="form-field">Aplicar a<select disabled={disabled || reading} value={scope} onChange={event => { setScope(event.target.value as "following" | "all"); setPreview(null); }}><option value="following">Esta y las siguientes</option><option value="all">Toda la serie</option></select></label>
      <RecurrenceFields value={rule} change={value => { setRule(value); setPreview(null); }} startDate={scope === "all" ? info.anchorDate : info.originalDate} disabled={disabled || reading} allowNone={false} />
      <button type="submit" className="core-text-button" disabled={disabled || reading || !rule}>Revisar cambio</button>
    </form>}
    {preview && <section aria-label="Resumen del cambio"><p>El nuevo patrón se aplica desde <strong>{preview.summary.effectiveDate}</strong>. Las fechas nuevas empiezan pendientes.</p>
      <p>En los próximos ocho meses: <strong>{preview.summary.added}</strong> fechas nuevas y <strong>{preview.summary.removed}</strong> fechas que dejan de repetirse.</p>
      <p><strong>{preview.summary.preserved}</strong> instancias con cambios o progreso se conservan en ese período. También se conservan las que estén más adelante. La excepción de un martes no se repite en otros martes.</p>
      <button type="button" className="pantry-add-button" disabled={disabled || reading} onClick={() => void mutate(preview.command, close)}>Confirmar repetición</button>
    </section>}
    {(error || feedback.error) && <p className="pantry-error" role="alert">{error ?? feedback.error}</p>}
    {(error || (feedback.error && !feedback.retry)) && <button type="button" className="core-text-button" disabled={disabled || reading} onClick={() => setRefresh(value => value + 1)}>Volver a consultar</button>}
    {feedback.retry && <button type="button" className="core-text-button" disabled={feedback.busy} onClick={feedback.reattempt}>Reintentar cambio</button>}
  </CoreDialog>;
}
