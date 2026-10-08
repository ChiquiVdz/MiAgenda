import { dateOnly } from "./contracts.ts";
import { invalid } from "./errors.ts";
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
export function localParts(value: Date | string, zone: string) {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(value)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
export function localInstant(date: string, time: string, zone: string) {
  const wall = Date.parse(`${date}T${time}:00Z`); let result = wall;
  for (let step = 0; step < 4; step++) {
    const displayed = localParts(new Date(result), zone);
    const delta = wall - Date.parse(`${displayed.date}T${displayed.time}:00Z`);
    if (!delta) return new Date(result).toISOString(); result += delta;
  }
  return invalid("Esta hora no existe en la zona de la serie.");
}
export function shiftDate(date: string, amount: number) {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + amount);
  return dateOnly(value.toISOString().slice(0, 10));
}
