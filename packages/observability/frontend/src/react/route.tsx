/**
 * The self-check page's ROUTE, assembled here so an app mounts it in one line.
 *
 * ```tsx
 * const observabilityRoute = createObservabilityPage();
 * // ...
 * <Routes>
 *   {observabilityRoute}
 * </Routes>
 * ```
 *
 * ## Why a factory and not just an exported component
 *
 * Three things have to travel together for this page to prove anything, and all
 * three are easy to get wrong when copied by hand into three route trees:
 *
 *  1. the page must be LAZY, or a diagnostic nobody opens still ships in every
 *     app's main bundle;
 *  2. it must sit behind an error boundary (`./error-boundary`), because the
 *     render-crash button is only meaningful if something catches it — without
 *     one it blanks the tab and reports through the global handler instead,
 *     silently testing the wrong path;
 *  3. the path must match across the three apps, or the runbook stops being one
 *     instruction.
 *
 * Returning the assembled `<Route>` keeps those three facts in one place. An
 * exported component could not: `<Routes>` requires its children to BE `<Route>`
 * elements — it reads them with `createRoutesFromChildren` rather than rendering
 * them — so a component that renders a `<Route>` is silently ignored. A function
 * called outside JSX returns a real element and works.
 *
 * ## Why the module is separate from the page
 *
 * `self-check.tsx` is reached only through the `import()` below. If the factory
 * lived in that file, importing the factory would pull the page into the app's
 * entry chunk and the laziness in point 1 would be a comment describing
 * something that no longer happens.
 */
import { lazy, type ComponentType, type JSX, type ReactNode } from "react";
import { Route } from "react-router-dom";

/** The path every app mounts it on, so the runbook is one URL per host. */
export const OBSERVABILITY_SELF_CHECK_PATH = "/__observabilidade";

/** The page, always behind a dynamic import — see the module docstring. */
const DEFAULT_LAZY = lazy(() =>
  import("./self-check").then((m) => ({ default: m.ObservabilitySelfCheck })),
);

export interface ObservabilityPageConfig {
  /**
   * The host's error boundary, wrapped around the page.
   *
   * Injected rather than imported because the boundary is the HOST's — it is
   * what a real page crash in that app hits, and reusing it is the only reason
   * the render button proves anything. Without one the render button unmounts
   * the tree and the error arrives through the global handler instead, so the
   * page reports success for a path it never exercised.
   */
  boundary?: (children: ReactNode) => JSX.Element;
  /**
   * Override the lazy wrapper. Hosts with a chunk-reload strategy of their own
   * (a stale chunk after a deploy is a 200 of HTML, not a 404) should pass it,
   * so this route self-heals the same way every other route in that app does.
   */
  lazyComponent?: ComponentType;
  /**
   * Override the mount path. Defaults to {@link OBSERVABILITY_SELF_CHECK_PATH}.
   *
   * Prefer the default: the whole point is that one instruction — "open
   * /__observabilidade" — works on every host.
   */
  path?: string;
  /**
   * Wrap in {@link ObservabilityPageConfig.boundary}. Default `true`.
   *
   * Set `false` ONLY when mounting inside a layout that already provides one,
   * to avoid nesting two. Getting this wrong is not cosmetic: with no boundary
   * anywhere above it, the render-crash button unmounts the tree and the error
   * arrives through the global handler, so the page reports success for a path
   * it never exercised.
   */
  withBoundary?: boolean;
}

/**
 * Build the `<Route>` for the observability self-check page.
 *
 * Call it OUTSIDE JSX and interpolate the result — `{createObservabilityPage()}`
 * inside `<Routes>` works, `<CreateObservabilityPage />` does not.
 */
export function createObservabilityPage({
  path = OBSERVABILITY_SELF_CHECK_PATH,
  withBoundary = true,
  boundary,
  lazyComponent,
}: ObservabilityPageConfig = {}): JSX.Element {
  const Page = lazyComponent ?? DEFAULT_LAZY;
  const page = <Page />;
  return (
    <Route path={path} element={withBoundary && boundary ? boundary(page) : page} />
  );
}
