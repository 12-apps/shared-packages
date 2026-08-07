/**
 * The build-time half of this package: the two plugins a consuming app adds to
 * its `vite.config.ts`.
 *
 * Both are here rather than in the app because both are about getting an
 * ARTIFACT into the right shape — one uploads source maps and deletes them
 * before they can be served, the other emits the worker reporter as a file the
 * worker can `importScripts()`. Neither is app-specific, and both are easy to
 * get quietly wrong.
 *
 * This entry is compiled to ESM: Vite bundles a config with esbuild but leaves
 * bare specifiers external, so Node executes it — and Node will not strip types
 * below `node_modules`.
 */
export { sentrySourcemaps, type SentrySourcemapOptions } from "./sentry-sourcemaps";
export { observabilityServiceWorkerAsset } from "./service-worker-asset";
