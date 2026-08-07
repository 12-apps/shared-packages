/**
 * Two entries, two formats — and neither format is a preference.
 *
 * Everything else in this package ships as TypeScript SOURCE, like its siblings
 * here, because application code is compiled by the consumer's bundler and raw
 * `.ts` under `node_modules` is fine there. These two are not read by a bundler,
 * so each has to arrive as something its actual loader can execute.
 *
 *   ./vite            → Node       → compiled ESM
 *   ./service-worker  → the worker → a classic script (IIFE)
 *
 * **`./vite`.** Vite loads a `vite.config.ts` by bundling it with esbuild while
 * leaving BARE specifiers external, so the import is resolved and run by Node.
 * Node refuses to strip types below `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — and does not refuse while
 * this is a workspace sibling, because pnpm links it and the realpath falls
 * outside `node_modules`. The failure appears only after publishing.
 *
 * **`./service-worker`.** A classic worker — `register("/sw.js")` with no
 * `{ type: "module" }` — can only pull in code through `importScripts()`, which
 * takes a URL and not a module specifier, and cannot load an ES module at all.
 * So this one is bundled to a single self-contained IIFE with no externals: the
 * config loader and the PII scrub go INSIDE it, which is the whole reason for
 * the worker reporter living in this package instead of being hand-written into
 * each app's `sw.js`.
 */
import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "vite/index": "src/vite/index.ts" },
    format: ["esm"],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    // Both are the consumer's: `vite` supplies only the `PluginOption` type, and
    // the upload plugin must be the same instance the consumer's build resolves.
    external: ["vite", "@sentry/vite-plugin"],
  },
  {
    entry: { "observability-sw": "src/service-worker/index.ts" },
    format: ["iife"],
    // What the worker reaches it by: `observability.installWorkerReporter(…)`.
    globalName: "observability",
    platform: "browser",
    dts: true,
    splitting: false,
    sourcemap: true,
    // The entry above already cleaned `dist`; cleaning again would race it away.
    clean: false,
    // NOTHING external. `importScripts()` has no module resolution to fall back
    // on, so anything left unbundled is a reference the worker cannot satisfy.
    noExternal: [/.*/],
  },
]);
