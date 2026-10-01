import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { normalizeIngredientName } from "@/lib/ingredients";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const units = ["g", "kg", "ml", "l", "piece"] as const;

function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin && origin === new URL(request.url).origin);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para consultar ingredientes." }, { status: 401 });

  const ingredients = await prisma.ingredient.findMany({
    where: { OR: [{ catalogScope: "global" }, { ownerUserId: userId }] },
    orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
    take: 500,
    select: { id: true, name: true, unit: true, isBuiltin: true },
  });
  return NextResponse.json({ ingredients }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para agregar un ingrediente." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) return NextResponse.json({ error: "Revisa los datos del ingrediente." }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  const unit = body.unit;
  if (!name || name.length > 100 || typeof unit !== "string" || !units.includes(unit as (typeof units)[number])) {
    return NextResponse.json({ error: "Indica un nombre y una unidad válida." }, { status: 400 });
  }

  const normalizedName = normalizeIngredientName(name);
  const existing = await prisma.ingredient.findFirst({
    where: { normalizedName, OR: [{ catalogScope: "global" }, { ownerUserId: userId }] },
    select: { id: true, name: true, unit: true, isBuiltin: true },
  });
  if (existing) return NextResponse.json({ error: `“${existing.name}” ya está en el catálogo. Búscalo y selecciónalo.` }, { status: 409 });

  try {
    const ingredient = await prisma.ingredient.create({
      data: { ownerUserId: userId, catalogScope: userId, name, normalizedName, unit: unit as (typeof units)[number] },
      select: { id: true, name: true, unit: true, isBuiltin: true },
    });
    return NextResponse.json({ ingredient }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // The unique key also closes the race between simultaneous attempts.
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Ese nombre ya se agregó. Búscalo y selecciónalo." }, { status: 409 });
    }
    return NextResponse.json({ error: "No pudimos guardar el ingrediente." }, { status: 500 });
  }
}
