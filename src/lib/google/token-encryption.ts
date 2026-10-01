import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";
const version = "v1";

function getEncryptionKey() {
  const encodedKey = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (!encodedKey) {
    throw new Error("Falta configurar GOOGLE_TOKEN_ENCRYPTION_KEY.");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY debe ser una clave base64 de 32 bytes.");
  }
  return key;
}

export function encryptGoogleRefreshToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [version, iv.toString("base64url"), authTag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptGoogleRefreshToken(encryptedToken: string) {
  const [storedVersion, encodedIv, encodedAuthTag, encodedCiphertext] = encryptedToken.split(".");
  if (storedVersion !== version || !encodedIv || !encodedAuthTag || !encodedCiphertext) {
    throw new Error("El refresh token cifrado tiene un formato desconocido.");
  }

  const decipher = createDecipheriv(algorithm, getEncryptionKey(), Buffer.from(encodedIv, "base64url"));
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}
