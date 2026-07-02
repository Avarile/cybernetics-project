import { defineConfig } from "vitest/config";

// Unit tests target pure functions and services instantiated manually (no Nest DI reflection),
// so esbuild transform is sufficient. Integration tests that need decorator metadata should use
// the built output (tsc) or add an SWC transform.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.spec.ts", "tests/**/*.spec.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.spec.ts", "src/main.ts", "src/worker.ts", "src/scheduler.ts"],
    },
  },
});
