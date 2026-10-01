const RETENTION_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;

type GoogleEventEnd = { date?: string | null; dateTime?: string | null } | null | undefined;

function eventEndAt(end: GoogleEventEnd) {
  const endTime = end?.dateTime
    ? new Date(end.dateTime)
    : end?.date
      ? new Date(`${end.date}T00:00:00-06:00`)
      : null;
  return endTime && Number.isFinite(endTime.getTime()) ? endTime : null;
}

export function eventPurgeAfter(completedAt: Date, end?: GoogleEventEnd) {
  if (!Number.isFinite(completedAt.getTime())) return null;
  const afterCompletion = new Date(completedAt.getTime() + RETENTION_DAYS * DAY_MS);
  const eventEnd = eventEndAt(end);
  if (!eventEnd) return null;

  // Preserve future events. If they were completed early, the purge becomes
  // eligible only after both the five-day window and the event itself end.
  return eventEnd > afterCompletion ? eventEnd : afterCompletion;
}
