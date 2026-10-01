import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { getGoogleCalendarClient, GoogleCalendarConnectionError } from "@/lib/google/calendar";
import { eventPurgeAfter } from "@/lib/google/event-retention";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

class MealActionError extends Error {
  constructor(message: string, readonly details?: Array<{ name: string; unit: string; missingQuantity: number }>) {
    super(message);
    this.name = "MealActionError";
  }
}

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Inicia sesión para actualizar una actividad." }, { status: 401 });
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
    || typeof body.calendarId !== "string"
    || body.calendarId.trim().length === 0
    || body.calendarId.length > 1024) {
    return NextResponse.json({ error: "No pudimos verificar el calendario de esta actividad." }, { status: 400 });
  }

  const { id: eventId, action } = await params;
  if (!eventId || !["complete", "uncomplete", "keep", "unkeep"].includes(action)) {
    return NextResponse.json({ error: "La acción solicitada no está disponible." }, { status: 404 });
  }

  const calendarId = body.calendarId;
  try {
    const calendar = await getGoogleCalendarClient(userId);
    const { data: remoteCalendar } = await calendar.calendarList.get({ calendarId });
    const subscription = await prisma.calendarSubscription.findUnique({
      where: { userId_googleCalendarId: { userId, googleCalendarId: calendarId } },
      select: { selected: true },
    });
    if (!(subscription?.selected ?? remoteCalendar.selected ?? true)) {
      return NextResponse.json({ error: "Activa ese calendario para actualizar la actividad." }, { status: 403 });
    }

    const { data: event } = await calendar.events.get({ calendarId, eventId });
    if (event.status === "cancelled") {
      return NextResponse.json({ error: "Este evento ya no existe en Google Calendar." }, { status: 404 });
    }

    const key = { userId, googleCalendarId: calendarId, googleEventId: eventId };
    const existingOverlay = await prisma.eventOverlay.findUnique({
      where: { userId_googleCalendarId_googleEventId: key },
      select: { purgeStartedAt: true },
    });
    if (existingOverlay?.purgeStartedAt) {
      return NextResponse.json({ error: "La retención está procesando esta actividad. Inténtalo de nuevo en un momento." }, { status: 409 });
    }

    let completedAt: Date | null = null;
    if (action === "complete") {
      const now = new Date();
      const data = { completedAt: now, purgeAfter: eventPurgeAfter(now, event.end), etag: event.etag ?? null };
      const mealPlan = await prisma.mealPlan.findUnique({
        where: { userId_googleCalendarId_googleEventId: key },
        select: { id: true },
      });
      if (mealPlan) {
        await prisma.$transaction(async (tx) => {
          const plan = await tx.mealPlan.findUniqueOrThrow({
            where: { id: mealPlan.id },
            include: { ingredients: true },
          });
          if (plan.completedAt) return;

          const claim = await tx.mealPlan.updateMany({
            where: { id: plan.id, userId, completedAt: null },
            data: { completedAt: now },
          });
          if (!claim.count) return;

          const shortages: Array<{ name: string; unit: string; missingQuantity: number }> = [];
          for (const line of plan.ingredients) {
            const amount = Number(line.requiredQuantity.toString());
            const update = await tx.pantryItem.updateMany({
              where: { userId, ingredientId: line.ingredientId, quantity: { gte: amount } },
              data: { quantity: { decrement: amount } },
            });
            if (!update.count) {
              const available = await tx.pantryItem.findUnique({
                where: { userId_ingredientId: { userId, ingredientId: line.ingredientId } },
                select: { quantity: true },
              });
              const missingQuantity = Math.round(Math.max(0, amount - Number(available?.quantity.toString() ?? 0)) * 1000) / 1000;
              shortages.push({ name: line.nameSnapshot, unit: line.unit, missingQuantity });
              continue;
            }
            await tx.inventoryLedger.create({
              data: {
                mealPlanId: plan.id,
                ingredientId: line.ingredientId,
                delta: -amount,
                unit: line.unit,
              },
            });
          }
          if (shortages.length) {
            throw new MealActionError("No hay suficiente inventario para completar esta comida.", shortages);
          }

          const overlayUpdate = await tx.eventOverlay.updateMany({
            where: { id: plan.overlayId, purgeStartedAt: null },
            data,
          });
          if (!overlayUpdate.count) throw new MealActionError("La retención está procesando esta actividad. Inténtalo de nuevo en un momento.");
        });
      } else if (existingOverlay) {
        const update = await prisma.eventOverlay.updateMany({ where: { ...key, purgeStartedAt: null }, data });
        if (!update.count) {
          return NextResponse.json({ error: "La retención está procesando esta actividad. Inténtalo de nuevo en un momento." }, { status: 409 });
        }
      } else {
        await prisma.eventOverlay.create({ data: { ...key, ...data } });
      }
      completedAt = now;
    } else if (action === "uncomplete") {
      const mealPlan = await prisma.mealPlan.findUnique({
        where: { userId_googleCalendarId_googleEventId: key },
        select: { id: true },
      });
      if (mealPlan) {
        await prisma.$transaction(async (tx) => {
          const plan = await tx.mealPlan.findUniqueOrThrow({ where: { id: mealPlan.id }, select: { id: true, overlayId: true, completedAt: true } });
          if (plan.completedAt) {
            const claim = await tx.mealPlan.updateMany({
              where: { id: plan.id, userId, completedAt: { not: null } },
              data: { completedAt: null },
            });
            if (!claim.count) return;
          }

          // Reverse any outstanding deduction even if an older state update left the meal pending.
          const deductions = await tx.inventoryLedger.findMany({
            where: { mealPlanId: plan.id, delta: { lt: 0 }, reversals: { none: {} } },
          });
          if (!deductions.length) throw new MealActionError("No encontramos el descuento de inventario para deshacer esta comida.");

          for (const deduction of deductions) {
            const amount = Number(deduction.delta.toString()) * -1;
            await tx.pantryItem.upsert({
              where: { userId_ingredientId: { userId, ingredientId: deduction.ingredientId } },
              create: { userId, ingredientId: deduction.ingredientId, quantity: amount },
              update: { quantity: { increment: amount } },
            });
            await tx.inventoryLedger.create({
              data: {
                mealPlanId: plan.id,
                ingredientId: deduction.ingredientId,
                delta: amount,
                unit: deduction.unit,
                reversalOfId: deduction.id,
              },
            });
          }

          const overlayUpdate = await tx.eventOverlay.updateMany({
            where: { id: plan.overlayId, purgeStartedAt: null },
            data: { completedAt: null, purgeAfter: null, etag: event.etag ?? null },
          });
          if (!overlayUpdate.count) throw new MealActionError("La retención está procesando esta actividad. Inténtalo de nuevo en un momento.");
        });
      } else {
        const update = await prisma.eventOverlay.updateMany({ where: { ...key, purgeStartedAt: null }, data: { completedAt: null, purgeAfter: null, etag: event.etag ?? null } });
        if (!update.count && existingOverlay?.purgeStartedAt) {
          return NextResponse.json({ error: "La retención está procesando esta actividad. Inténtalo de nuevo en un momento." }, { status: 409 });
        }
      }
      completedAt = null;
    } else if (action === "keep") {
      if (existingOverlay) {
        const update = await prisma.eventOverlay.updateMany({ where: { ...key, purgeStartedAt: null }, data: { keep: true, etag: event.etag ?? null } });
        if (!update.count) {
          return NextResponse.json({ error: "La retención está procesando esta actividad. Inténtalo de nuevo en un momento." }, { status: 409 });
        }
      } else {
        await prisma.eventOverlay.create({ data: { ...key, keep: true, etag: event.etag ?? null } });
      }
    } else {
      const update = await prisma.eventOverlay.updateMany({ where: { ...key, purgeStartedAt: null }, data: { keep: false, etag: event.etag ?? null } });
      if (!update.count && existingOverlay?.purgeStartedAt) {
        return NextResponse.json({ error: "La retención está procesando esta actividad. Inténtalo de nuevo en un momento." }, { status: 409 });
      }
    }

    const overlay = await prisma.eventOverlay.findUnique({
      where: { userId_googleCalendarId_googleEventId: key },
      select: { completedAt: true, keep: true },
    });
    return NextResponse.json({ completedAt: (overlay?.completedAt ?? completedAt)?.toISOString() ?? null, keep: overlay?.keep ?? false }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof GoogleCalendarConnectionError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof MealActionError) {
      const shortageSummary = error.details?.map((item) => `${item.name}: faltan ${item.missingQuantity} ${item.unit}`).join("; ");
      const message = shortageSummary
        ? `${error.message} ${shortageSummary}. No se descontó ningún ingrediente.`
        : error.message;
      return NextResponse.json({ error: message, shortages: error.details ?? [] }, { status: 409 });
    }
    const status = googleStatus(error);
    if (status === 404) {
      return NextResponse.json({ error: "El evento o el calendario ya no están disponibles." }, { status: 404 });
    }
    if (status === 403) {
      return NextResponse.json({ error: "Google no permitió consultar este evento." }, { status: 403 });
    }
    return NextResponse.json({ error: "No pudimos actualizar el estado de la actividad." }, { status: 502 });
  }
}
