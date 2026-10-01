import { NextResponse } from "next/server";
import { getGoogleCalendarClient, GoogleCalendarConnectionError } from "@/lib/google/calendar";
import { eventPurgeAfter } from "@/lib/google/event-retention";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function googleStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  if ("response" in error && typeof error.response === "object" && error.response !== null && "status" in error.response) {
    return Number(error.response.status);
  }
  return "code" in error ? Number(error.code) : undefined;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "La tarea de retención no está configurada." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const now = new Date();
  const staleClaimBefore = new Date(now.getTime() - 30 * 60 * 1000);
  const overlays = await prisma.eventOverlay.findMany({
    where: {
      keep: false,
      completedAt: { not: null },
      purgeAfter: { lte: now },
      OR: [{ purgeStartedAt: null }, { purgeStartedAt: { lt: staleClaimBefore } }],
    },
    orderBy: { purgeAfter: "asc" },
    take: 50,
    select: {
      id: true,
      userId: true,
      googleCalendarId: true,
      googleEventId: true,
      completedAt: true,
    },
  });

  const clients = new Map<string, Awaited<ReturnType<typeof getGoogleCalendarClient>>>();
  let deleted = 0;
  let alreadyMissing = 0;
  let deferred = 0;
  let failed = 0;

  for (const overlay of overlays) {
    const key = { userId: overlay.userId, googleCalendarId: overlay.googleCalendarId, googleEventId: overlay.googleEventId };
    const claimStartedAt = new Date();
    try {
      const claim = await prisma.eventOverlay.updateMany({
        where: {
          id: overlay.id,
          keep: false,
          completedAt: { not: null },
          purgeAfter: { lte: now },
          OR: [{ purgeStartedAt: null }, { purgeStartedAt: { lt: staleClaimBefore } }],
        },
        data: { purgeStartedAt: claimStartedAt },
      });
      if (!claim.count) {
        deferred += 1;
        continue;
      }

      let calendar = clients.get(overlay.userId);
      if (!calendar) {
        calendar = await getGoogleCalendarClient(overlay.userId);
        clients.set(overlay.userId, calendar);
      }

      let event;
      try {
        const result = await calendar.events.get({ calendarId: overlay.googleCalendarId, eventId: overlay.googleEventId });
        event = result.data;
      } catch (error) {
        if (googleStatus(error) !== 404) throw error;
        await prisma.eventOverlay.deleteMany({
          where: { id: overlay.id, purgeStartedAt: claimStartedAt },
        });
        alreadyMissing += 1;
        continue;
      }

      // A recurring master represents the whole series. Never purge it.
      if (event.recurrence?.length) {
        await prisma.eventOverlay.updateMany({
          where: { id: overlay.id, purgeStartedAt: claimStartedAt },
          data: { purgeAfter: null, purgeStartedAt: null },
        });
        deferred += 1;
        continue;
      }

      const latestPurgeAfter = overlay.completedAt ? eventPurgeAfter(overlay.completedAt, event.end) : null;
      if (!latestPurgeAfter) {
        await prisma.eventOverlay.updateMany({ where: { id: overlay.id, purgeStartedAt: claimStartedAt }, data: { purgeStartedAt: null } });
        deferred += 1;
        continue;
      }
      if (latestPurgeAfter > now) {
        await prisma.eventOverlay.updateMany({
          where: { id: overlay.id, purgeStartedAt: claimStartedAt },
          data: { purgeAfter: latestPurgeAfter, purgeStartedAt: null, etag: event.etag ?? null },
        });
        deferred += 1;
        continue;
      }

      // Recheck the overlay immediately before the external delete so a recent
      // uncomplete or Conservar action cancels an event already in this batch.
      const beforeDelete = await prisma.eventOverlay.findUnique({
        where: { userId_googleCalendarId_googleEventId: key },
        select: { id: true, keep: true, completedAt: true, purgeAfter: true, purgeStartedAt: true },
      });
      if (!beforeDelete || beforeDelete.keep || !beforeDelete.completedAt || !beforeDelete.purgeAfter || beforeDelete.purgeAfter > now || beforeDelete.purgeStartedAt?.getTime() !== claimStartedAt.getTime()) {
        await prisma.eventOverlay.updateMany({ where: { id: overlay.id, purgeStartedAt: claimStartedAt }, data: { purgeStartedAt: null } });
        deferred += 1;
        continue;
      }
      if (!event.etag) {
        await prisma.eventOverlay.updateMany({ where: { id: overlay.id, purgeStartedAt: claimStartedAt }, data: { purgeStartedAt: null } });
        failed += 1;
        continue;
      }

      let removedFromGoogle = false;
      try {
        await calendar.events.delete({
          calendarId: overlay.googleCalendarId,
          eventId: overlay.googleEventId,
          sendUpdates: "none",
        }, { headers: { "If-Match": event.etag } });
        removedFromGoogle = true;
      } catch (error) {
        const status = googleStatus(error);
        if (status === 404) {
          alreadyMissing += 1;
        } else if (status === 412) {
          await prisma.eventOverlay.updateMany({ where: { id: overlay.id, purgeStartedAt: claimStartedAt }, data: { purgeStartedAt: null } });
          deferred += 1;
          continue;
        } else {
          throw error;
        }
      }

      await prisma.eventOverlay.deleteMany({ where: { id: overlay.id, purgeStartedAt: claimStartedAt } });
      if (removedFromGoogle) deleted += 1;
    } catch (error) {
      await prisma.eventOverlay.updateMany({ where: { id: overlay.id, purgeStartedAt: claimStartedAt }, data: { purgeStartedAt: null } }).catch(() => undefined);
      failed += 1;
      const status = googleStatus(error);
      const code = typeof error === "object" && error !== null && "code" in error
        && (typeof error.code === "string" || typeof error.code === "number")
        ? String(error.code).slice(0, 60)
        : null;
      console.error("[retention] Event cleanup failed", {
        name: error instanceof Error ? error.name.slice(0, 60) : "UnknownError",
        status: status ?? null,
        code,
        connectionError: error instanceof GoogleCalendarConnectionError,
      });
    }
  }

  return NextResponse.json({ processed: overlays.length, deleted, alreadyMissing, deferred, failed }, {
    headers: { "Cache-Control": "no-store" },
  });
}
