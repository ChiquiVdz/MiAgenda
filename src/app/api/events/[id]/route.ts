import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getGoogleCalendarClient, GoogleCalendarConnectionError } from "@/lib/google/calendar";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isDateTime(value: unknown): value is string {
  return typeof value === "string"
    && RFC3339.test(value)
    && isDateOnly(value.slice(0, 10))
    && Number.isFinite(new Date(value).getTime());
}

function googleStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  if ("response" in error && typeof error.response === "object" && error.response !== null && "status" in error.response) {
    return Number(error.response.status);
  }
  return "code" in error ? Number(error.code) : undefined;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Inicia sesión para editar una actividad." }, { status: 401 });
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
    || typeof body.etag !== "string" || body.etag.length === 0 || body.etag.length > 300
    || typeof body.summary !== "string" || body.summary.trim().length === 0 || body.summary.trim().length > 250
    || typeof body.allDay !== "boolean") {
    return NextResponse.json({ error: "Revisa el título y los datos de la actividad." }, { status: 400 });
  }

  let start: { date: string } | { dateTime: string; timeZone: string };
  let end: { date: string } | { dateTime: string; timeZone: string };
  if (body.allDay) {
    if (!isDateOnly(body.startDate) || !isDateOnly(body.endDate) || body.endDate <= body.startDate) {
      return NextResponse.json({ error: "La fecha final debe ser posterior a la fecha inicial." }, { status: 400 });
    }
    start = { date: body.startDate };
    end = { date: body.endDate };
  } else {
    if (!isDateTime(body.startDateTime) || !isDateTime(body.endDateTime)) {
      return NextResponse.json({ error: "Revisa la fecha y hora de la actividad." }, { status: 400 });
    }
    const startTime = new Date(body.startDateTime).getTime();
    const endTime = new Date(body.endDateTime).getTime();
    if (endTime <= startTime) {
      return NextResponse.json({ error: "La hora final debe ser posterior a la hora inicial." }, { status: 400 });
    }
    start = { dateTime: body.startDateTime, timeZone: "America/Mexico_City" };
    end = { dateTime: body.endDateTime, timeZone: "America/Mexico_City" };
  }

  const { id: eventId } = await params;
  const calendarId = body.calendarId;
  try {
    const calendar = await getGoogleCalendarClient(userId);
    const { data: remoteCalendar } = await calendar.calendarList.get({ calendarId });
    const subscription = await prisma.calendarSubscription.findUnique({
      where: { userId_googleCalendarId: { userId, googleCalendarId: calendarId } },
      select: { selected: true },
    });
    if (!(subscription?.selected ?? remoteCalendar.selected ?? true)) {
      return NextResponse.json({ error: "Activa ese calendario en la lista para editar actividades." }, { status: 403 });
    }

    const { data: currentEvent } = await calendar.events.get({ calendarId: body.calendarId, eventId });
    if (!currentEvent.etag || currentEvent.etag !== body.etag) {
      return NextResponse.json({ error: "Este evento cambió en Google Calendar. Recarga la semana antes de guardar." }, { status: 409 });
    }

    const { data: updatedEvent } = await calendar.events.patch({
      calendarId: body.calendarId,
      eventId,
      requestBody: { summary: body.summary.trim(), start, end },
      fields: "id,summary,etag,start,end",
    }, { headers: { "If-Match": currentEvent.etag } });
    return NextResponse.json({ id: updatedEvent.id, summary: updatedEvent.summary }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const status = googleStatus(error);
    if (status === 404) {
      return NextResponse.json({ error: "El evento o el calendario ya no están disponibles." }, { status: 404 });
    }
    if (status === 403) {
      return NextResponse.json({ error: "Google no permitió editar este evento." }, { status: 403 });
    }
    if (status === 412) {
      return NextResponse.json({ error: "Este evento cambió en Google Calendar. Recarga la semana antes de guardar." }, { status: 409 });
    }
    return NextResponse.json({ error: "No pudimos actualizar el evento en Google Calendar." }, { status: 502 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Inicia sesión para eliminar una actividad." }, { status: 401 });
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
    || typeof body.etag !== "string" || body.etag.length === 0 || body.etag.length > 300) {
    return NextResponse.json({ error: "No pudimos verificar el evento que quieres eliminar." }, { status: 400 });
  }

  const { id: eventId } = await params;
  const calendarId = body.calendarId;
  const expectedEtag = body.etag;
  try {
    const calendar = await getGoogleCalendarClient(userId);
    const { data: remoteCalendar } = await calendar.calendarList.get({ calendarId });
    const subscription = await prisma.calendarSubscription.findUnique({
      where: { userId_googleCalendarId: { userId, googleCalendarId: calendarId } },
      select: { selected: true },
    });
    if (!(subscription?.selected ?? remoteCalendar.selected ?? true)) {
      return NextResponse.json({ error: "Activa ese calendario en la lista para eliminar actividades." }, { status: 403 });
    }

    const removeOverlay = () => prisma.eventOverlay.deleteMany({
      where: { userId, googleCalendarId: calendarId, googleEventId: eventId },
    });
    let currentEvent;
    try {
      const response = await calendar.events.get({ calendarId, eventId });
      currentEvent = response.data;
    } catch (error) {
      if (googleStatus(error) !== 404) throw error;
      await removeOverlay();
      return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
    }

    if (!currentEvent.etag || currentEvent.etag !== expectedEtag) {
      return NextResponse.json({ error: "Este evento cambió en Google Calendar. Recarga la semana antes de eliminarlo." }, { status: 409 });
    }

    try {
      await calendar.events.delete({ calendarId, eventId, sendUpdates: "none" }, {
        headers: { "If-Match": currentEvent.etag },
      });
    } catch (error) {
      if (googleStatus(error) !== 404) throw error;
    }
    await removeOverlay();
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    const status = googleStatus(error);
    if (status === 404) {
      return NextResponse.json({ error: "Ese calendario ya no está disponible." }, { status: 404 });
    }
    if (status === 403) {
      return NextResponse.json({ error: "Google no permitió eliminar este evento." }, { status: 403 });
    }
    if (status === 412) {
      return NextResponse.json({ error: "Este evento cambió en Google Calendar. Recarga la semana antes de eliminarlo." }, { status: 409 });
    }
    return NextResponse.json({ error: "No pudimos eliminar el evento de Google Calendar." }, { status: 502 });
  }
}
