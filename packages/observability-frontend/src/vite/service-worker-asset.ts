/**
 * Serve the worker reporter from the consuming app's own origin.
 *
 * `importScripts()` takes a URL, not a module specifier, and a service worker
 * can only load scripts from its own origin. So the IIFE this package builds
 * has to become a file in the app's output — which is a BUILD concern, and
 * therefore belongs here rather than in a copy step every consumer writes for
 * itself and gets subtly wrong.
 *
 * ```ts
 * // vite.config.ts
 * plugins: [react(), observabilityServiceWorkerAsset()]
 * ```
 *
 * ```js
 * // public/sw.js — the first two lines
 * importScripts("/observability-sw.js");
 * observability.installWorkerReporter({ app: "storefront" });
 * ```
 *
 * Both halves are needed. `generateBundle` puts the file in `dist` for
 * production; the dev middleware answers the same path from `node_modules`,
 * because a worker that 404s on its first line in development is a worker
 * nobody can debug — and `public/` is the one directory a build copies
 * verbatim, so writing it there would mean committing a build artifact.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { PluginOption } from "vite";

/** The path the worker asks for. Root-relative: a worker's scope is the origin. */
const PUBLIC_PATH = "/observability-sw.js";

/**
 * Where the built IIFE sits inside this package.
 *
 * Resolved from THIS module's own URL rather than from the consumer's `cwd`,
 * so it keeps working whatever directory the build runs in and however pnpm
 * chose to lay out `node_modules`.
 */
function bundledReporterPath(): string {
  return fileURLToPath(new URL("../observability-sw.global.js", import.meta.url));
}

export function observabilityServiceWorkerAsset(): PluginOption {
  return {
    name: "observability-service-worker-asset",

    async generateBundle() {
      this.emitFile({
        type: "asset",
        // Not hashed, deliberately. The worker names this file as a string
        // literal, and a hashed name would have to be templated into a file
        // that is served verbatim and never passes through a transform.
        fileName: PUBLIC_PATH.slice(1),
        source: await readFile(bundledReporterPath(), "utf8"),
      });
    },

    configureServer(server) {
      server.middlewares.use(PUBLIC_PATH, (_request, response, next) => {
        void readFile(bundledReporterPath(), "utf8").then(
          (source) => {
            response.setHeader("Content-Type", "text/javascript");
            response.end(source);
          },
          // Fall through rather than 500: a missing reporter must not be the
          // reason a development server stops answering.
          () => next(),
        );
      });
    },
  };
}
