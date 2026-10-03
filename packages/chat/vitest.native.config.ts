import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/**
 * The native lane, in a browser-shaped DOM — `@12-apps/ui`'s own approach:
 * `react-native` aliases to `react-native-web`, and the `react-native` export
 * condition makes `@12-apps/ui` resolve to its NATIVE primitives, so the
 * thread renders through the components a React Native app would get.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ["react-native", "import", "module", "default"],
    alias: [
      { find: /^react-native$/, replacement: "react-native-web" },
      { find: /^react-native-svg$/, replacement: "react-native-svg/lib/module/index.js" },
      { find: /^react-native-safe-area-context$/, replacement: "react-native-safe-area-context/lib/module/index.js" },
    ],
    extensions: [".native.tsx", ".native.ts", ".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".mjs", ".js", ".jsx", ".json"],
  },
  define: { __DEV__: "true" },
  test: {
    server: {
      deps: {
        inline: [
          /node_modules\/react-native-web\//,
          /node_modules\/react-native-svg\//,
          /node_modules\/react-native-safe-area-context\//,
          /packages\/ui\/dist\/native\//,
          /@12-apps\/ui/,
        ],
      },
    },
    pool: "forks",
    poolOptions: { forks: { maxForks: 2, minForks: 1 } },
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.native.test.{ts,tsx}"],
  },
});
