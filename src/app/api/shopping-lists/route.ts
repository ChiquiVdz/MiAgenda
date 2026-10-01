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

function serializeList<T extends {
  items: Array<{ quantity: { toString(): string }; purchasedQuantity: { toString(): string } | null }>;
}>(list: T) {
  return {
    ...list,
    items: list.items.map((item) => ({
      ...item,
      quantity: item.quantity.toString(),
      purchasedQuantity: item.purchasedQuantity?.toString() ?? null,
    })),
  };
}

async function findExistingList(userId: string, idempotencyKey: string) {
  return prisma.shoppingList.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
    include: { items: { orderBy: { nameSnapshot: "asc" } } },
  });
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para consultar tus listas de compras." }, { status: 401 });

  const lists = await prisma.shoppingList.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { nameSnapshot: "asc" } } },
  });
  return NextResponse.json({ lists: lists.map(serializeList) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para calcular una lista." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)
    || typeof body.recipeId !== "string" || !body.recipeId || body.recipeId.length > 30
    || typeof body.servings !== "number" || !Number.isInteger(body.servings) || body.servings < 1 || body.servings > 100
    || typeof body.idempotencyKey !== "string" || body.idempotencyKey.length < 16 || body.idempotencyKey.length > 100) {
    return NextResponse.json({ error: "Elige una receta y una cantidad de porciones válida." }, { status: 400 });
  }

  const { recipeId, servings, idempotencyKey } = body;
  const existing = await findExistingList(userId, idempotencyKey);
  if (existing) return NextResponse.json({ list: serializeList(existing), repeated: true }, { headers: { "Cache-Control": "private, no-store" } });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const recipe = await tx.recipe.findFirst({
        where: { id: recipeId, userId },
        include: {
          ingredients: {
            orderBy: { ingredient: { name: "asc" } },
            include: { ingredient: { select: { id: true, name: true, unit: true } } },
          },
        },
      });
      if (!recipe) throw new Error("RECIPE_NOT_FOUND");
      if (!recipe.ingredients.length) throw new Error("RECIPE_WITHOUT_INGREDIENTS");

      const inventoryRows = await tx.pantryItem.findMany({
        where: { userId, ingredientId: { in: recipe.ingredients.map((line) => line.ingredientId) } },
        select: { ingredientId: true, quantity: true },
      });
      const inventory = new Map(inventoryRows.map((row) => [row.ingredientId, Number(row.quantity.toString())]));
      const missing = recipe.ingredients.map((line) => {
        const needed = Math.round(Number(line.quantityPerServing.toString()) * servings * 1000) / 1000;
        const available = inventory.get(line.ingredientId) ?? 0;
        const quantity = Math.round(Math.max(0, needed - available) * 1000) / 1000;
        return { ingredientId: line.ingredient.id, name: line.ingredient.name, unit: line.ingredient.unit, quantity };
      }).filter((line) => line.quantity > 0);
      if (missing.some((line) => !Number.isFinite(line.quantity) || line.quantity > MAX_AMOUNT)) throw new Error("AMOUNT_OUT_OF_RANGE");
      if (!missing.length) return { list: null, missing: [] };

      const list = await tx.shoppingList.create({
        data: {
          userId,
          recipeId: recipe.id,
          recipeNameSnapshot: recipe.name,
          servings,
          idempotencyKey,
          items: {
            create: missing.map((line) => ({
              itemKey: `ingredient:${line.ingredientId}`,
              nameSnapshot: line.name,
              unit: line.unit,
              quantity: line.quantity,
              ingredient: { connect: { id: line.ingredientId } },
            })),
          },
        },
        include: { items: { orderBy: { nameSnapshot: "asc" } } },
      });
      return { list: serializeList(list), missing };
    });
    if (!result.list) {
      return NextResponse.json({ list: null, missing: [], message: "Ya tienes suficientes ingredientes para esa receta." }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ list: result.list, missing: result.missing }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "RECIPE_NOT_FOUND") return NextResponse.json({ error: "No encontramos esa receta en tu cuenta." }, { status: 404 });
    if (error instanceof Error && error.message === "RECIPE_WITHOUT_INGREDIENTS") return NextResponse.json({ error: "Agrega ingredientes a la receta antes de calcular lo que falta." }, { status: 400 });
    if (error instanceof Error && error.message === "AMOUNT_OUT_OF_RANGE") return NextResponse.json({ error: "La cantidad faltante supera el límite permitido." }, { status: 400 });
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const repeated = await findExistingList(userId, idempotencyKey);
      if (repeated) return NextResponse.json({ list: serializeList(repeated), repeated: true }, { headers: { "Cache-Control": "private, no-store" } });
    }
    console.error("[POST /api/shopping-lists] Calculation failed", { name: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "No pudimos guardar la lista de compras." }, { status: 500 });
  }
}
