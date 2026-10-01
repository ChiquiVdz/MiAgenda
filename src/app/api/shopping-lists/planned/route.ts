import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const MAX_AMOUNT = 999_999_999.999;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serialize<T extends { items: Array<{ quantity: { toString(): string }; purchasedQuantity: { toString(): string } | null }> }>(list: T) {
  return { ...list, items: list.items.map((item) => ({ ...item, quantity: item.quantity.toString(), purchasedQuantity: item.purchasedQuantity?.toString() ?? null })) };
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para actualizar la lista." }, { status: 401 });
  if (request.headers.get("origin") !== new URL(request.url).origin) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.from !== "string" || typeof body.to !== "string"
    || !RFC3339.test(body.from) || !RFC3339.test(body.to)
    || !Number.isFinite(new Date(body.from).getTime()) || !Number.isFinite(new Date(body.to).getTime())
    || new Date(body.to).getTime() <= new Date(body.from).getTime()
    || new Date(body.to).getTime() - new Date(body.from).getTime() > 14 * 24 * 60 * 60 * 1000
    || !Array.isArray(body.mealPlanIds) || body.mealPlanIds.length > 100
    || !body.mealPlanIds.every((id) => typeof id === "string" && id.length > 0 && id.length <= 30)) {
    return NextResponse.json({ error: "No pudimos verificar las comidas de este rango." }, { status: 400 });
  }

  const from = new Date(body.from);
  const to = new Date(body.to);
  const ids = [...new Set(body.mealPlanIds as string[])];
  if (ids.length !== body.mealPlanIds.length) return NextResponse.json({ error: "La lista de comidas contiene elementos repetidos." }, { status: 400 });
  const key = `planned:${from.toISOString()}:${to.toISOString()}`;

  try {
    const list = await prisma.$transaction(async (tx) => {
      const plans = ids.length ? await tx.mealPlan.findMany({
        where: { id: { in: ids }, userId, completedAt: null },
        include: { ingredients: true },
      }) : [];
      if (plans.length !== ids.length) throw new Error("PLANS_CHANGED");

      const totals = new Map<string, { ingredientId: string; name: string; unit: (typeof plans)[number]["ingredients"][number]["unit"]; quantity: number }>();
      for (const plan of plans) for (const line of plan.ingredients) {
        const current = totals.get(line.ingredientId);
        const quantity = Number(line.requiredQuantity.toString());
        totals.set(line.ingredientId, {
          ingredientId: line.ingredientId,
          name: line.nameSnapshot,
          unit: line.unit,
          quantity: Math.round(((current?.quantity ?? 0) + quantity) * 1000) / 1000,
        });
      }
      if ([...totals.values()].some((line) => !Number.isFinite(line.quantity) || line.quantity > MAX_AMOUNT)) throw new Error("AMOUNT_OUT_OF_RANGE");

      const pantryRows = totals.size ? await tx.pantryItem.findMany({ where: { userId, ingredientId: { in: [...totals.keys()] } }, select: { ingredientId: true, quantity: true } }) : [];
      const pantry = new Map(pantryRows.map((row) => [row.ingredientId, Number(row.quantity.toString())]));
      const neededToBuy = [...totals.values()].map((line) => ({ ...line, quantity: Math.round(Math.max(0, line.quantity - (pantry.get(line.ingredientId) ?? 0)) * 1000) / 1000 })).filter((line) => line.quantity > 0);

      const shoppingList = await tx.shoppingList.upsert({
        where: { userId_idempotencyKey: { userId, idempotencyKey: key } },
        create: { userId, recipeNameSnapshot: "Comidas planeadas", servings: 1, rangeStart: from, rangeEnd: to, idempotencyKey: key },
        update: {},
        include: { items: true },
      });

      const wantedIds = new Set(neededToBuy.map((line) => line.ingredientId));
      const pendingRows = await tx.shoppingListItem.findMany({ where: { shoppingListId: shoppingList.id, ingredientId: { not: null }, purchasedAt: null } });
      for (const line of neededToBuy) {
        const itemKey = `ingredient:${line.ingredientId}`;
        const existing = pendingRows.find((item) => item.itemKey === itemKey)
          ?? shoppingList.items.find((item) => item.itemKey === itemKey);
        if (existing?.purchasedAt) continue;
        if (existing) {
          await tx.shoppingListItem.update({ where: { id: existing.id }, data: { quantity: line.quantity, nameSnapshot: line.name, unit: line.unit } });
        } else {
          await tx.shoppingListItem.upsert({
            where: { shoppingListId_itemKey: { shoppingListId: shoppingList.id, itemKey } },
            create: { shoppingListId: shoppingList.id, itemKey, ingredientId: line.ingredientId, nameSnapshot: line.name, unit: line.unit, quantity: line.quantity },
            update: { quantity: line.quantity, nameSnapshot: line.name, unit: line.unit },
          });
        }
      }
      for (const item of pendingRows) {
        if (item.ingredientId && !wantedIds.has(item.ingredientId)) await tx.shoppingListItem.delete({ where: { id: item.id } });
      }
      return tx.shoppingList.findUniqueOrThrow({ where: { id: shoppingList.id }, include: { items: { orderBy: { nameSnapshot: "asc" } } } });
    });
    return NextResponse.json({ list: serialize(list) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "PLANS_CHANGED") return NextResponse.json({ error: "Algunas comidas ya cambiaron. Actualiza Planificar e inténtalo de nuevo." }, { status: 409 });
    if (error instanceof Error && error.message === "AMOUNT_OUT_OF_RANGE") return NextResponse.json({ error: "La cantidad total supera el límite permitido." }, { status: 400 });
    console.error("[POST /api/shopping-lists/planned] Failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "No pudimos consolidar las comidas planeadas." }, { status: 500 });
  }
}
