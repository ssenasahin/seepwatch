import { defineConfig } from "prisma/config";

// The CLI no longer reads .env on its own: the npm scripts load it with dotenv-cli,
// and in production the container's environment holds DATABASE_URL. `prisma
// generate` runs at build time without one, so it is not required here.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "" },
});
