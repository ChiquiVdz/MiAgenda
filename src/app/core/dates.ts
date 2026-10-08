export const ZONE = "America/Mexico_City";
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string) {
  let value = formatters.get(zone);
  if (!value) {
    value = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    if (formatters.size >= 16) formatters.clear();
    formatters.set(zone, value);
  }
  return value;
}
export function dateParts(value: Date | string, zone = ZONE) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function plusDays(key: string, amount: number) {
  const date = new Date(`${key}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount); return date.toISOString().slice(0, 10);
}
export function monday(date: string) {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return plusDays(date, -((weekday + 6) % 7));
}
/** Convert a wall time using the IANA zone; reject non-existent DST times. */
export function atTime(date: string, time = "00:00", zone = ZONE) {
  const wall = Date.parse(`${date}T${time}:00Z`);
  let instant = wall;
  for (let step = 0; step < 4; step++) {
    const displayed = dateParts(new Date(instant), zone);
    const delta = wall - Date.parse(`${displayed.date}T${displayed.time}:00Z`);
    if (!delta) return new Date(instant).toISOString();
    instant += delta;
  }
  throw new Error("Esta hora no existe en la zona horaria elegida.");
}
export function weekStart(key: string) { return plusDays(key, -new Date(`${key}T12:00:00Z`).getUTCDay()); }
export function labelDate(key: string, options: Intl.DateTimeFormatOptions = { dateStyle: "long" }) { return new Intl.DateTimeFormat("es-MX", { ...options, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`)); }
export function rangeQuery(start: string, days: number, highlightedOnly = false) {
  const end = plusDays(start, days);
  return new URLSearchParams({ view: "agenda", startsAt: atTime(start), endsAt: atTime(end), startDate: start, endDate: end, limit: "100", ...(highlightedOnly ? { highlightedOnly: "true" } : {}) }).toString();
}
export type AgendaViewMode = "day" | "week" | "month" | "year";
function shiftedMonth(key: string, amount: number) {
  const date = new Date(`${key.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + amount); return date.toISOString().slice(0, 10);
}
export function agendaPeriod(view: AgendaViewMode, anchor: string) {
  const visibleStart = view === "week" ? weekStart(anchor) : view === "month" ? `${anchor.slice(0, 7)}-01` : view === "year" ? `${anchor.slice(0, 4)}-01-01` : anchor;
  const visibleEnd = view === "month" ? shiftedMonth(visibleStart, 1) : view === "year" ? shiftedMonth(visibleStart, 12) : plusDays(visibleStart, view === "week" ? 7 : 1);
  const start = view === "month" ? weekStart(visibleStart) : visibleStart;
  const end = view === "month" ? plusDays(weekStart(plusDays(visibleEnd, -1)), 7) : visibleEnd;
  return { start, end, visibleStart, visibleEnd, days: Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) };
}
export function movePeriod(view: AgendaViewMode, anchor: string, direction: number) {
  return view === "year" ? shiftedMonth(anchor, direction * 12) : view === "month" ? shiftedMonth(anchor, direction) : plusDays(anchor, direction * (view === "week" ? 7 : 1));
}
