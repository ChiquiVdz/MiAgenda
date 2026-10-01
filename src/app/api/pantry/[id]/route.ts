import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 999_999_999.999
    && Number(value.toFixed(3)) === value;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para actualizar la alacena." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  const quantity = isRecord(body) ? body.quantity : undefined;
  if (!validQuantity(quantity)) {
    return NextResponse.json({ error: "Indica una cantidad positiva con hasta 3 decimales." }, { status: 400 });
  }

  const { id } = await params;
  const item = await prisma.pantryItem.updateMany({ where: { id, userId }, data: { quantity } });
  if (!item.count) return NextResponse.json({ error: "No encontramos ese ingrediente en tu alacena." }, { status: 404 });
  const updated = await prisma.pantryItem.findFirst({ where: { id, userId }, select: { id: true, quantity: true, updatedAt: true } });
  return NextResponse.json({ item: updated }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para actualizar la alacena." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });

  const { id } = await params;
  const deleted = await prisma.pantryItem.deleteMany({ where: { id, userId } });
  if (!deleted.count) return NextResponse.json({ error: "No encontramos ese ingrediente en tu alacena." }, { status: 404 });
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
}
