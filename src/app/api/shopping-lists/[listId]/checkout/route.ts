import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const MAX_AMOUNT = 999_999_999.999;
function validOrigin(request: Request) { return request.headers.get("origin") === new URL(request.url).origin; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
class CheckoutError extends Error { constructor(readonly status: number, message: string) { super(message); } }

export async function POST(request: Request, { params }: { params: Promise<{ listId: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para registrar tus compras." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  const body: unknown = await request.json().catch(() => ({}));
  if (!isRecord(body) || !Array.isArray(body.quantities) || !body.quantities.every((entry) => isRecord(entry)
    && typeof entry.itemId === "string" && typeof entry.quantity === "number" && Number.isFinite(entry.quantity)
    && entry.quantity > 0 && entry.quantity <= MAX_AMOUNT && Number(entry.quantity.toFixed(3)) === entry.quantity)) {
    return NextResponse.json({ error: "Revisa las cantidades antes de registrar la compra." }, { status: 400 });
  }
  const quantities = new Map((body.quantities as Array<{ itemId: string; quantity: number }>).map((entry) => [entry.itemId, entry.quantity]));
  if (quantities.size !== body.quantities.length) return NextResponse.json({ error: "Hay cantidades repetidas en la solicitud." }, { status: 400 });
  const { listId } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const list = await tx.shoppingList.findFirst({ where: { id: listId, userId }, select: { id: true } });
      if (!list) throw new CheckoutError(404, "No encontramos esta lista.");
      const pending = await tx.shoppingListItem.findMany({ where: { shoppingListId: listId, purchasedAt: null } });
      if (!pending.length) return { purchasedCount: 0, pantryItems: 0, alreadyComplete: true };
      if (quantities.size !== pending.length || pending.some((item) => !quantities.has(item.id))) throw new CheckoutError(400, "La lista cambió. Recárgala antes de registrar la compra.");

      const now = new Date();
      for (const item of pending) {
        const amount = quantities.get(item.id)!;
        if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new CheckoutError(400, "Revisa las cantidades de la lista antes de marcarla como comprada.");
        const claim = await tx.shoppingListItem.updateMany({
          where: { id: item.id, shoppingListId: listId, purchasedAt: null },
          data: { quantity: amount, purchasedAt: now, purchasedQuantity: amount },
        });
        if (!claim.count) throw new CheckoutError(409, "La lista cambió mientras se registraban las compras. Recárgala e inténtalo de nuevo.");
      }

      const totals = new Map<string, number>();
      for (const item of pending) if (item.ingredientId) {
        totals.set(item.ingredientId, Math.round(((totals.get(item.ingredientId) ?? 0) + quantities.get(item.id)!) * 1000) / 1000);
      }
      const currentItems = totals.size ? await tx.pantryItem.findMany({ where: { userId, ingredientId: { in: [...totals.keys()] } }, select: { ingredientId: true, quantity: true } }) : [];
      const current = new Map(currentItems.map((item) => [item.ingredientId, Number(item.quantity.toString())]));
      if ([...totals].some(([id, amount]) => (current.get(id) ?? 0) + amount > MAX_AMOUNT)) throw new CheckoutError(400, "Alguna compra superaría la cantidad máxima permitida en la alacena.");
      for (const [ingredientId, quantity] of totals) await tx.pantryItem.upsert({
        where: { userId_ingredientId: { userId, ingredientId } },
        create: { userId, ingredientId, quantity },
        update: { quantity: { increment: quantity } },
      });
      return { purchasedCount: pending.length, pantryItems: totals.size, alreadyComplete: false };
    });
    return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CheckoutError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("[POST /api/shopping-lists/:listId/checkout] Failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "No pudimos registrar toda la compra." }, { status: 500 });
  }
}
