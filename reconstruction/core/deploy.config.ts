import { defineConfig } from "prisma/config";
import { coreDatabaseUrl } from "./src/environment.ts";

export default defineConfig({
  schema: "schema.prisma",
  migrations: { path: "migrations" },
  datasource: { url: coreDatabaseUrl() },
});
