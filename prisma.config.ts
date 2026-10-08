import { defineConfig } from "prisma/config";
import { coreDatabaseUrl } from "./reconstruction/core/src/environment";

export default defineConfig({
  schema: "reconstruction/core/schema.prisma",
  migrations: {
    path: "reconstruction/core/migrations",
  },
  datasource: {
    url: coreDatabaseUrl(),
  },
});
