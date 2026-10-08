"use client";
import type { RecurrenceRule } from "../../../reconstruction/core/src/recurrence";
export function RecurrenceFields({ value, change, startDate, disabled, allowNone = true }: { value: RecurrenceRule | null; change: (value: RecurrenceRule | null) => void; startDate: string; disabled: boolean; allowNone?: boolean }) {
  const weekday = new Date(`${startDate}T12:00:00Z`).getUTCDay();
  return <fieldset className="core-recurrence-fields" disabled={disabled}><legend>Repetición</legend>
    <label className="form-field">Se repite<select value={value?.frequency ?? "none"} onChange={event => {
      const frequency = event.target.value as RecurrenceRule["frequency"] | "none";
      change(frequency === "none" ? null : { frequency, interval: value?.interval ?? 1, untilDate: value?.untilDate ?? null, weekdays: frequency === "WEEKLY" ? [weekday] : [] });
    }}>{allowNone && <option value="none">No se repite</option>}<option value="DAILY">Diariamente</option><option value="WEEKLY">Semanalmente / elegir días</option><option value="MONTHLY">Mensualmente</option><option value="YEARLY">Anualmente</option></select></label>
    {value && <>
      <label className="form-field">Cada<input type="number" min={1} max={365} required value={value.interval} onChange={event => change({ ...value, interval: Number(event.target.value) })} />{({ DAILY: "día(s)", WEEKLY: "semana(s)", MONTHLY: "mes(es)", YEARLY: "año(s)" })[value.frequency]}</label>
      {value.frequency === "WEEKLY" && <div className="core-row-actions">{["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((day, index) => <label key={day}><input type="checkbox" checked={value.weekdays.includes(index)} onChange={event => change({ ...value, weekdays: event.target.checked ? [...value.weekdays, index].sort((a, b) => a - b) : value.weekdays.filter(day => day !== index) })} />{day}</label>)}</div>}
      <label className="form-field">Último día (opcional)<input type="date" min={startDate} value={value.untilDate ?? ""} onChange={event => change({ ...value, untilDate: event.target.value || null })} /></label>
      <small className="core-muted">Se calculan las fechas al abrir la agenda. Cada instancia se puede completar o cambiar por separado. Día 31 y 29 de febrero se ajustan al último día del mes cuando haga falta.</small>
    </>}
  </fieldset>;
}
