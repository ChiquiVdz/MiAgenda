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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para actualizar una receta." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const input = parseRecipeInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Revisa los datos, las porciones y los ingredientes de la receta." }, { status: 400 });
  const { id } = await params;

  try {
    const recipe = await prisma.$transaction(async (tx) => {
      const current = await tx.recipe.findFirst({ where: { id, userId }, select: { id: true } });
      if (!current) throw new Error("RECIPE_NOT_FOUND");

      const ingredientIds = input.ingredients.map((item) => item.ingredientId);
      const availableIngredients = await tx.ingredient.findMany({
        where: { id: { in: ingredientIds }, OR: [{ catalogScope: "global" }, { ownerUserId: userId }] },
        select: { id: true },
      });
      if (availableIngredients.length !== ingredientIds.length) throw new Error("INGREDIENTS_UNAVAILABLE");

      await tx.recipe.update({
        where: { id },
        data: { name: input.name, instructions: input.instructions, servings: input.servings, durationMinutes: input.durationMinutes },
      });
      await tx.recipeIngredient.deleteMany({ where: { recipeId: id } });
      await tx.recipeIngredient.createMany({ data: input.ingredients.map((item) => ({ recipeId: id, ...item })) });
      return tx.recipe.findUniqueOrThrow({
        where: { id },
        include: { ingredients: { orderBy: { ingredient: { name: "asc" } }, include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
      });
    });
    return NextResponse.json({ recipe }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message === "RECIPE_NOT_FOUND") {
      return NextResponse.json({ error: "No encontramos esa receta." }, { status: 404 });
    }
    if (error instanceof Error && error.message === "INGREDIENTS_UNAVAILABLE") {
      return NextResponse.json({ error: "Algún ingrediente no está en tu catálogo. Actualiza la lista y vuelve a elegirlo." }, { status: 400 });
    }
    return NextResponse.json({ error: "No pudimos actualizar la receta." }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para eliminar una receta." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });

  const { id } = await params;
  const deleted = await prisma.recipe.deleteMany({ where: { id, userId } });
  if (!deleted.count) return NextResponse.json({ error: "No encontramos esa receta." }, { status: 404 });
  return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "private, no-store" } });
}
