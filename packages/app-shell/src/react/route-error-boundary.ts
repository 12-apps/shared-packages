/**
 * The app's route error boundary — the CONFIGURATION, not the mechanism.
 *
 * The boundary itself (catch, report, reset on navigation) is
 * `@12-apps/observability-frontend/react`'s `createRouteErrorBoundary`, because
 * catching a render crash is half of browser reporting: `window.onerror` never
 * sees one, so global handlers without a boundary report nothing for the failure
 * mode that blanks the screen.
 *
 * What this module adds is what a crashed page LOOKS like — this design system's
 * `ErrorState`, in the host's own language — and it is built once here so all three
 * of a product's SPAs render the same thing with the same `route-error` test id
 * that their e2e specs select on.
 *
 * ## `onCrash` is REQUIRED
 *
 * `createRouteErrorBoundary` defaults it to observability's own `reportRouteCrash`,
 * and that default is wrong for a host: a product registers noise classifiers
 * (an `ApiError` is not a crash, a stale chunk is not a crash) and reporting
 * straight past them means a crashed page can file an issue for a routine 404. So
 * the reporter is passed in — through the host's OWN observability adapter, which
 * is the import that loads those classifiers.
 */
import { createRouteErrorBoundary } from '@12-apps/observability-frontend/react';

import { messagesOf, type AppShellMessages } from './messages';
import { errorStateFallback } from './route-error-fallback';

/** Where a caught crash is reported. Matches the boundary's own signature. */
export type RouteCrashReporter = (error: unknown, componentStack?: string | null) => void;

export interface ShellRouteErrorBoundaryConfig {
  /**
   * Where a caught crash is reported. REQUIRED — see the module docstring; a
   * default here silently reports through a path with no noise rules on it.
   */
  onCrash: RouteCrashReporter;
  messages: AppShellMessages;
}

/**
 * Build the boundary. Call it ONCE, at module scope (the shell factory does).
 *
 * A boundary rebuilt per render is a new component type each time, so React would
 * unmount and remount everything below it whenever the layout re-renders.
 */
export function createShellRouteErrorBoundary(config: ShellRouteErrorBoundaryConfig) {
  const messages = messagesOf(config.messages);
  return createRouteErrorBoundary({
    // `reload`, not `reset`: the usual cause of a crashed page is a chunk that
    // stopped existing at the last deploy, and re-rendering the same tree cannot
    // fetch a file that is gone.
    fallback: ({ error, reload }) => errorStateFallback({ error, reload, messages }),
    onCrash: config.onCrash,
  });
}
