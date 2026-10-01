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

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para consultar tu alacena." }, { status: 401 });

  const rows = await prisma.pantryItem.findMany({
    where: { userId },
    orderBy: { ingredient: { name: "asc" } },
    select: {
      id: true,
      quantity: true,
      ingredient: { select: { id: true, name: true, unit: true } },
    },
  });
  const items = rows.map(({ id, quantity, ingredient }) => ({ ...ingredient, pantryItem: { id, quantity: quantity.toString() } }));
  return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para agregar a tu alacena." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  const ingredientId = isRecord(body) && typeof body.ingredientId === "string" ? body.ingredientId : "";
  const quantity = isRecord(body) ? body.quantity : undefined;
  if (!ingredientId || !validQuantity(quantity)) {
    return NextResponse.json({ error: "Elige un ingrediente y una cantidad positiva con hasta 3 decimales." }, { status: 400 });
  }

  const ingredient = await prisma.ingredient.findFirst({
    where: { id: ingredientId, OR: [{ catalogScope: "global" }, { ownerUserId: userId }] },
    select: { id: true },
  });
  if (!ingredient) return NextResponse.json({ error: "No encontramos ese ingrediente en tu catálogo." }, { status: 404 });

  const pantryItem = await prisma.pantryItem.upsert({
    where: { userId_ingredientId: { userId, ingredientId } },
    create: { userId, ingredientId, quantity },
    update: { quantity: { increment: quantity } },
    select: { id: true, quantity: true, updatedAt: true },
  });
  return NextResponse.json({ pantryItem }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
