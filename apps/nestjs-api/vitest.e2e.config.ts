import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

// e2e tests boot the real Nest app (decorators need SWC metadata) against a live test Postgres.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/**/*.e2e.spec.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2022",
      },
    }),
  ],
});
