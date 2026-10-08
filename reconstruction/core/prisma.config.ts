import { defineConfig } from "prisma/config";

// Dummy address only for schema-engine initialization. Offline commands never
// use a datasource input, and this config cannot connect to the active database.
export default defineConfig({
  schema: "schema.prisma",
  migrations: { path: "migrations" },
  datasource: { url: "postgresql://offline:offline@127.0.0.1:1/offline" },
});
