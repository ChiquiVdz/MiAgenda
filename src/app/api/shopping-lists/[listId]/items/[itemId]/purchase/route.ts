import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const MAX_AMOUNT = 999_999_999.999;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function validQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT
    && Number(value.toFixed(3)) === value;
}

class PurchaseError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "PurchaseError";
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string; itemId: string }> },
) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para registrar una compra." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  const quantity = isRecord(body) ? body.quantity : undefined;
  if (!validQuantity(quantity)) return NextResponse.json({ error: "Indica una cantidad comprada positiva con hasta 3 decimales." }, { status: 400 });
  const { listId, itemId } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.shoppingListItem.findFirst({
        where: { id: itemId, shoppingListId: listId, shoppingList: { is: { userId } } },
        select: { id: true, ingredientId: true, quantity: true, purchasedAt: true, purchasedQuantity: true },
      });
      if (!item) throw new PurchaseError(404, "No encontramos ese ingrediente en tu lista.");
      if (item.purchasedAt) return { item, alreadyPurchased: true };
      if (!item.ingredientId) throw new PurchaseError(400, "Este artículo libre se registra desde el botón de compra de toda la lista.");

      const now = new Date();
      const claim = await tx.shoppingListItem.updateMany({
        where: { id: itemId, shoppingListId: listId, purchasedAt: null },
        data: { purchasedAt: now, purchasedQuantity: quantity },
      });
      if (!claim.count) {
        const current = await tx.shoppingListItem.findUniqueOrThrow({ where: { id: itemId } });
        return { item: current, alreadyPurchased: true };
      }

      const pantry = await tx.pantryItem.findUnique({
        where: { userId_ingredientId: { userId, ingredientId: item.ingredientId } },
        select: { quantity: true },
      });
      if (pantry && Number(pantry.quantity.toString()) + quantity > MAX_AMOUNT) {
        throw new PurchaseError(400, "Esa compra superaría la cantidad máxima permitida en la alacena.");
      }
      const pantryItem = await tx.pantryItem.upsert({
        where: { userId_ingredientId: { userId, ingredientId: item.ingredientId } },
        create: { userId, ingredientId: item.ingredientId, quantity },
        update: { quantity: { increment: quantity } },
        select: { id: true, quantity: true },
      });
      const purchasedItem = await tx.shoppingListItem.findUniqueOrThrow({ where: { id: itemId } });
      return { item: purchasedItem, pantryItem, alreadyPurchased: false };
    });
    return NextResponse.json({
      item: {
        ...result.item,
        quantity: result.item.quantity.toString(),
        purchasedQuantity: result.item.purchasedQuantity?.toString() ?? null,
      },
      alreadyPurchased: result.alreadyPurchased,
      pantryQuantity: "pantryItem" in result ? result.pantryItem?.quantity.toString() : undefined,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof PurchaseError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[POST /api/shopping-lists/:listId/items/:itemId/purchase] Failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "No pudimos agregar esa compra a la alacena." }, { status: 500 });
  }
}
