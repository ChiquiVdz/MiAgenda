import { ActivityService } from "./service.ts";
import { ActivityQueries } from "./queries.ts";
import { CoreError, invalid } from "./errors.ts";
import type { PantryService } from "./pantry.ts";
import { pantryActions } from "./pantry-contracts.ts";
import type { RecipeService } from "./recipes.ts";
import { recipeActions } from "./recipe-input.ts";
import type { PlannerService } from "./planner.ts";
import { plannerActions } from "./planner-input.ts";
import type { ShoppingService } from "./shopping.ts";
import { shoppingActions } from "./shopping-input.ts";

const statuses = { INVALID_INPUT: 400, NOT_FOUND: 404, CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409, UNAUTHENTICATED: 401, DEPENDENCY: 409 } as const;

function response(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", ...extraHeaders } });
}
export async function readJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) invalid("Usa application/json.");
  if (!request.body) invalid("Falta el contenido del comando.");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 65536) { await reader.cancel(); invalid("El comando supera 64 KB."); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return invalid("JSON inválido."); }
}

/** Framework-neutral adapter; mount ONLY with the new core's verified session.
 * Old Google Calendar sessions must not authorize users in the isolated DB.
 * Rate limiting belongs at the authenticated route/reverse proxy when mounted.
 */
