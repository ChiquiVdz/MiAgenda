import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "../generated/client.ts";
import { uuid } from "./contracts.ts";
import { CoreError } from "./errors.ts";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
/** Same owner lock and receipt namespace for activities and module commands. */
export async function executeOwnerCommand<T extends object>(db: PrismaClient, authenticatedOwner: string,
  command: { commandId: string; action: string }, apply: (tx: Prisma.TransactionClient, userId: string) => Promise<T>, timeout = 15000) {
  const userId = uuid(authenticatedOwner), payloadHash = createHash("sha256").update(canonical(command)).digest("hex");
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}::text, 0))`;
        const owners = await tx.$queryRaw<{ id: string; dataRevision: bigint }[]>`SELECT id, "dataRevision" FROM public.users WHERE id = ${userId}::uuid FOR UPDATE`;
        if (!owners.length) throw new CoreError("UNAUTHENTICATED", "La sesión no pertenece al núcleo actual.");
        const receipt = await tx.commandReceipt.findUnique({ where: { userId_commandId: { userId, commandId: command.commandId } } });
        if (receipt) {
          if (receipt.action !== command.action || receipt.payloadHash !== payloadHash) throw new CoreError("IDEMPOTENCY_CONFLICT", "Este comando ya se usó con otro contenido.");
          return { ...(receipt.result as unknown as T), replayed: true };
        }
        const result = { ...await apply(tx, userId), baseDataRevision: owners[0].dataRevision.toString() };
        await tx.commandReceipt.create({ data: { userId, commandId: command.commandId, action: command.action, payloadHash, result: result as unknown as Prisma.InputJsonValue } });
        return { ...result, replayed: false };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10000, timeout });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const code = String(error.meta?.code ?? "");
        if (attempt < 2 && (error.code === "P2034" || ["40001", "40P01"].includes(code))) continue;
        if (error.code === "P2002") throw new CoreError("CONFLICT", "Ese nombre o identificador ya existe. Actualiza y usa el existente.");
        if (["P2003", "P2025"].includes(error.code)) throw new CoreError("DEPENDENCY", "Una referencia cambió o ya no está disponible.");
      }
      throw error;
    }
  }
}
