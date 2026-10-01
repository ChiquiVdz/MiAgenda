import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_AMOUNT = 999_999_999.999;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validOrigin(request: Request) { return request.headers.get("origin") === new URL(request.url).origin; }

export async function PATCH(request: Request, { params }: { params: Promise<{ listId: string; itemId: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para modificar la lista." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.quantity !== "number" || !Number.isFinite(body.quantity)
    || body.quantity <= 0 || body.quantity > MAX_AMOUNT || Number(body.quantity.toFixed(3)) !== body.quantity) {
    return NextResponse.json({ error: "Indica una cantidad positiva con hasta 3 decimales." }, { status: 400 });
  }
  const { listId, itemId } = await params;
  const updated = await prisma.shoppingListItem.updateMany({
    where: { id: itemId, shoppingListId: listId, purchasedAt: null, shoppingList: { is: { userId } } },
    data: { quantity: body.quantity },
  });
  if (!updated.count) return NextResponse.json({ error: "No encontramos un artículo pendiente en esta lista." }, { status: 404 });
  const item = await prisma.shoppingListItem.findUniqueOrThrow({ where: { id: itemId } });
  return NextResponse.json({ item: { ...item, quantity: item.quantity.toString(), purchasedQuantity: item.purchasedQuantity?.toString() ?? null } }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ listId: string; itemId: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para modificar la lista." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  const { listId, itemId } = await params;
  const deleted = await prisma.shoppingListItem.deleteMany({ where: { id: itemId, shoppingListId: listId, purchasedAt: null, shoppingList: { is: { userId } } } });
  if (!deleted.count) return NextResponse.json({ error: "No encontramos un artículo pendiente en esta lista." }, { status: 404 });
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
}
