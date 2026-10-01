import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const MAX_MISSING_INGREDIENTS = 3;

function roundToUnitPrecision(value: number) {
  return Math.round(value * 1000) / 1000;
}

export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para ver sugerencias." }, { status: 401 });
  const includeAll = new URL(request.url).searchParams.get("includeAll") === "true";

  const [recipes, pantryItems] = await Promise.all([
    prisma.recipe.findMany({
      where: { userId },
      include: { ingredients: { include: { ingredient: { select: { id: true, name: true, unit: true } } } } },
    }),
    prisma.pantryItem.findMany({ where: { userId }, select: { ingredientId: true, quantity: true } }),
  ]);
  const inventory = new Map(pantryItems.map((item) => [item.ingredientId, Number(item.quantity.toString())]));

  const suggestions = recipes.map((recipe) => {
    const ingredients = recipe.ingredients.map((line) => {
      const requiredQuantity = roundToUnitPrecision(Number(line.quantityPerServing.toString()) * recipe.servings);
      const availableQuantity = inventory.get(line.ingredientId) ?? 0;
      const missingQuantity = roundToUnitPrecision(Math.max(0, requiredQuantity - availableQuantity));
      return {
        ingredientId: line.ingredientId,
        name: line.ingredient.name,
        unit: line.ingredient.unit,
        requiredQuantity,
        availableQuantity,
        missingQuantity,
        equivalent: line.equivalent,
      };
    });
    const missingCount = ingredients.filter((ingredient) => ingredient.missingQuantity > 0).length;
    return {
      id: recipe.id,
      name: recipe.name,
      servings: recipe.servings,
      durationMinutes: recipe.durationMinutes,
      missingCount,
      ingredients,
    };
  }).filter((recipe) => includeAll || recipe.missingCount <= MAX_MISSING_INGREDIENTS)
    .sort((a, b) => a.missingCount - b.missingCount || a.name.localeCompare(b.name, "es"));

  return NextResponse.json({ suggestions, maxMissingIngredients: MAX_MISSING_INGREDIENTS }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
