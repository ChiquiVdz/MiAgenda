import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { parseRecipeInput } from "@/lib/recipe-input";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para consultar tus recetas." }, { status: 401 });

  const recipes = await prisma.recipe.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: { ingredients: { orderBy: { ingredient: { name: "asc" } }, include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
  });
  return NextResponse.json({ recipes }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para guardar una receta." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  const input = parseRecipeInput(body);
  if (!input) return NextResponse.json({ error: "Revisa los datos, las porciones y los ingredientes de la receta." }, { status: 400 });

  try {
    const recipe = await prisma.$transaction(async (tx) => {
      const ingredientIds = input.ingredients.map((item) => item.ingredientId);
      const availableIngredients = await tx.ingredient.findMany({
        where: { id: { in: ingredientIds }, OR: [{ catalogScope: "global" }, { ownerUserId: userId }] },
        select: { id: true },
      });
      if (availableIngredients.length !== ingredientIds.length) throw new Error("INGREDIENTS_UNAVAILABLE");

      const created = await tx.recipe.create({
        data: { userId, name: input.name, instructions: input.instructions, servings: input.servings, durationMinutes: input.durationMinutes },
        select: { id: true },
      });
      await tx.recipeIngredient.createMany({
        data: input.ingredients.map((item) => ({ recipeId: created.id, ...item })),
      });
      return tx.recipe.findUniqueOrThrow({
        where: { id: created.id },
        include: { ingredients: { orderBy: { ingredient: { name: "asc" } }, include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
      });
    });
    return NextResponse.json({ recipe }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "INGREDIENTS_UNAVAILABLE") {
      return NextResponse.json({ error: "Algún ingrediente no está en tu catálogo. Actualiza la lista y vuelve a elegirlo." }, { status: 400 });
    }
    return NextResponse.json({ error: "No pudimos guardar la receta." }, { status: 500 });
  }
}