export function createCoreHandler(options: {
  service: ActivityService; queries: ActivityQueries; applicationOrigin: string;
  pantry?: PantryService;
  recipes?: RecipeService;
  planner?: PlannerService;
  shopping?: ShoppingService;
  sessionOwner: (request: Request) => Promise<string | null>;
}): (request: Request) => Promise<Response> {
  const applicationOrigin = new URL(options.applicationOrigin).origin;
  return async request => {
    try {
      if (!["GET", "POST"].includes(request.method)) return response({ error: "METHOD_NOT_ALLOWED" }, 405, { Allow: "GET, POST" });
      if (request.method === "POST" && request.headers.get("origin") !== applicationOrigin) {
        return response({ error: "FORBIDDEN_ORIGIN", message: "El origen de la solicitud no está permitido." }, 403);
      }
      const owner = await options.sessionOwner(request);
      if (!owner) throw new CoreError("UNAUTHENTICATED", "Inicia sesión para continuar.");
      if (request.method === "POST") {
        const command = await readJson(request);
        if (command && typeof command === "object" && "action" in command && shoppingActions.includes(String(command.action))) {
          if (!options.shopping) invalid("Compras no está habilitado.");
          return response(await options.shopping.execute(owner, command));
        }
        if (command && typeof command === "object" && "action" in command && plannerActions.includes(String(command.action))) {
          if (!options.planner) invalid("Planificador no está habilitado.");
          return response(await options.planner.execute(owner, command));
        }
        if (command && typeof command === "object" && "action" in command && recipeActions.includes(String(command.action))) {
          if (!options.recipes) invalid("Recetario no está habilitado.");
          return response(await options.recipes.execute(owner, command));
        }
        if (command && typeof command === "object" && "action" in command && pantryActions.includes(String(command.action))) {
          if (!options.pantry) invalid("Alacena no está habilitada.");
          return response(await options.pantry.execute(owner, command));
        }
        return response(await options.service.execute(owner, command));
      }
      const params = new URL(request.url).searchParams;
      for (const key of params.keys()) if (params.getAll(key).length !== 1) invalid("No repitas parámetros de consulta.");
      const limit = params.has("limit") ? Number(params.get("limit")) : undefined;
      const afterId = params.get("afterId") ?? undefined;
      switch (params.get("view")) {
        case "shopping":
          if (!options.shopping) invalid("Compras no está habilitado.");
          return response(await options.shopping.snapshot(owner, afterId));
        case "planner":
          if (!options.planner) invalid("Planificador no está habilitado.");
          return response(await options.planner.snapshot(owner, params.get("start") ?? "", Number(params.get("days") ?? 7)));
        case "mealCell":
          if (!options.planner) invalid("Planificador no está habilitado.");
          return response(await options.planner.cell(owner, params.get("date") ?? "", params.get("slotId") ?? ""));
        case "mealWeekPreview":
          if (!options.planner) invalid("Planificador no está habilitado.");
          return response(await options.planner.weekPreview(owner, params.get("start") ?? "", params.get("mode") ?? ""));
        case "slotImpact":
          if (!options.planner) invalid("Planificador no está habilitado.");
          return response(await options.planner.slotImpact(owner, params.get("id") ?? "", params.get("destinationId") ?? undefined));
        case "recipes":
          if (!options.recipes) invalid("Recetario no está habilitado.");
          return response(await options.recipes.snapshot(owner, afterId));
        case "pantry":
          if (!options.pantry) invalid("Alacena no está habilitada.");
          return response(await options.pantry.snapshot(owner, { catalogAfterId: params.get("catalogAfterId") ?? undefined, pantryAfterId: params.get("pantryAfterId") ?? undefined }));
        case "ingredientImpact":
          if (!options.pantry) invalid("Alacena no está habilitada.");
          return response(await options.pantry.impact(owner, params.get("id") ?? ""));
        case "removedIngredients":
          if (!options.pantry) invalid("Alacena no está habilitada.");
          return response(await options.pantry.removed(owner, afterId));
        case "stockHistory":
          if (!options.pantry) invalid("Alacena no está habilitada.");
          return response(await options.pantry.history(owner, params.get("id") ?? ""));
        case "recurrence": return response(await options.queries.recurrence(owner, params.get("seriesId") ?? "", Number(params.get("ordinal"))));
        case "recurrencePreview": {
          let command: unknown;
          const value = params.get("command") ?? "";
          if (value.length > 8192) invalid("La consulta es demasiado grande.");
          try { command = JSON.parse(value); } catch { invalid("Consulta de repetición inválida."); }
          return response(await options.queries.recurrencePreview(owner, command));
        }
        case "inbox": return response(await options.queries.inbox(owner, { limit, afterId }));
        case "detail": return response(await options.queries.detail(owner, params.get("id") ?? ""));
        case "calendars": return response(await options.queries.calendars(owner));
        case "calendarImpact": return response(await options.queries.calendarImpact(owner, params.get("id") ?? ""));
        case "agenda": {
          const highlighted = params.get("highlightedOnly");
          if (highlighted !== null && !["true", "false"].includes(highlighted)) invalid("Filtro de destacados inválido.");
          return response(await options.queries.agenda(owner, {
            startsAt: params.get("startsAt") ?? "", endsAt: params.get("endsAt") ?? "",
            startDate: params.get("startDate") ?? "", endDate: params.get("endDate") ?? "",
            calendarIds: params.has("calendarIds") ? params.get("calendarIds")!.split(",").filter(Boolean) : undefined,
            highlightedOnly: highlighted === "true", limit, afterId,
          }));
        }
        default: return invalid("Vista desconocida.");
      }
    } catch (error) {
      if (error instanceof CoreError) return response({ error: error.code, message: error.message }, statuses[error.code]);
      // Log only error codes and names; driver messages may include private data.
      const codes: string[] = [];
      const visit = (value: unknown, depth = 0) => {
        if (!value || typeof value !== "object" || depth > 5) return;
        for (const [key, entry] of Object.entries(value)) {
          if (["code", "originalCode", "kind", "name", "constraint"].includes(key) && typeof entry === "string" && /^[A-Za-z0-9_]{1,100}$/.test(entry)) codes.push(`${key}:${entry}`);
          else if (["meta", "cause", "driverAdapterError"].includes(key)) visit(entry, depth + 1);
        }
      };
      visit(error);
      console.error("MiAgenda core operation failed", codes.join(" ") || "unknown");
      // Driver errors can contain host/query details. Never serialize them.
      return response({ error: "INTERNAL_ERROR", message: "No se pudo completar la operación. Reintenta con el mismo comando." }, 500);
    }
  };
}
