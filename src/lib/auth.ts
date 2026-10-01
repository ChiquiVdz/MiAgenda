import "server-only";

import { PrismaAdapter } from "@next-auth/prisma-adapter";
import type { Adapter } from "next-auth/adapters";
import GoogleProvider from "next-auth/providers/google";
import type { NextAuthOptions } from "next-auth";
import { prisma } from "@/lib/prisma";
import { encryptGoogleRefreshToken } from "@/lib/google/token-encryption";

const prismaAdapter = PrismaAdapter(prisma) as unknown as Adapter;
type AccountToLink = Parameters<NonNullable<Adapter["linkAccount"]>>[0];

const adapter: Adapter = {
  ...prismaAdapter,
  async linkAccount(account: AccountToLink) {
    const safeAccount = {
      userId: account.userId,
      type: account.type,
      provider: account.provider,
      providerAccountId: account.providerAccountId,
      refresh_token: null,
      access_token: null,
      expires_at: account.expires_at,
      token_type: account.token_type,
      scope: account.scope,
      id_token: null,
      session_state: typeof account.session_state === "string" ? account.session_state : null,
    };

    await prisma.$transaction(async (transaction) => {
      if (account.refresh_token) {
        await transaction.user.update({
          where: { id: account.userId },
          data: {
            googleSub: account.providerAccountId,
            encryptedRefreshToken: encryptGoogleRefreshToken(account.refresh_token),
          },
        });
      }

      await transaction.account.create({ data: safeAccount });
    });
  },
};

export const authOptions: NextAuthOptions = {
  adapter,
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/calendar",
          access_type: "offline",
          response_type: "code",
        },
      },
    }),
  ],
  session: { strategy: "database" },
  pages: { signIn: "/login" },
  callbacks: {
    async session({ session, user }) {
      if (session.user) session.user.id = user.id;
      return session;
    },
  },
};
