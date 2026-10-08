import "server-only";
import { createCoreDatabase } from "../../reconstruction/core/src/database";
import { identityAuthOptions } from "../../reconstruction/core/src/authentication";
import { ActivityService } from "../../reconstruction/core/src/service";
import { ActivityQueries } from "../../reconstruction/core/src/queries";
import { PantryService } from "../../reconstruction/core/src/pantry";
import { RecipeService } from "../../reconstruction/core/src/recipes";
import { PlannerService } from "../../reconstruction/core/src/planner";
import { ShoppingService } from "../../reconstruction/core/src/shopping";

const shared = globalThis as typeof globalThis & { miagendaCore?: ReturnType<typeof createCoreDatabase> };
export function coreRuntime() {
  const db = shared.miagendaCore ??= createCoreDatabase();
  return { db, service: new ActivityService(db), queries: new ActivityQueries(db), pantry: new PantryService(db), recipes: new RecipeService(db), planner: new PlannerService(db), shopping: new ShoppingService(db) };
}
export function coreOrigin() {
  const url = process.env.NEXTAUTH_URL;
  if (!url) throw new Error("Falta NEXTAUTH_URL para configurar el origen de MiAgenda.");
  return new URL(url).origin;
}
export function coreAuthOptions() {
  const allowedEmails = new Set((process.env.MIAGENDA_ALLOWED_EMAILS ?? "")
    .split(",").map(email => email.trim().toLowerCase()).filter(Boolean));
  // The first hosted release is personal: fail closed if its access list is missing.
  if (process.env.VERCEL && allowedEmails.size === 0) {
    throw new Error("Configura MIAGENDA_ALLOWED_EMAILS antes de publicar la prueba personal.");
  }
  const options = identityAuthOptions(coreRuntime().db, {
    clientId: process.env.AUTH_GOOGLE_ID ?? "",
    clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    sessionSecret: process.env.NEXTAUTH_SECRET ?? "",
  });
  options.callbacks = {
    ...options.callbacks,
    async signIn({ account, profile }) {
      if (allowedEmails.size === 0) return true;
      const identity = profile as { email?: string; email_verified?: boolean } | undefined;
      return account?.provider === "google" && identity?.email_verified === true &&
        typeof identity.email === "string" && allowedEmails.has(identity.email.trim().toLowerCase());
    },
  };
  const secure = coreOrigin().startsWith("https:");
  options.cookies = { sessionToken: {
    name: `${secure ? "__Secure-" : ""}miagenda-core.session-token`,
    options: { httpOnly: true, sameSite: "lax", path: "/", secure },
  } };
  options.pages = { signIn: "/login", error: "/login" };
  options.logger = {
    error(code, metadata) {
      // Report identifiers only: never OAuth parameters, sessions or user data.
      const error = metadata as { error?: { code?: unknown; cause?: { code?: unknown } }; code?: unknown } | undefined;
      const diagnostic = error?.error?.code ?? error?.error?.cause?.code ?? error?.code;
      const safeCode = typeof diagnostic === "string" && /^[A-Z0-9_]{1,32}$/i.test(diagnostic) ? ` (${diagnostic})` : "";
      const detail = metadata as { error?: Error; name?: string; message?: string } | undefined;
      const cause = detail?.error ?? detail;
      const category = cause?.name === "TypeError" ? " TypeError" : "";
      const message = cause?.message ?? "";
      const hint = message.includes("Cannot read properties") ? " property-access" : message.includes("is not a function") ? " function-access" : message.includes("serialize") ? " serialization" : message.includes("correo") ? " missing-email" : "";
      function databaseCodes(value: unknown, depth = 0): string[] {
        if (!value || typeof value !== "object" || depth > 5) return [];
        return Object.entries(value).flatMap(([key, entry]) =>
          ["code", "originalCode", "kind"].includes(key) && typeof entry === "string" && /^[A-Z0-9_]{1,32}$/i.test(entry) ? [entry] :
          ["meta", "cause", "driverAdapterError", "error"].includes(key) ? databaseCodes(entry, depth + 1) : []);
      }
      console.error(`[MiAgenda acceso] ${code}${safeCode}${category}${hint} ${databaseCodes(metadata).join(" ")}`.trim());
    },
    warn(code) { console.warn(`[MiAgenda acceso] ${code}`); }, debug() {},
  };
  return options;
}
