import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para editar esta fila." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }
  const body: unknown = await request.json().catch(() => null);
  const input = parseSlot(body);
  if (!input) return NextResponse.json({ error: "Indica un nombre y una hora válida para la comida." }, { status: 400 });
  const { id } = await params;
  const result = await prisma.mealSlot.updateMany({ where: { id, userId }, data: input });
  if (!result.count) return NextResponse.json({ error: "No encontramos esa fila en tu planificador." }, { status: 404 });
  const mealSlot = await prisma.mealSlot.findUniqueOrThrow({ where: { id } });
  return NextResponse.json({ mealSlot }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para eliminar esta fila." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  const { id } = await params;
  const result = await prisma.mealSlot.deleteMany({ where: { id, userId } });
  if (!result.count) return NextResponse.json({ error: "No encontramos esa fila en tu planificador." }, { status: 404 });
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
