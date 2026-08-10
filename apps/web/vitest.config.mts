import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    // The same `@/*` the app and tsconfig use. Without it a domain module that
    // imports a sibling by alias resolves under `next build` and fails only in
    // the test run, which is the worst possible place to find out.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
