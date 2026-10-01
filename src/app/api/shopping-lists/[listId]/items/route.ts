import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const MAX_AMOUNT = 999_999_999.999;
const CUSTOM_UNITS = ["pieza", "paquete", "caja", "botella", "bolsa", "otro"] as const;
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function validOrigin(request: Request) { return request.headers.get("origin") === new URL(request.url).origin; }

export async function POST(request: Request, { params }: { params: Promise<{ listId: string }> }) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Inicia sesión para agregar artículos." }, { status: 401 });
  if (!validOrigin(request)) return NextResponse.json({ error: "La solicitud no es válida." }, { status: 403 });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "El formato de la solicitud no es válido." }, { status: 415 });
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 100
    || typeof body.quantity !== "number" || !Number.isFinite(body.quantity) || body.quantity <= 0 || body.quantity > MAX_AMOUNT || Number(body.quantity.toFixed(3)) !== body.quantity
    || typeof body.customUnit !== "string" || !CUSTOM_UNITS.includes(body.customUnit as typeof CUSTOM_UNITS[number])) {
    return NextResponse.json({ error: "Escribe el artículo, la cantidad y una unidad válidos." }, { status: 400 });
  }
  const { listId } = await params;
  const list = await prisma.shoppingList.findFirst({ where: { id: listId, userId }, select: { id: true } });
  if (!list) return NextResponse.json({ error: "No encontramos esta lista." }, { status: 404 });
  const item = await prisma.shoppingListItem.create({ data: {
    shoppingListId: listId,
    itemKey: `manual:${randomUUID()}`,
    nameSnapshot: body.name.trim().replace(/\s+/g, " "),
    quantity: body.quantity,
    customUnit: body.customUnit,
  } });
  return NextResponse.json({ item: { ...item, quantity: item.quantity.toString(), purchasedQuantity: null } }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
