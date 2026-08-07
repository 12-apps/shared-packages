/**
 * The boundary that turns a crashed page into an error state — and into an event.
 *
 * React unmounts the entire root when an error reaches it uncaught, so without
 * one of these ANY throw below the shell — a failed chunk fetch, a page
 * component blowing up on bad data — paints a blank white screen: no chrome, no
 * message, nothing to click. Wrap the routed `<Outlet>` in one and a broken page
 * stays a broken PAGE, with the shell around it still working.
 *
 * It is in THIS package rather than in an app because it is half of the browser
 * reporting story. `window.onerror` does not see a render throw — React catches
 * it and re-throws it out of band — so an app with global handlers but no
 * boundary reports nothing for the failure mode that blanks the screen. The two
 * belong together, and shipping them apart is how one ends up missing.
 *
 * ## Configured once, not per app
 *
 * The mechanics here are universal; the *look* of a crashed page is not, and
 * neither is its language. So this module exports a factory rather than a
 * component: an app configures the fallback once and gets back a
 * `<RouteErrorBoundary resetKey={…}>` that every layout uses unchanged.
 *
 * ```tsx
 * export const RouteErrorBoundary = createRouteErrorBoundary({
 *   fallback: ({ error, reload }) => (
 *     <ErrorState message={error.message} onRetry={reload} />
 *   ),
 * });
 * ```
 */
import { Component, type ErrorInfo, type JSX, type ReactNode } from "react";

import { reportRouteCrash } from "../index";

/** What the host's fallback is handed when a page has crashed. */
export interface RouteCrashFallbackProps {
  /** The error React caught. Its `message` is usually the only useful part. */
  error: Error;
  /**
   * Reload the document.
   *
   * The honest retry for this failure: the common cause is a chunk that no
   * longer exists after a deploy, and re-rendering the same broken tree cannot
   * fix that — only fetching the new index can. Prefer it over
   * {@link RouteCrashFallbackProps.reset} unless you know the crash was
   * transient.
   */
  reload: () => void;
  /**
   * Clear the error and re-render the children, without a network round-trip.
   *
   * Only useful when the host knows the crash was data-dependent and the data
   * has since changed; against a dead chunk it re-renders straight back into
   * the same failure.
   */
  reset: () => void;
}

export interface RouteErrorBoundaryConfig {
  /** Rendered in place of the children once a crash is caught. */
  fallback: (props: RouteCrashFallbackProps) => ReactNode;
  /**
   * Where a caught crash is reported. Defaults to this package's
   * {@link reportRouteCrash}, which is what you want unless the host routes
   * reporting through an adapter of its own.
   */
  onCrash?: (error: unknown, componentStack?: string | null) => void;
}

export interface RouteErrorBoundaryProps {
  /**
   * Changing this value clears the captured error — pass the routed location
   * key.
   *
   * Without it the boundary LATCHES: error state is component state, and React
   * keeps rendering the fallback until something resets it, so every subsequent
   * navigation would show the failure of a page the user has already left.
   */
  resetKey: string;
  children: ReactNode;
}

interface BoundaryProps extends RouteErrorBoundaryProps, RouteErrorBoundaryConfig {}

interface BoundaryState {
  error: Error | null;
}

class RouteErrorBoundaryImpl extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  private readonly reset = (): void => {
    this.setState({ error: null });
  };

  private readonly reload = (): void => {
    window.location.reload();
  };

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console line stays, and is the one place in a SPA where it earns its
    // keep (FUT-724): support reads it back over the phone with an operator who
    // has devtools open, and it carries the component trace the stack alone
    // does not. It is not a substitute for reporting — `onCrash` on the next
    // line is that — it is a second copy for a live call.
    // eslint-disable-next-line no-console
    console.error("[route] page crashed", error, info.componentStack);
    // …and the same crash now leaves the browser (FUT-717). A no-op until the
    // app is handed a DSN, so dev, CI and tests stay offline.
    const { onCrash = reportRouteCrash } = this.props;
    onCrash(error, info.componentStack);
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.reset();
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return this.props.fallback({ error, reload: this.reload, reset: this.reset });
  }
}

/**
 * Build the app's route error boundary.
 *
 * Call it ONCE, at module scope, and export the result — a boundary rebuilt on
 * every render is a different component type each time, which unmounts and
 * remounts the whole subtree below it on every parent render.
 */
export function createRouteErrorBoundary(
  config: RouteErrorBoundaryConfig,
): (props: RouteErrorBoundaryProps) => JSX.Element {
  function RouteErrorBoundary({
    resetKey,
    children,
  }: RouteErrorBoundaryProps): JSX.Element {
    return (
      <RouteErrorBoundaryImpl {...config} resetKey={resetKey}>
        {children}
      </RouteErrorBoundaryImpl>
    );
  }
  RouteErrorBoundary.displayName = "RouteErrorBoundary";
  return RouteErrorBoundary;
}
