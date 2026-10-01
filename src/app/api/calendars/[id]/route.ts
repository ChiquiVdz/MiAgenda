import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getGoogleCalendarClient, GoogleCalendarConnectionError } from "@/lib/google/calendar";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Inicia sesión para cambiar tus calendarios." }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || !("selected" in body) || typeof body.selected !== "boolean") {
    return NextResponse.json({ error: "La selección del calendario no es válida." }, { status: 400 });
  }

  const { id: calendarId } = await params;
  try {
    const calendar = await getGoogleCalendarClient(userId);
    const { data: remoteCalendar } = await calendar.calendarList.get({ calendarId });
    const subscription = await prisma.calendarSubscription.upsert({
      where: { userId_googleCalendarId: { userId, googleCalendarId: calendarId } },
      update: {
        selected: body.selected,
        summarySnapshot: remoteCalendar.summary ?? null,
        color: remoteCalendar.backgroundColor ?? null,
      },
      create: {
        userId,
        googleCalendarId: calendarId,
        selected: body.selected,
        summarySnapshot: remoteCalendar.summary ?? null,
        color: remoteCalendar.backgroundColor ?? null,
      },
      select: { googleCalendarId: true, selected: true },
    });

    return NextResponse.json({
      id: subscription.googleCalendarId,
      selected: subscription.selected,
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
    return NextResponse.json(
      { error: "No pudimos guardar la selección del calendario." },
      { status: 502 },
    );
  }
}
