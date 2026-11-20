import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // The manifest suite imports `./manifest/native`, whose surface reaches
  // `react-native` at runtime; react-native-web stands in for it here as it
  // does in vitest.native.config.ts.
  resolve: { alias: [{ find: /^react-native$/, replacement: "react-native-web" }] },
  test: {
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    environment: "jsdom",
    // React renders here are well inside the 5s default locally and outside it on a
    // contended runner: the whole-workspace run on main timed out a first render
    // twice in a row (FUT-5315, discounts then ui) while every sibling passed. Same
    // bound as @12-apps/auth, notifications and report-builder; a hang still fails.
    testTimeout: 20_000,
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    // The React Native half's tests import `react-native`, which only
    // vitest.native.config.ts aliases to react-native-web.
    exclude: ["**/node_modules/**", "src/**/*.native.test.{ts,tsx}"],
  },
});
