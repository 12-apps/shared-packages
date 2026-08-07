/**
 * The React layer of `@12-apps/observability-frontend`.
 *
 * The root entry (`@12-apps/observability-frontend`) is framework-free: init, the pre-init
 * buffer, the noise rules, the PII scrub, `reportRouteCrash`/`reportWarning`.
 * Everything that needs React or a router is here instead, so a consumer that
 * only wants the reporter — a worker, a non-React host, the Vite plugin — never
 * pulls React in through a barrel it did not ask for.
 *
 * Two things live here, and they are two halves of the same guarantee:
 *
 *  - {@link createRouteErrorBoundary} — catch a render crash and REPORT it.
 *    `window.onerror` never sees one: React catches the throw and re-throws it
 *    out of band, so global handlers alone report nothing for the failure that
 *    blanks the screen.
 *  - {@link createObservabilityPage} — the `/__observabilidade` self-check
 *    route, which proves the whole chain is live in a browser that is actually
 *    running the deployed bundle.
 *
 * The self-check PAGE is deliberately not re-exported here: it is reached only
 * through the dynamic `import()` inside `route.tsx` (or the `./self-check`
 * subpath), and naming it in this barrel would pull a diagnostic nobody opens
 * into every app's entry chunk.
 */
export {
  createRouteErrorBoundary,
  type RouteCrashFallbackProps,
  type RouteErrorBoundaryConfig,
  type RouteErrorBoundaryProps,
} from "./error-boundary";
export {
  createObservabilityPage,
  OBSERVABILITY_SELF_CHECK_PATH,
  type ObservabilityPageConfig,
} from "./route";
