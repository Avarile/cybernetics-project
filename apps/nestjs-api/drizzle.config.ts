import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Introspection/push config. Django owns DDL in production (see 02-data-layer-drizzle.md §5); this is
// used to (a) `pull` the real schema for parity and (b) `push` to a disposable TEST database for e2e.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/**/*.schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://plane:plane@localhost:5433/plane_test",
  },
});
