export type CalendarDisplayEvent = {
  startDate: string | null; endDate: string | null;
  startDateTime: string | null; endDateTime: string | null;
};
export function displayDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
/** Presentation only. Parse instants once per event, not for every calendar cell. */
export function eventsForDays<T extends CalendarDisplayEvent>(days: Date[], events: T[]) {
  const parsed = events.map(event => ({ event,
    start: event.startDateTime ? Date.parse(event.startDateTime) : NaN,
    end: event.endDateTime ? Date.parse(event.endDateTime) : NaN }));
  const grouped = new Map<string, T[]>();
  for (const day of days) {
    const key = displayDateKey(day);
    if (grouped.has(key)) continue;
    const start = Date.parse(`${key}T00:00:00-06:00`), end = start + 86400000;
    grouped.set(key, parsed.filter(({ event, start: eventStart, end: eventEnd }) =>
      event.startDate && event.endDate ? event.startDate <= key && event.endDate > key : eventStart < end && eventEnd > start)
      .map(row => row.event));
  }
  return grouped;
}
