import "server-only";

import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decryptGoogleRefreshToken } from "@/lib/google/token-encryption";

export class GoogleCalendarConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleCalendarConnectionError";
  }
}

export async function getGoogleCalendarClient(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { encryptedRefreshToken: true },
  });

  if (!user?.encryptedRefreshToken) {
    throw new GoogleCalendarConnectionError("No hay una conexión de Google activa.");
  }

  const clientId = process.env.AUTH_GOOGLE_ID;
  const clientSecret = process.env.AUTH_GOOGLE_SECRET;
  if (!clientId || !clientSecret) {
    throw new GoogleCalendarConnectionError("Falta configurar OAuth de Google.");
  }

  const oauthClient = new google.auth.OAuth2(clientId, clientSecret);
  oauthClient.setCredentials({
    refresh_token: decryptGoogleRefreshToken(user.encryptedRefreshToken),
  });

  return google.calendar({ version: "v3", auth: oauthClient });
}
