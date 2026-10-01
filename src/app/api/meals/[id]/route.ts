import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getGoogleCalendarClient, GoogleCalendarConnectionError } from "@/lib/google/calendar";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_AMOUNT = 999_999_999.999;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function googleStatus(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  if ("response" in error && typeof error.response === "object" && error.response !== null && "status" in error.response) return Number(error.response.status);
  return "code" in error ? Number(error.code) : undefined;
}
class MealEditError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para editar esta comida." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.recipeId !== "string" || !body.recipeId || body.recipeId.length > 30
    || typeof body.etag !== "string" || !body.etag || body.etag.length > 300
    || typeof body.startDateTime !== "string" || !RFC3339.test(body.startDateTime) || !Number.isFinite(new Date(body.startDateTime).getTime())
    || typeof body.servings !== "number" || !Number.isInteger(body.servings) || body.servings < 1 || body.servings > 100
    || typeof body.durationMinutes !== "number" || !Number.isInteger(body.durationMinutes) || body.durationMinutes < 5 || body.durationMinutes > 480) {
    return NextResponse.json({ error: "Revisa la receta, fecha, hora, porciones y duración." }, { status: 400 });
  }
  const { id } = await params;
  const servings = body.servings as number;
  const durationMinutes = body.durationMinutes as number;
  const startDateTime = body.startDateTime as string;
  const plan = await prisma.mealPlan.findFirst({ where: { id, userId }, include: { overlay: true } });
  if (!plan) return NextResponse.json({ error: "No encontramos esta comida planeada." }, { status: 404 });
  if (plan.completedAt || plan.overlay.completedAt) return NextResponse.json({ error: "Deshaz el completado desde la agenda antes de editar esta comida." }, { status: 409 });
  if (plan.overlay.purgeStartedAt) return NextResponse.json({ error: "La retención está procesando esta comida. Inténtalo de nuevo en un momento." }, { status: 409 });

  const recipe = await prisma.recipe.findFirst({
    where: { id: body.recipeId, userId },
    include: { ingredients: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
  });
  if (!recipe) return NextResponse.json({ error: "No encontramos esa receta en tu cuenta." }, { status: 404 });
  if (!recipe.ingredients.length) return NextResponse.json({ error: "La receta no tiene ingredientes." }, { status: 400 });
  const ingredients = recipe.ingredients.map((line) => ({
    ingredientId: line.ingredientId,
    nameSnapshot: line.ingredient.name,
    unit: line.ingredient.unit,
    requiredQuantity: Math.round(Number(line.quantityPerServing.toString()) * servings * 1000) / 1000,
  }));
  if (ingredients.some((line) => !Number.isFinite(line.requiredQuantity) || line.requiredQuantity <= 0 || line.requiredQuantity > MAX_AMOUNT)) {
    return NextResponse.json({ error: "Las cantidades de esta receta superan el límite permitido." }, { status: 400 });
  }
  const startTime = new Date(startDateTime).getTime();
  const endDateTime = new Date(startTime + durationMinutes * 60_000).toISOString();

  try {
    const calendar = await getGoogleCalendarClient(userId);
    const { data: currentEvent } = await calendar.events.get({ calendarId: plan.googleCalendarId, eventId: plan.googleEventId });
    if (!currentEvent.etag || currentEvent.etag !== body.etag) throw new MealEditError(409, "Esta comida cambió en Google Calendar. Actualiza Planificar antes de guardar.");
    if (currentEvent.extendedProperties?.private?.miagendaMealPlan !== "1") throw new MealEditError(409, "El evento ya no está vinculado a esta comida de MiAgenda.");
    const { data: updatedEvent } = await calendar.events.patch({
      calendarId: plan.googleCalendarId,
      eventId: plan.googleEventId,
      requestBody: {
        summary: recipe.name,
        start: { dateTime: startDateTime, timeZone: "America/Mexico_City" },
        end: { dateTime: endDateTime, timeZone: "America/Mexico_City" },
      },
      fields: "id,etag",
    }, { headers: { "If-Match": currentEvent.etag } });
    try {
      await prisma.$transaction(async (tx) => {
        const changed = await tx.mealPlan.updateMany({
          where: { id, userId, completedAt: null },
          data: { recipeId: recipe.id, servings, durationMinutes },
        });
        if (!changed.count) throw new MealEditError(409, "La comida cambió de estado mientras se guardaba. Actualiza el planificador.");
        await tx.mealPlanIngredient.deleteMany({ where: { mealPlanId: id } });
        await tx.mealPlanIngredient.createMany({ data: ingredients.map((line) => ({ mealPlanId: id, ...line })) });
        await tx.eventOverlay.update({ where: { id: plan.overlayId }, data: { etag: updatedEvent.etag ?? null } });
      });
    } catch (databaseError) {
      try {
        await calendar.events.patch({
          calendarId: plan.googleCalendarId,
          eventId: plan.googleEventId,
          requestBody: { summary: currentEvent.summary, start: currentEvent.start, end: currentEvent.end },
        }, updatedEvent.etag ? { headers: { "If-Match": updatedEvent.etag } } : undefined);
      } catch { /* The next calendar sync will surface an external edit conflict. */ }
      throw databaseError;
    }
    return NextResponse.json({ id, summary: recipe.name, etag: updatedEvent.etag }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof MealEditError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof GoogleCalendarConnectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    const status = googleStatus(error);
    if (status === 404) return NextResponse.json({ error: "El evento ya no existe en Google Calendar." }, { status: 404 });
    if (status === 412) return NextResponse.json({ error: "Esta comida cambió en Google Calendar. Actualiza Planificar antes de guardar." }, { status: 409 });
    console.error("[PATCH /api/meals/:id] Failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "No pudimos actualizar esta comida." }, { status: 502 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para eliminar esta comida." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.etag !== "string" || !body.etag) return NextResponse.json({ error: "No pudimos verificar el evento." }, { status: 400 });
  const { id } = await params;
  const plan = await prisma.mealPlan.findFirst({ where: { id, userId }, include: { overlay: true } });
  if (!plan) return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  if (plan.completedAt || plan.overlay.completedAt) {
    return NextResponse.json({ error: "Deshaz el completado desde la agenda antes de eliminar esta comida." }, { status: 409 });
  }
  if (plan.overlay.purgeStartedAt) return NextResponse.json({ error: "La retención está procesando esta comida." }, { status: 409 });
  try {
    const calendar = await getGoogleCalendarClient(userId);
    try {
      const { data: event } = await calendar.events.get({ calendarId: plan.googleCalendarId, eventId: plan.googleEventId });
      if (event.etag !== body.etag) return NextResponse.json({ error: "Esta comida cambió en Google Calendar. Actualiza Planificar antes de eliminarla." }, { status: 409 });
      await calendar.events.delete({ calendarId: plan.googleCalendarId, eventId: plan.googleEventId, sendUpdates: "none" }, { headers: { "If-Match": event.etag ?? body.etag as string } });
    } catch (error) {
      if (googleStatus(error) !== 404) throw error;
    }
    const removed = await prisma.$transaction(async (tx) => {
      const deleted = await tx.mealPlan.deleteMany({ where: { id, userId, completedAt: null } });
      if (!deleted.count) return false;
      await tx.eventOverlay.deleteMany({ where: { id: plan.overlayId, userId, purgeStartedAt: null } });
      return true;
    });
    if (!removed) return NextResponse.json({ error: "La comida cambió de estado durante la eliminación. Revisa la agenda." }, { status: 409 });
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) return NextResponse.json({ error: error.message }, { status: 409 });
    const status = googleStatus(error);
    if (status === 403) return NextResponse.json({ error: "Google no permitió eliminar esta comida." }, { status: 403 });
    if (status === 412) return NextResponse.json({ error: "Esta comida cambió en Google Calendar. Actualiza Planificar antes de eliminarla." }, { status: 409 });
    console.error("[DELETE /api/meals/:id] Failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "No pudimos eliminar esta comida de Google Calendar." }, { status: 502 });
  }
}
