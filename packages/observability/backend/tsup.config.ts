/**
 * This package ships COMPILED, unlike most of its siblings here — and for the
 * same reason the frontend package compiles its Vite entry: what loads it is
 * Node, not a bundler.
 *
 * Two consequences, both load-bearing:
 *
 *  1. **Node refuses to strip types below `node_modules`**
 *     (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). A server that imports
 *     this package from the registry gets a hard failure on raw `.ts`. It does
 *     NOT fail inside this workspace, because pnpm links the package and Node
 *     resolves a realpath outside `node_modules` — so the bug would first
 *     appear in a consumer, after publishing.
 *  2. **`@12-apps/shared-helpers` is CommonJS** (`module: commonjs`,
 *     `moduleResolution: Node`) and it is the first consumer. Classic
 *     resolution ignores the `exports` map entirely and reads `main`/`types`,
 *     and its emitted code `require()`s at runtime. So CJS is not optional
 *     here, and neither are the `.d.ts` files.
 *
 * Hence dual format — the same shape `@12-apps/ui` publishes.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts" },
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // The consumer's, both of them: the SDK must be the one instance the host
  // process initialises, and the transport base class the one Winston knows.
  external: ["@sentry/node", "winston-transport"],
});
