import { Prisma } from "../generated/client.ts";
export type TrackingMode = "quantity" | "availability";
export type IngredientTracking = { ingredientId: string; mode: TrackingMode; available: boolean };
export async function ingredientTracking(tx: Prisma.TransactionClient, userId: string): Promise<IngredientTracking[]> {
  const preferences = await tx.ingredientPreference.findMany({ where: { userId }, select: { ingredientId: true, trackingMode: true } });
  const balances = await tx.pantryBalance.findMany({ where: { userId }, select: { ingredientId: true, quantity: true, available: true } });
  const ids = new Set([...preferences.map(row => row.ingredientId), ...balances.map(row => row.ingredientId)]);
  const preferenceById = new Map(preferences.map(row => [row.ingredientId, row]));
  const balanceById = new Map(balances.map(row => [row.ingredientId, row]));
  return [...ids].map(ingredientId => {
    const mode = preferenceById.get(ingredientId)?.trackingMode === "availability" ? "availability" : "quantity";
    const balance = balanceById.get(ingredientId);
    return { ingredientId, mode, available: mode === "availability" ? balance?.available ?? false : !!balance?.quantity.gt(0) };
  });
}
