import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const defaults = [
  { name: "Desayuno", defaultTime: "08:00", position: 0 },
  { name: "Comida", defaultTime: "13:00", position: 1 },
  { name: "Cena", defaultTime: "19:00", position: 2 },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function parseSlot(value: unknown) {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name.trim().replace(/\s+/g, " ") : "";
  const defaultTime = value.defaultTime;
  if (!name || name.length > 60 || typeof defaultTime !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(defaultTime)) return null;
  return { name, defaultTime };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para ver tu planificador." }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { mealSlotsInitialized: true } });
  if (user && !user.mealSlotsInitialized) {
    await prisma.$transaction(async (tx) => {
      const claim = await tx.user.updateMany({
        where: { id: userId, mealSlotsInitialized: false },
        data: { mealSlotsInitialized: true },
      });
      if (claim.count) await tx.mealSlot.createMany({ data: defaults.map((slot) => ({ userId, ...slot })) });
    });
  }

  const mealSlots = await prisma.mealSlot.findMany({ where: { userId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ mealSlots }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para agregar una fila." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  const input = parseSlot(body);
  if (!input) return NextResponse.json({ error: "Indica un nombre y una hora válida para la comida." }, { status: 400 });

  const mealSlot = await prisma.$transaction(async (tx) => {
    await tx.user.updateMany({ where: { id: userId, mealSlotsInitialized: false }, data: { mealSlotsInitialized: true } });
    const highest = await tx.mealSlot.aggregate({ where: { userId }, _max: { position: true } });
    return tx.mealSlot.create({ data: { userId, ...input, position: (highest._max.position ?? -1) + 1 } });
  });
  return NextResponse.json({ mealSlot }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
