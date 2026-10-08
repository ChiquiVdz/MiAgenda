import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { coreRuntime } from "@/lib/core-runtime";
import { atTime, dateParts, monday, plusDays } from "@/app/core/dates";
import type { LocalCopy } from "@/app/core/local-contract";
import type { ActivityView } from "../../../../../reconstruction/core/src/views";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };
const buckets = new Map<string, { count: number; until: number }>();
function allow(owner: string, check: boolean) {
  const now = Date.now(), key = `${owner}:${check ? "check" : "copy"}`;
  for (const [id, value] of buckets) if (value.until <= now) buckets.delete(id);
  const value = buckets.get(key) ?? { count: 0, until: now + 60000 };
  value.count++; buckets.set(key, value);
  return value.count <= (check ? 30 : 60);
}

export async function GET(request: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return Response.json({ message: "Inicia sesión para continuar." }, { status: 401, headers });
    const ownerId = session.user.id, check = new URL(request.url).searchParams.get("check") === "1";
    if (!allow(ownerId, check)) return Response.json({ message: "Espera un momento antes de volver a actualizar." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    const { db, queries, pantry, recipes, planner, shopping } = coreRuntime();
    const owner = await db.user.findUniqueOrThrow({ where: { id: ownerId }, select: { dataRevision: true, timeZone: true } });
    const dataRevision = owner.dataRevision.toString();
    // Entry check reads only identity and revision, not all the user's data.
    if (check) return Response.json({ ownerId, dataRevision }, { headers });
    const today = dateParts(new Date(), owner.timeZone).date;
    const start = plusDays(monday(today), -7), end = plusDays(start, 42);
    const calendars = await queries.calendars(ownerId);
    async function activities(kind: "inbox" | "agenda" | "highlighted") {
      const items: ActivityView[] = [];
      let afterId: string | undefined;
      for (let page = 0; page < 50; page++) {
        const yearStart = `${today.slice(0, 4)}-01-01`, yearEnd = `${Number(today.slice(0, 4)) + 1}-01-01`;
        const from = kind === "highlighted" ? yearStart : start, until = kind === "highlighted" ? yearEnd : end;
        const result = kind === "inbox" ? await queries.inbox(ownerId, { limit: 100, afterId }) : await queries.agenda(ownerId, {
          startDate: from, endDate: until, startsAt: atTime(from, "00:00", owner.timeZone), endsAt: atTime(until, "00:00", owner.timeZone),
          calendarIds: calendars.items.map(item => item.id), highlightedOnly: kind === "highlighted", limit: 100, afterId,
        });
        if (result.dataRevision !== dataRevision) throw new Error("CHANGED");
        items.push(...result.items);
        if (!result.nextAfterId) return { items, dataRevision, nextAfterId: null };
        afterId = result.nextAfterId;
      }
      throw new Error("TOO_LARGE");
    }
    // Bounded pagination; never silently present a partial download as complete.
    async function allPantry() {
      const result = await pantry.snapshot(ownerId);
      for (let page = 0; result.nextCatalogId && page < 30; page++) {
        const next = await pantry.snapshot(ownerId, { catalogAfterId: result.nextCatalogId });
        if (next.dataRevision !== dataRevision) throw new Error("CHANGED");
        result.ingredients.push(...next.ingredients); result.nextCatalogId = next.nextCatalogId;
      }
      for (let page = 0; result.nextPantryId && page < 30; page++) {
        const next = await pantry.snapshot(ownerId, { pantryAfterId: result.nextPantryId });
        if (next.dataRevision !== dataRevision) throw new Error("CHANGED");
        result.items.push(...next.items); result.nextPantryId = next.nextPantryId;
      }
      if (result.nextCatalogId || result.nextPantryId) throw new Error("TOO_LARGE");
      return result;
    }
    async function allRecipes() {
      const result = await recipes.snapshot(ownerId);
      for (let page = 0; result.nextId && page < 100; page++) {
        const next = await recipes.snapshot(ownerId, result.nextId);
        if (next.dataRevision !== dataRevision) throw new Error("CHANGED");
        result.items.push(...next.items); result.nextId = next.nextId;
      }
      if (result.nextId) throw new Error("TOO_LARGE");
      return result;
    }
    async function allShopping() {
      const result = await shopping.snapshot(ownerId);
      for (let page = 0; result.nextPurchaseId && page < 100; page++) {
        const next = await shopping.snapshot(ownerId, result.nextPurchaseId);
        if (next.dataRevision !== dataRevision) throw new Error("CHANGED");
        result.purchased.push(...next.purchased); result.nextPurchaseId = next.nextPurchaseId;
      }
      if (result.nextPurchaseId) throw new Error("TOO_LARGE");
      return result;
    }
    async function part<T>(name: string, value: Promise<T>) {
      try { return await value; }
      catch (cause) { console.error("MiAgenda local copy section", name); throw cause; }
    }
    // The configured pool has two connections. Do not queue six interactive
    // transactions behind it: Prisma's acquisition timeout is shorter than the
    // full download, even though each individual projection is bounded.
    const [inbox, agenda] = await Promise.all([part("inbox", activities("inbox")), part("agenda", activities("agenda"))]);
    const [highlighted, stock] = await Promise.all([part("highlighted", activities("highlighted")), part("pantry", allPantry())]);
    const [definitions, purchases] = await Promise.all([part("recipes", allRecipes()), part("shopping", allShopping())]);
    // Reuse the global availability projection once for the whole local window.
    const planners = [await part("planner", planner.snapshot(ownerId, start, 42, true))];
    const final = await db.user.findUniqueOrThrow({ where: { id: ownerId }, select: { dataRevision: true } });
    if (final.dataRevision.toString() !== dataRevision || [stock, definitions, purchases, calendars, ...planners].some(item => item.dataRevision !== dataRevision)) throw new Error("CHANGED");
    const copy: LocalCopy = { format: 1, ownerId, dataRevision, savedAt: new Date().toISOString(), today, start, end,
      inbox, agenda, highlighted, calendars: calendars.items, pantry: stock, recipes: definitions, shopping: purchases, planners };
    const encoded = JSON.stringify(copy);
    if (new TextEncoder().encode(encoded).byteLength > 15 * 1024 * 1024) throw new Error("TOO_LARGE");
    return new Response(encoded, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (cause) {
    const error = cause as { name?: string; code?: string };
    console.error("MiAgenda local copy failed", error.name ?? "unknown", /^[A-Z0-9_]+$/.test(error.code ?? "") ? error.code : "");
    const changed = cause instanceof Error && cause.message === "CHANGED";
    return Response.json({ message: changed ? "Los datos cambiaron durante la descarga. Reintenta actualizar." : "No pudimos preparar la copia local. Reintenta; tu copia anterior se conserva." }, { status: changed ? 409 : 503, headers });
  }
}
