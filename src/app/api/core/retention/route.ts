import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { coreOrigin, coreRuntime } from "@/lib/core-runtime";
import { cleanupCoreUser } from "../../../../../reconstruction/core/src/retention";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "private, no-store" };
  if (request.headers.get("origin") !== coreOrigin()) return Response.json({ error: "FORBIDDEN_ORIGIN" }, { status: 403, headers });
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.id) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401, headers });
    return Response.json(await cleanupCoreUser(coreRuntime().db, session.user.id), { headers });
  } catch {
    console.error("MiAgenda retention batch failed; it will be retried on the next visit.");
    return Response.json({ error: "RETENTION_FAILED" }, { status: 503, headers });
  }
}
