import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { coreOrigin, coreRuntime } from "@/lib/core-runtime";
import { createCoreHandler } from "../../../../reconstruction/core/src/http";

export const runtime = "nodejs";
const buckets = new Map<string, { count: number; reset: number }>();
function allowed(owner: string) {
  const now = Date.now();
  for (const [id, bucket] of buckets) if (bucket.reset <= now) buckets.delete(id);
  const bucket = buckets.get(owner) ?? { count: 0, reset: now + 60000 };
  bucket.count += 1; buckets.set(owner, bucket);
  return bucket.count <= 120;
}
async function handler(request: Request) {
  try {
  const session = await getServerSession(authOptions);
  const owner = session?.user?.id;
  if (!owner) return Response.json({ error: "UNAUTHENTICATED", message: "Inicia sesión para continuar." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const expectedOwner = request.headers.get("X-MiAgenda-Owner");
  if (expectedOwner && expectedOwner !== owner) return Response.json({ message: "La cuenta cambió. Entra de nuevo antes de guardar." }, { status: 409, headers: { "Cache-Control": "no-store", "X-MiAgenda-Account-Changed": "1" } });
  if (!allowed(owner)) return Response.json({ error: "RATE_LIMITED", message: "Espera un momento antes de reintentar." }, { status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
  const { service, queries, pantry, recipes, planner, shopping } = coreRuntime();
  return createCoreHandler({ service, queries, pantry, recipes, planner, shopping, applicationOrigin: coreOrigin(), sessionOwner: async () => owner })(request);
  } catch {
    return Response.json({ error: "INTERNAL_ERROR", message: "No pudimos completar la solicitud. Reintenta el mismo cambio." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
export { handler as GET, handler as POST };
