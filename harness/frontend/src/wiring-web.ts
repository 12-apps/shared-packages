/**
 * The browser host's ONE wiring host, and the report every adopted surface
 * lands in.
 *
 * Three pages built their own `createWiringHost` with the same `loggerFor` port
 * copy-pasted between them, which is the shape the backend harness already
 * learned to refuse: a host has ONE identity, and a report split across three
 * of them can never answer "is every declared capability of every adopted
 * package accounted for" — the question the consumer exists to make askable.
 *
 * So this module holds the host, and each page adopts INTO it at module scope.
 * Module scope is also the memoisation the surface factories require: they
 * return component TYPES, and rebuilding one unmounts the tree under it.
 *
 * ## Why `report()` is a function
 *
 * `assemble()` is the refusal — it throws while any declared capability is
 * unanswered — and it has to run AFTER every page module has adopted. A
 * constant here would run at this module's own evaluation, which is before any
 * of them, and would report a host that had adopted nothing. The
 * `#/wiring` page calls it during render, by which time every page module has
 * been imported.
 */
import { createWiringHost, type WiringReport } from '@12-apps/wiring/consumer';

/**
 * The browser half of the observability capability, mandatory for runtime
 * manifests since wiring 1.3.0: a refusal files under the package's own
 * namespace rather than nowhere. A real host hands its Sentry scope here; the
 * harness's sink is the console, which is the one legitimate console call in
 * this app.
 */
export const webWiringHost = createWiringHost({
  name: 'harness-frontend',
  kind: 'web',
  ports: {
    loggerFor: (namespace) => ({
      info: (message, ...meta) => console.info(`[${namespace}] ${message}`, ...meta),
      warn: (message, ...meta) => console.warn(`[${namespace}] ${message}`, ...meta),
      error: (message, ...meta) => console.error(`[${namespace}] ${message}`, ...meta),
    }),
  },
});

/** The aggregate report over everything adopted so far — see the note above. */
export function webWiringReport(): WiringReport {
  return webWiringHost.assemble().report;
}
