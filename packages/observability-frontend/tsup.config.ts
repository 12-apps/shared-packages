/**
 * Builds ONE entry: the Vite plugin. Everything else in this package ships as
 * TypeScript source, like its siblings here.
 *
 * ## Why this one file is different
 *
 * Every other entry is imported from application code, which a bundler compiles
 * — raw `.ts` in `node_modules` is fine there. `./vite` is imported from a
 * consumer's `vite.config.ts`, and Vite loads that config by bundling it with
 * esbuild while leaving BARE specifiers external. So the import is resolved and
 * executed by **Node**, not by a bundler.
 *
 * Node refuses to strip types below `node_modules`:
 *
 *   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
 *   Stripping types is currently unsupported for files under node_modules
 *
 * That error does not appear while this package is a workspace sibling — pnpm
 * links it, and Node resolves the realpath OUTSIDE `node_modules`, so type
 * stripping applies and raw TS works. It appears the moment the package is
 * installed from the registry, which is to say in every consumer, on the first
 * `vite build` after publishing. Shipping this entry as JS is what stops that.
 */
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { "vite/sentry-sourcemaps": "src/vite/sentry-sourcemaps.ts" },
  format: ["esm"],
  dts: true,
  splitting: false,
  sourcemap: true,
  clean: true,
  // Both are the consumer's: `vite` supplies only the `PluginOption` type, and
  // the upload plugin must be the same instance the consumer's build resolves.
  external: ["vite", "@sentry/vite-plugin"],
});
