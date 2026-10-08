import { randomUUID } from "node:crypto";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import GoogleProviderImport from "next-auth/providers/google";
import type { Adapter, AdapterUser, AdapterAccount } from "next-auth/adapters";
import type { NextAuthOptions } from "next-auth";
import { Prisma, type PrismaClient } from "../generated/client.ts";

const GoogleProvider = typeof GoogleProviderImport === "function" ? GoogleProviderImport :
  (GoogleProviderImport as unknown as { default: typeof GoogleProviderImport }).default;
const userSelect = { id: true, email: true, emailVerified: true, name: true, image: true } as const;
function userView(user: { id: string; email: string | null; emailVerified: Date | null; name: string | null; image: string | null } | null): AdapterUser | null {
  if (!user) return null;
  if (!user.email) throw new Error("La identidad no tiene correo de acceso.");
  return { ...user, email: user.email };
}

export function identityAdapter(db: PrismaClient): Adapter {
  const base = PrismaAdapter(db as unknown as Parameters<typeof PrismaAdapter>[0]);
  return {
    ...base,
    async getUser(id) { return userView(await db.user.findUnique({ where: { id }, select: userSelect })); },
    async getUserByEmail(email) { return userView(await db.user.findUnique({ where: { email }, select: userSelect })); },
    async getUserByAccount(key) {
      const account = await db.account.findUnique({ where: { provider_providerAccountId: key }, select: { user: { select: userSelect } } });
      return userView(account?.user ?? null);
    },
    async updateUser(data) {
      const user = await db.user.update({ where: { id: data.id }, data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.email !== undefined ? { email: data.email } : {}),
        ...(data.emailVerified !== undefined ? { emailVerified: data.emailVerified } : {}),
        ...(data.image !== undefined ? { image: data.image } : {}),
      }, select: userSelect });
      return userView(user)!;
    },
    async getSessionAndUser(sessionToken) {
      // One owner/session join per request; no session cache or extra tokens.
      const [session] = await db.$queryRaw<Array<{ sessionToken: string; userId: string; expires: Date;
        id: string; email: string | null; emailVerified: Date | null; name: string | null; image: string | null }>>(Prisma.sql`
        SELECT s."sessionToken", s."userId", s.expires,
          u.id, u.email, u."emailVerified", u.name, u.image
        FROM public.sessions s JOIN public.users u ON u.id = s."userId"
        WHERE s."sessionToken" = ${sessionToken} LIMIT 1
      `);
      if (!session) return null;
      return { session: { sessionToken: session.sessionToken, userId: session.userId, expires: session.expires },
        user: userView({ id: session.id, email: session.email, emailVerified: session.emailVerified, name: session.name, image: session.image })! };
    },
    async createUser(data: Omit<AdapterUser, "id">) {
      if (!data.email) throw new Error("Google no proporcionó un correo para el acceso.");
      return db.$transaction(async tx => {
        const user = await tx.user.create({ data: {
          name: data.name, email: data.email, emailVerified: data.emailVerified, image: data.image,
        } });
        await tx.calendar.create({ data: {
          id: randomUUID(), userId: user.id, name: "General", color: "#16a34a",
          preference: { create: { visible: true, position: 0 } },
        } });
        return { id: user.id, email: data.email, emailVerified: user.emailVerified,
          name: user.name, image: user.image };
      });
    },
    async linkAccount(account: AdapterAccount) {
      if (account.provider !== "google" || account.type !== "oauth") throw new Error("Solo se admite identidad Google.");
      // OAuth tokens are needed only while the library validates login. Persist
      // the provider subject, NEVER access/id/refresh tokens or calendar scopes.
      await db.account.create({ data: {
        userId: account.userId, provider: "google", type: "oauth",
        providerAccountId: account.providerAccountId,
        scope: "openid email profile",
      } });
    },
  };
}

/** Prepared for the new app's auth route; the legacy route is untouched. */
export function identityAuthOptions(db: PrismaClient, credentials: {
  clientId: string; clientSecret: string; sessionSecret: string;
}): NextAuthOptions {
  if (!credentials.clientId || !credentials.clientSecret || !credentials.sessionSecret) {
    throw new Error("Falta configurar las credenciales de acceso del núcleo.");
  }
  return {
    adapter: identityAdapter(db), secret: credentials.sessionSecret,
    session: { strategy: "database" },
    providers: [GoogleProvider({ clientId: credentials.clientId, clientSecret: credentials.clientSecret,
      authorization: { params: { scope: "openid email profile" } } })],
    callbacks: { async session({ session, user }) {
      if (session.user) Object.assign(session.user, { id: user.id });
      return session;
    } },
  };
}
