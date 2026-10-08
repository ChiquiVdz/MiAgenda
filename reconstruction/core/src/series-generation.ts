import type { Prisma, SeriesSegment } from "../generated/client.ts";
import { CoreError } from "./errors.ts";
import { occurrenceAt, storedRule } from "./recurrence.ts";

export const generationSize = BigInt(4000001);
export function segmentEnd(segment: SeriesSegment) { return segment.toOrdinal ?? segment.ordinalOffset + generationSize; }
export function segmentOccurrence(segment: SeriesSegment, ordinal: number) {
  const occurrence = occurrenceAt(segment.anchorLocal, storedRule(segment.rrule, segment.untilDate, segment.anchorLocal), ordinal - Number(segment.ordinalOffset));
  return { ...occurrence, ordinal };
}
/** Date order remains independent of ordinal namespaces and moved schedules. */
export function ordinalFromDate(segment: SeriesSegment, date: string) {
  let low = Number(segment.fromOrdinal), high = Number(segmentEnd(segment));
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    let before = false;
    try { before = segmentOccurrence(segment, mid).date < date; }
    catch (error) { if (!(error instanceof CoreError) || error.code !== "INVALID_INPUT") throw error; }
    if (before) low = mid + 1; else high = mid;
  }
  return BigInt(low);
}
export async function splitSegment(tx: Prisma.TransactionClient, segment: SeriesSegment, boundary: bigint) {
  if (boundary <= segment.fromOrdinal) return segment;
  if (boundary >= segmentEnd(segment)) return null;
  const steps = await tx.seriesStepDefinition.findMany({ where: { segmentId: segment.id, userId: segment.userId } });
  // Callers may include steps/series relations; never spread those into CREATE.
  const plain = await tx.seriesSegment.findUniqueOrThrow({ where: { id: segment.id, userId: segment.userId } });
  const { id: _id, ...data } = plain;
  await tx.seriesSegment.update({ where: { id: segment.id }, data: { toOrdinal: boundary } });
  const next = await tx.seriesSegment.create({ data: { ...data, protectedRanges: data.protectedRanges as Prisma.InputJsonValue, fromOrdinal: boundary } });
  for (const { id: _step, segmentId: _segment, ...step } of steps) await tx.seriesStepDefinition.create({ data: { ...step, scheduleHistory: step.scheduleHistory as Prisma.InputJsonValue, segmentId: next.id } });
  return next;
}
export async function scopeSegments(tx: Prisma.TransactionClient, userId: string, seriesId: string, fromDate: string | null) {
  const segments = await tx.seriesSegment.findMany({ where: { userId, seriesId }, orderBy: { fromOrdinal: "asc" } });
  const result: SeriesSegment[] = [];
  for (const segment of segments) {
    const boundary = fromDate ? ordinalFromDate(segment, fromDate) : segment.fromOrdinal;
    const selected = await splitSegment(tx, segment, boundary);
    if (selected) result.push(selected);
  }
  return result;
}
