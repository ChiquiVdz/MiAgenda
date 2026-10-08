import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client.ts";
import { coreDatabaseUrl } from "./environment.ts";

/** Server-side factory. No connection is created merely by importing this file. */
export function createCoreDatabase(): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: coreDatabaseUrl(),
      max: 2,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 15000,
    }),
  });
}
