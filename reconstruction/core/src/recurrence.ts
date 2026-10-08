import { dateOnly, revision } from "./contracts.ts";
import { invalid } from "./errors.ts";

/** Supported RRULE subset. Month-end clamping is an explicit MiAgenda policy,
 * not RFC 5545's default (which skips invalid dates). No persistence on reads. */
export type RecurrenceRule = {
  frequency: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  weekdays: number[]; // Sunday=0; canonical sorted set.
  untilDate: string | null; // Inclusive local calendar date.
};
const days = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const dayMs = 86400000;
function serial(date: string) { return Date.parse(`${date}T00:00:00Z`) / dayMs; }
function key(serialDay: number) { return new Date(serialDay * dayMs).toISOString().slice(0, 10); }
function weekday(date: string) { return new Date(`${date}T00:00:00Z`).getUTCDay(); }

export function parseRecurrence(value: unknown, anchorDate: string): RecurrenceRule {
  dateOnly(anchorDate);
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Regla de repetición inválida.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(field => !["frequency", "interval", "weekdays", "untilDate"].includes(field))) invalid("La repetición contiene campos no admitidos.");
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(String(input.frequency))) invalid("Frecuencia no admitida.");
  const frequency = input.frequency as RecurrenceRule["frequency"];
  const interval = revision(input.interval ?? 1);
  if (interval < 1 || interval > 365) invalid("El intervalo debe estar entre 1 y 365.");
  const selected = input.weekdays ?? (frequency === "WEEKLY" ? [weekday(anchorDate)] : []);
  if (!Array.isArray(selected) || selected.length > 7 || selected.some(day => typeof day !== "number" || !Number.isInteger(day) || day < 0 || day > 6)) invalid("Días de semana inválidos.");
  const weekdays = [...new Set(selected as number[])].sort((a, b) => a - b);
  if (frequency !== "WEEKLY" && weekdays.length) invalid("Seleccionar días requiere frecuencia semanal.");
  if (frequency === "WEEKLY" && !weekdays.length) invalid("Elige al menos un día de la semana.");
  const untilDate = input.untilDate == null ? null : dateOnly(input.untilDate);
  if (untilDate && untilDate < anchorDate) invalid("El fin de repetición no puede ser anterior al inicio.");
  return { frequency, interval, weekdays, untilDate };
}

/** Serializable standard fields; clamp policy is stored separately in Segment. */
export function recurrenceRrule(rule: RecurrenceRule) {
  return `FREQ=${rule.frequency};INTERVAL=${rule.interval}` +
    (rule.frequency === "WEEKLY" ? `;BYDAY=${rule.weekdays.map(day => days[day]).join(",")};WKST=SU` : "");
}

export function storedRule(rrule: string, untilDate: Date | null, anchor: string): RecurrenceRule {
  const fields: Record<string, string> = Object.fromEntries(rrule.split(";").map(field => field.split("=")));
  return parseRecurrence({ frequency: fields.FREQ, interval: Number(fields.INTERVAL),
    weekdays: fields.BYDAY ? fields.BYDAY.split(",").map(day => days.indexOf(day)) : [],
    untilDate: untilDate?.toISOString().slice(0, 10) ?? null }, anchor.slice(0, 10));
}

