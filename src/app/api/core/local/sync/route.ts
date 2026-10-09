import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { coreOrigin, coreRuntime } from "@/lib/core-runtime";
import { readJson } from "../../../../../../reconstruction/core/src/http";
import { CoreError } from "../../../../../../reconstruction/core/src/errors";
import { LocalTaskConflict } from "../../../../../../reconstruction/core/src/service";

export const runtime = "nodejs";
export const maxDuration = 60;
const buckets = new Map<string, { count: number; until: number }>();
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(coreOrigin()).origin) return json({ message: "Origen no permitido." }, 403);
    const owner = (await getServerSession(authOptions))?.user?.id;
    if (!owner) return json({ message: "Inicia sesión con la misma cuenta; tus cambios siguen en este dispositivo." }, 401);
    if (request.headers.get("X-MiAgenda-Owner") !== owner) return json({ error: "ACCOUNT_CHANGED", message: "La cuenta cambió. Entra con la cuenta que tiene estos cambios pendientes." }, 409);
    const now = Date.now();
    for (const [id, value] of buckets) if (value.until < now) buckets.delete(id);
    const bucket = buckets.get(owner) ?? { count: 0, until: now + 60000 }; bucket.count++; buckets.set(owner, bucket);
    if (bucket.count > 20) return json({ message: "Espera un minuto antes de reintentar." }, 429);
    return json(await coreRuntime().service.executeLocalBatch(owner, await readJson(request)));
  } catch (cause) {
    if (cause instanceof LocalTaskConflict) return json({ error: "LOCAL_CONFLICT", rootId: cause.rootId, item: cause.item, missingCalendarId: cause.missingCalendarId, message: cause.message }, 409);
    if (cause instanceof CoreError) return json({ error: cause.code, message: cause.message }, cause.code === "UNAUTHENTICATED" ? 401 : cause.code === "INVALID_INPUT" ? 400 : 409);
    return json({ message: "No pudimos confirmar el envío. Reintenta Actualizar; no se duplicarán los cambios." }, 500);
  }
}
