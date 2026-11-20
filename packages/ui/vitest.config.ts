import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    // Cap the worker pool (see apps/web/vitest.config.ts): bound memory on
    // high-core machines; vitest otherwise forks ~CPU-count heavy workers.
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    environment: "jsdom",
    // React renders here are well inside the 5s default locally and outside it on a
    // contended runner: the whole-workspace run on main timed out a first render
    // twice in a row (FUT-5315, discounts then ui) while every sibling passed. Same
    // bound as @12-apps/auth, notifications and report-builder; a hang still fails.
    testTimeout: 20_000,
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // The React Native half's tests import `react-native`, which only
    // vitest.native.config.ts aliases to react-native-web.
    exclude: ["**/node_modules/**", "src/**/*.native.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules/", "src/__tests__/setup.ts"],
    },
  },
});