/** Direct inverse for identity validation; does not scan from the series start. */
export function occurrenceAt(anchorLocal: string, rule: RecurrenceRule, ordinal: number): LocalOccurrence {
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal > 4000000) invalid("Ocurrencia inválida.");
  const anchor = dateOnly(anchorLocal.slice(0, 10)); let date: string;
  if (rule.frequency === "DAILY") date = key(serial(anchor) + ordinal * rule.interval);
  else if (rule.frequency === "WEEKLY") {
    const first = rule.weekdays.filter(day => day >= weekday(anchor));
    const cycle = ordinal < first.length ? 0 : 1 + Math.floor((ordinal - first.length) / rule.weekdays.length);
    const day = cycle === 0 ? first[ordinal] : rule.weekdays[(ordinal - first.length) % rule.weekdays.length];
    date = key(serial(anchor) - weekday(anchor) + cycle * rule.interval * 7 + day);
  } else {
    const total = +anchor.slice(0, 4) * 12 + +anchor.slice(5, 7) - 1 + ordinal * rule.interval * (rule.frequency === "YEARLY" ? 12 : 1);
    const y = Math.floor(total / 12), m = total % 12 + 1;
    if (y < 1 || y > 9999) invalid("Ocurrencia fuera del rango de fechas.");
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    const maximum = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
    date = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(+anchor.slice(8), maximum)).padStart(2, "0")}`;
  }
  dateOnly(date);
  if (rule.untilDate && date > rule.untilDate) invalid("La ocurrencia está después del fin de la serie.");
  return { ordinal, date, originalLocal: date + anchorLocal.slice(10) };
}

export type LocalOccurrence = { ordinal: number; originalLocal: string; date: string };
/** Expand ONLY a requested local-date window (max 370 days).
 * Ordinals are calculated from the original anchor, not from the window;
 * paging, moving and future series segments must retain these identities.
 * UTC conversion / DST validation happens at the schedule projection boundary.
 */
export function expandRecurrence(input: {
  anchorLocal: string; rule: RecurrenceRule; startDate: string; endDate: string;
  afterOrdinal?: number; limit?: number;
}): { items: LocalOccurrence[]; nextAfterOrdinal: number | null } {
  const { anchorLocal } = input;
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(anchorLocal)) invalid("Ancla local inválida.");
  const anchor = dateOnly(anchorLocal.slice(0, 10)), suffix = anchorLocal.slice(10);
  if (suffix && (+suffix.slice(1, 3) > 23 || +suffix.slice(4) > 59)) invalid("Hora del ancla inválida.");
  const rule = parseRecurrence(input.rule, anchor);
  const start = dateOnly(input.startDate), end = dateOnly(input.endDate);
  if (start >= end || serial(end) - serial(start) > 370) invalid("Expande un rango positivo de hasta 370 días.");
  const limit = input.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) invalid("Límite de repeticiones inválido.");
  const after = input.afterOrdinal ?? -1;
  if (!Number.isSafeInteger(after) || after < -1) invalid("Cursor de repetición inválido.");
  const items: LocalOccurrence[] = [];
  const lower = start > anchor ? start : anchor;
  const upper = rule.untilDate && rule.untilDate < end ? rule.untilDate : key(serial(end) - 1);
  const add = (date: string, ordinal: number) => {
    if (date >= lower && date <= upper && ordinal > after) items.push({ ordinal, date, originalLocal: date + suffix });
  };
  if (lower <= upper) {
    if (rule.frequency === "DAILY") {
      const first = Math.max(0, Math.ceil((serial(lower) - serial(anchor)) / rule.interval));
      for (let n = first; n <= Math.floor((serial(upper) - serial(anchor)) / rule.interval); n++) add(key(serial(anchor) + n * rule.interval), n);
    } else if (rule.frequency === "WEEKLY") {
      const base = serial(anchor) - weekday(anchor);
      const firstDays = rule.weekdays.filter(day => day >= weekday(anchor));
      // At most 370 candidate dates; never iterate from an old series anchor.
      for (let d = serial(lower); d <= serial(upper); d++) {
        const week = Math.floor((d - base) / 7), day = (d - base) % 7;
        if (week % rule.interval || !rule.weekdays.includes(day)) continue;
        const cycle = week / rule.interval;
        const ordinal = cycle === 0 ? firstDays.indexOf(day) : firstDays.length + (cycle - 1) * rule.weekdays.length + rule.weekdays.indexOf(day);
        add(key(d), ordinal);
      }
    } else {
      const year = +anchor.slice(0, 4), month = +anchor.slice(5, 7), day = +anchor.slice(8);
      const step = rule.interval * (rule.frequency === "YEARLY" ? 12 : 1);
      const origin = year * 12 + month - 1;
      const from = +lower.slice(0, 4) * 12 + +lower.slice(5, 7) - 1;
      const to = +upper.slice(0, 4) * 12 + +upper.slice(5, 7) - 1;
      for (let n = Math.max(0, Math.floor((from - origin) / step)); origin + n * step <= to; n++) {
        const total = origin + n * step, y = Math.floor(total / 12), m = total % 12 + 1;
        if (y < 1 || y > 9999) break;
        const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
        const maximum = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
        add(`${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(Math.min(day, maximum)).padStart(2, "0")}`, n);
      }
    }
  }
  return { items: items.slice(0, limit), nextAfterOrdinal: items.length > limit ? items[limit - 1].ordinal : null };
}
