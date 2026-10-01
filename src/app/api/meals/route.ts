import { createHash } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getGoogleCalendarClient, GoogleCalendarConnectionError } from "@/lib/google/calendar";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_AMOUNT = 999_999_999.999;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function googleStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  if ("response" in error && typeof error.response === "object" && error.response !== null && "status" in error.response) {
    return Number(error.response.status);
  }
  return "code" in error ? Number(error.code) : undefined;
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function parseRangeValue(value: string | null) {
  if (!value || !RFC3339.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function existingMeal(userId: string, idempotencyKey: string) {
  return prisma.mealPlan.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    select: { googleEventId: true, googleCalendarId: true },
  });
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para ver tu planificador." }, { status: 401 });

  const url = new URL(request.url);
  const from = parseRangeValue(url.searchParams.get("from"));
  const to = parseRangeValue(url.searchParams.get("to"));
  const rangeMs = from && to ? to.getTime() - from.getTime() : 0;
  if (!from || !to || rangeMs <= 0 || rangeMs > 14 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: "El rango del planificador debe ser de hasta dos semanas." }, { status: 400 });
  }

  try {
    const calendar = await getGoogleCalendarClient(userId);
    const calendars = [];
    let calendarPageToken: string | undefined;
    do {
      const { data } = await calendar.calendarList.list({
        maxResults: 250,
        pageToken: calendarPageToken,
        fields: "items(id,summary),nextPageToken",
      });
      calendars.push(...(data.items ?? []));
      calendarPageToken = data.nextPageToken ?? undefined;
    } while (calendarPageToken);

    const googleEvents = [];
    for (const item of calendars) {
      if (!item.id) continue;
      let eventPageToken: string | undefined;
      do {
        const { data } = await calendar.events.list({
          calendarId: item.id,
          timeMin: from.toISOString(),
          timeMax: to.toISOString(),
          singleEvents: true,
          orderBy: "startTime",
          maxResults: 2500,
          pageToken: eventPageToken,
          fields: "items(id,summary,etag,start,end,status),nextPageToken",
        });
        for (const event of data.items ?? []) {
          if (!event.id || event.status === "cancelled" || (!event.start?.date && !event.start?.dateTime)) continue;
          googleEvents.push({
            id: event.id,
            etag: event.etag ?? null,
            calendarId: item.id,
            calendarName: item.summary ?? item.id,
            summary: event.summary ?? "(Sin título)",
            startDate: event.start?.date ?? null,
            startDateTime: event.start?.dateTime ?? null,
            endDate: event.end?.date ?? null,
            endDateTime: event.end?.dateTime ?? null,
          });
        }
        eventPageToken = data.nextPageToken ?? undefined;
      } while (eventPageToken);
    }

    const mealPlans = await prisma.mealPlan.findMany({
      where: { userId },
      include: { overlay: { select: { completedAt: true } }, ingredients: true },
    });
    const byEvent = new Map(mealPlans.map((plan) => [
      `${plan.googleCalendarId}\u0000${plan.googleEventId}`,
      plan,
    ]));
    const plans = googleEvents.flatMap((event) => {
      const plan = byEvent.get(`${event.calendarId}\u0000${event.id}`);
      if (!plan) return [];
      return [{
        ...event,
        id: plan.id,
        googleEventId: event.id,
        recipeId: plan.recipeId,
        mealSlotId: plan.mealSlotId,
        servings: plan.servings,
        durationMinutes: plan.durationMinutes,
        completedAt: plan.completedAt?.toISOString() ?? plan.overlay.completedAt?.toISOString() ?? null,
        etag: event.etag,
        ingredients: plan.ingredients.map((line) => ({
          ingredientId: line.ingredientId,
          name: line.nameSnapshot,
          unit: line.unit,
          requiredQuantity: Number(line.requiredQuantity.toString()),
        })),
      }];
    });

    return NextResponse.json({ plans }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    const status = googleStatus(error);
    if (status === 401) return NextResponse.json({ error: "La conexión con Google venció o fue revocada. Vuelve a conectar tu cuenta." }, { status: 401 });
    if (status === 403) return NextResponse.json({ error: "Google no permitió consultar tus calendarios." }, { status: 403 });
    console.error("[GET /api/meals] Meal plan sync failed", { status });
    return NextResponse.json({ error: "No pudimos cargar las comidas planeadas desde Google Calendar." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para planificar una comida." }, { status: 401 });

  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)
    || typeof body.recipeId !== "string" || !body.recipeId || body.recipeId.length > 30
    || typeof body.calendarId !== "string" || !body.calendarId || body.calendarId.length > 1024
    || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 16 || body.idempotencyKey.length > 100
    || (body.mealSlotId !== undefined && body.mealSlotId !== null && (typeof body.mealSlotId !== "string" || body.mealSlotId.length > 30))
    || typeof body.startDateTime !== "string" || !RFC3339.test(body.startDateTime)
    || !Number.isFinite(new Date(body.startDateTime).getTime())
    || typeof body.servings !== "number" || !Number.isInteger(body.servings) || body.servings < 1 || body.servings > 100
    || typeof body.durationMinutes !== "number" || !Number.isInteger(body.durationMinutes) || body.durationMinutes < 5 || body.durationMinutes > 480) {
    return NextResponse.json({ error: "Revisa la receta, fecha, hora, porciones y duración." }, { status: 400 });
  }

  const { recipeId, calendarId, idempotencyKey, startDateTime, servings, durationMinutes } = body;
  const mealSlotId = typeof body.mealSlotId === "string" ? body.mealSlotId : null;
  const startTimestamp = new Date(startDateTime).getTime();
  const endDateTime = new Date(startTimestamp + durationMinutes * 60_000).toISOString();
  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, userId },
    include: {
      ingredients: {
        orderBy: { ingredient: { name: "asc" } },
        include: { ingredient: { select: { id: true, name: true, unit: true } } },
      },
    },
  });
  if (!recipe) return NextResponse.json({ error: "No encontramos esa receta en tu cuenta." }, { status: 404 });
  if (recipe.ingredients.length === 0) return NextResponse.json({ error: "Agrega ingredientes a la receta antes de planificarla." }, { status: 400 });
  if (mealSlotId && !await prisma.mealSlot.findFirst({ where: { id: mealSlotId, userId }, select: { id: true } })) {
    return NextResponse.json({ error: "No encontramos esa fila en tu planificador." }, { status: 400 });
  }

  const ingredients = recipe.ingredients.map((line) => {
    const requiredQuantity = Math.round(Number(line.quantityPerServing.toString()) * servings * 1000) / 1000;
    return { ingredientId: line.ingredient.id, name: line.ingredient.name, unit: line.ingredient.unit, requiredQuantity };
  });
  if (ingredients.some((line) => !Number.isFinite(line.requiredQuantity) || line.requiredQuantity <= 0 || line.requiredQuantity > MAX_AMOUNT)) {
    return NextResponse.json({ error: "Las cantidades de esta receta superan el límite permitido." }, { status: 400 });
  }

  const alreadyPlanned = await existingMeal(userId, idempotencyKey);
  if (alreadyPlanned) return NextResponse.json({ ...alreadyPlanned, repeated: true }, { headers: { "Cache-Control": "private, no-store" } });

  const googleEventId = `meal${createHash("sha256").update(`${userId}\u0000${calendarId}\u0000${idempotencyKey}`).digest("hex").slice(0, 40)}`;
  try {
    const calendar = await getGoogleCalendarClient(userId);
    const { data: remoteCalendar } = await calendar.calendarList.get({ calendarId });
    const subscription = await prisma.calendarSubscription.findUnique({
      where: { userId_googleCalendarId: { userId, googleCalendarId: calendarId } },
      select: { selected: true },
    });
    if (!(subscription?.selected ?? remoteCalendar.selected ?? true)) {
      return NextResponse.json({ error: "Activa ese calendario en la agenda antes de planificar comidas." }, { status: 403 });
    }

    let event;
    try {
      const response = await calendar.events.insert({
        calendarId,
        requestBody: {
          id: googleEventId,
          summary: recipe.name,
          start: { dateTime: startDateTime, timeZone: "America/Mexico_City" },
          end: { dateTime: endDateTime, timeZone: "America/Mexico_City" },
          extendedProperties: { private: { miagendaMealPlan: "1" } },
        },
        fields: "id,etag",
      });
      event = response.data;
    } catch (error) {
      if (googleStatus(error) !== 409) throw error;
      const response = await calendar.events.get({ calendarId, eventId: googleEventId });
      event = response.data;
    }
    if (!event.id) return NextResponse.json({ error: "Google no devolvió el identificador de la comida." }, { status: 502 });

    try {
      const mealPlan = await prisma.$transaction(async (tx) => {
        const overlay = await tx.eventOverlay.create({
          data: {
            userId,
            googleCalendarId: calendarId,
            googleEventId: event.id!,
            etag: event.etag ?? null,
            kind: "meal",
          },
          select: { id: true },
        });
        const plan = await tx.mealPlan.create({
          data: {
            userId,
            recipeId: recipe.id,
            overlayId: overlay.id,
            mealSlotId,
            googleCalendarId: calendarId,
            googleEventId: event.id!,
            idempotencyKey,
            servings,
            durationMinutes,
            ingredients: {
              create: ingredients.map((line) => ({
                nameSnapshot: line.name,
                unit: line.unit,
                requiredQuantity: line.requiredQuantity,
                ingredient: { connect: { id: line.ingredientId } },
              })),
            },
          },
          select: { id: true, googleEventId: true, googleCalendarId: true },
        });
        return plan;
      });
      return NextResponse.json(mealPlan, { status: 201, headers: { "Cache-Control": "private, no-store" } });
    } catch (error) {
      if (isUniqueConflict(error)) {
        const repeated = await existingMeal(userId, idempotencyKey);
        if (repeated) return NextResponse.json({ ...repeated, repeated: true }, { headers: { "Cache-Control": "private, no-store" } });
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    const status = googleStatus(error);
    if (status === 404) return NextResponse.json({ error: "Ese calendario ya no está disponible." }, { status: 404 });
    if (status === 403) return NextResponse.json({ error: "Google no permitió planificar la comida en ese calendario." }, { status: 403 });
    console.error("[POST /api/meals] Meal planning failed", { status });
    return NextResponse.json({ error: "No pudimos guardar la comida planificada. Puedes volver a intentarlo sin crear un evento duplicado." }, { status: 502 });
  }
}
