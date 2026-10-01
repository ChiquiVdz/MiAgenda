import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getGoogleCalendarClient, GoogleCalendarConnectionError } from "@/lib/google/calendar";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseRangeValue(value: string | null) {
  if (!value || !RFC3339.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidDateTime(value: unknown): value is string {
  return typeof value === "string"
    && RFC3339.test(value)
    && isValidDateOnly(value.slice(0, 10))
    && Number.isFinite(new Date(value).getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getCalendarErrorDetails(error: unknown) {
  if (!isRecord(error)) return { name: "UnknownError", code: null, googleStatus: null };
  const response = isRecord(error.response) ? error.response : null;
  const name = typeof error.name === "string" ? error.name.slice(0, 80) : "UnknownError";
  const code = typeof error.code === "string" || typeof error.code === "number"
    ? String(error.code).slice(0, 80)
    : null;
  const googleStatus = typeof response?.status === "number" ? response.status : null;
  return { name, code, googleStatus };
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Inicia sesión para ver tus eventos." }, { status: 401 });
  }

  const url = new URL(request.url);
  const from = parseRangeValue(url.searchParams.get("from"));
  const to = parseRangeValue(url.searchParams.get("to"));
  const rangeMs = from && to ? to.getTime() - from.getTime() : 0;
  if (!from || !to || rangeMs <= 0 || rangeMs > 8 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "El rango de fechas no es válido." }, { status: 400 });
  }

  try {
    const calendar = await getGoogleCalendarClient(userId);
    const googleCalendars = [];
    let calendarPageToken: string | undefined;
    do {
      const { data } = await calendar.calendarList.list({
        maxResults: 250,
        pageToken: calendarPageToken,
        fields: "items(id,summary,backgroundColor,primary,selected),nextPageToken",
      });
      googleCalendars.push(...(data.items ?? []));
      calendarPageToken = data.nextPageToken ?? undefined;
    } while (calendarPageToken);

    const calendarIds = googleCalendars.flatMap((item) => item.id ? [item.id] : []);
    const subscriptions = calendarIds.length
      ? await prisma.calendarSubscription.findMany({
          where: { userId, googleCalendarId: { in: calendarIds } },
          select: { googleCalendarId: true, selected: true },
        })
      : [];
    const selectedByCalendar = new Map(
      subscriptions.map(({ googleCalendarId, selected }) => [googleCalendarId, selected]),
    );
    const selectedCalendars = googleCalendars.flatMap((item) => {
      if (!item.id || !(selectedByCalendar.get(item.id) ?? item.selected ?? true)) return [];
      return [{
        id: item.id,
        summary: item.summary ?? item.id,
        color: item.backgroundColor ?? null,
        primary: item.primary ?? false,
      }];
    });

    const events = [];
    for (const selectedCalendar of selectedCalendars) {
      let pageToken: string | undefined;
      do {
        const { data } = await calendar.events.list({
          calendarId: selectedCalendar.id,
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken,
          fields: "items(id,summary,description,start,end,status,htmlLink,recurringEventId,etag),nextPageToken",
        });
        for (const event of data.items ?? []) {
          if (!event.id || event.status === "cancelled" || (!event.start?.date && !event.start?.dateTime) || (!event.end?.date && !event.end?.dateTime)) continue;
          events.push({
            id: event.id,
            calendarId: selectedCalendar.id,
            calendarName: selectedCalendar.summary,
            color: selectedCalendar.color,
            summary: event.summary ?? "(Sin título)",
            startDate: event.start?.date ?? null,
            endDate: event.end?.date ?? null,
            startDateTime: event.start?.dateTime ?? null,
            endDateTime: event.end?.dateTime ?? null,
            recurringEventId: event.recurringEventId ?? null,
            etag: event.etag ?? null,
          });
        }
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);
    }

    const eventIds = [...new Set(events.map((event) => event.id))];
    const overlays = eventIds.length && selectedCalendars.length
      ? await prisma.eventOverlay.findMany({
          where: {
            userId,
            googleCalendarId: { in: selectedCalendars.map(({ id }) => id) },
            googleEventId: { in: eventIds },
          },
          select: {
            googleCalendarId: true,
            googleEventId: true,
            completedAt: true,
            keep: true,
            kind: true,
          },
        })
      : [];
    const overlayByEvent = new Map(overlays.map((overlay) => [
      `${overlay.googleCalendarId}\u0000${overlay.googleEventId}`,
      { completedAt: overlay.completedAt?.toISOString() ?? null, keep: overlay.keep, kind: overlay.kind },
    ]));

    return NextResponse.json({ events: events.map((event) => ({
      ...event,
      overlay: overlayByEvent.get(`${event.calendarId}\u0000${event.id}`) ?? null,
    })) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const details = getCalendarErrorDetails(error);
    console.error("[GET /api/events] Calendar sync failed", details);
    if (details.googleStatus === 401) {
      return NextResponse.json(
        { error: "La conexión con Google venció o fue revocada. Vuelve a conectar tu cuenta." },
        { status: 401 },
      );
    }
    if (details.googleStatus === 403) {
      return NextResponse.json(
        { error: "Google no permitió consultar los eventos. Revisa los permisos de Calendar de la conexión." },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "No pudimos cargar los eventos de Google Calendar." },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Inicia sesión para crear una actividad." }, { status: 401 });
  }

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)
    || typeof body.calendarId !== "string" || body.calendarId.trim().length === 0 || body.calendarId.length > 1024
    || typeof body.summary !== "string" || body.summary.trim().length === 0 || body.summary.trim().length > 250
    || typeof body.allDay !== "boolean") {
    return NextResponse.json({ error: "Revisa el título y el calendario de la actividad." }, { status: 400 });
  }

  let start: { date: string } | { dateTime: string; timeZone: string };
  let end: { date: string } | { dateTime: string; timeZone: string };
  if (body.allDay) {
    if (!isValidDateOnly(body.startDate) || !isValidDateOnly(body.endDate) || body.endDate <= body.startDate) {
      return NextResponse.json({ error: "La fecha final debe ser posterior a la fecha inicial." }, { status: 400 });
    }
    start = { date: body.startDate };
    end = { date: body.endDate };
  } else {
    if (!isValidDateTime(body.startDateTime) || !isValidDateTime(body.endDateTime)) {
      return NextResponse.json({ error: "Revisa la fecha y hora de la actividad." }, { status: 400 });
    }
    const startTime = new Date(body.startDateTime).getTime();
    const endTime = new Date(body.endDateTime).getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      return NextResponse.json({ error: "La hora final debe ser posterior a la hora inicial." }, { status: 400 });
    }
    start = { dateTime: body.startDateTime, timeZone: "America/Mexico_City" };
    end = { dateTime: body.endDateTime, timeZone: "America/Mexico_City" };
  }

  try {
    const calendar = await getGoogleCalendarClient(userId);
    const { data: remoteCalendar } = await calendar.calendarList.get({ calendarId: body.calendarId });
    const subscription = await prisma.calendarSubscription.findUnique({
      where: { userId_googleCalendarId: { userId, googleCalendarId: body.calendarId } },
      select: { selected: true },
    });
    if (!(subscription?.selected ?? remoteCalendar.selected ?? true)) {
      return NextResponse.json({ error: "Activa ese calendario en la lista para crear actividades." }, { status: 403 });
    }

    const { data: event } = await calendar.events.insert({
      calendarId: body.calendarId,
      requestBody: { summary: body.summary.trim(), start, end },
      fields: "id,summary,start,end",
    });
    if (!event.id) {
      return NextResponse.json({ error: "Google no devolvió el identificador del evento." }, { status: 502 });
    }
    return NextResponse.json({ id: event.id, summary: event.summary ?? body.summary.trim() }, {
      status: 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const status = typeof error === "object" && error !== null && "code" in error
      ? Number(error.code)
      : undefined;
    if (status === 404) {
      return NextResponse.json({ error: "Ese calendario ya no está disponible." }, { status: 404 });
    }
    if (status === 403) {
      return NextResponse.json({ error: "Google no permitió crear la actividad en ese calendario." }, { status: 403 });
    }
    return NextResponse.json({ error: "No pudimos crear la actividad en Google Calendar." }, { status: 502 });
  }
}
