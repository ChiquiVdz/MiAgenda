import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getGoogleCalendarClient, GoogleCalendarConnectionError } from "@/lib/google/calendar";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Inicia sesión para ver tus calendarios." }, { status: 401 });
  }

  try {
    const calendar = await getGoogleCalendarClient(userId);
    const calendars = [];
    let pageToken: string | undefined;

    do {
      const { data } = await calendar.calendarList.list({
        maxResults: 250,
        pageToken,
        fields: "items(id,summary,backgroundColor,primary,selected),nextPageToken",
      });
      calendars.push(...(data.items ?? []));
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);

    const calendarIds = calendars.flatMap((item) => item.id ? [item.id] : []);
    const subscriptions = calendarIds.length
      ? await prisma.calendarSubscription.findMany({
          where: { userId, googleCalendarId: { in: calendarIds } },
          select: { googleCalendarId: true, selected: true },
        })
      : [];
    const selectedByCalendar = new Map(
      subscriptions.map((subscription) => [subscription.googleCalendarId, subscription.selected]),
    );

    return NextResponse.json({
      calendars: calendars.flatMap((item) => {
        if (!item.id) return [];
        return [{
          id: item.id,
          summary: item.summary ?? item.id,
          color: item.backgroundColor ?? null,
          primary: item.primary ?? false,
          selected: selectedByCalendar.get(item.id) ?? item.selected ?? true,
        }];
      }),
    });
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: "No pudimos cargar tus calendarios de Google." },
      { status: 502 },
    );
  }
}
