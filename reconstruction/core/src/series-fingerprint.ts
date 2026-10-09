import { createHash } from "node:crypto";
import type { Prisma } from "../generated/client.ts";

/** Includes exceptions and children outside the downloaded calendar window. */
export async function seriesFingerprint(tx: Prisma.TransactionClient, userId: string, seriesId: string) {
  const family = await tx.recurrenceSeries.findFirst({ where: { userId, id: seriesId }, select: { revision: true, retiredAt: true } });
  if (!family) return null;
  const rows = await tx.activity.findMany({
    where: { userId, OR: [{ occurrence: { is: { userId, seriesId } } }, { parent: { is: { userId, occurrence: { is: { userId, seriesId } } } } }] },
    orderBy: { id: "asc" }, select: { id: true, revision: true, lifecycle: true, updatedAt: true, schedule: true },
  });
  return createHash("sha256").update(JSON.stringify({ family, rows })).digest("hex");
}
