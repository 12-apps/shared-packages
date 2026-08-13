import { useSyncExternalStore, type JSX } from 'react';

/**
 * A page that crashes when told to, and the host reporter that hears about it (12-18).
 *
 * The boundary is the half of browser error reporting that `window.onerror` cannot
 * cover: React catches a render throw and re-throws it out of band, so an app with
 * global handlers but no boundary reports NOTHING for the failure mode that blanks the
 * screen. A unit test can render a component that throws; only a real browser can show
 * that the shipped boundary — built by the published factory, against the published
 * design system — renders this product's error state instead of an empty `#root`.
 */

/** The crashes the host's reporter saw, as a subscribable store. */
const state: { reports: string[]; listeners: Set<() => void> } = {
  reports: [],
  listeners: new Set(),
};

export const crashReports = {
  /** What `onCrash` is wired to in the page. */
  push(message: string): void {
    state.reports = [...state.reports, message];
    for (const listener of state.listeners) listener();
  },
  subscribe(listener: () => void): () => void {
    state.listeners.add(listener);
    return () => {
      state.listeners.delete(listener);
    };
  },
  count: (): number => state.reports.length,
};

/**
 * The count, rendered OUTSIDE the boundary and subscribed to the store.
 *
 * Both halves of that matter. Inside the boundary it would be replaced by the fallback
 * along with everything else, and read from a parent that does not re-render it would
 * still say `0` — the crash is reported during the boundary's own `componentDidCatch`,
 * after the last render anything above it performed. A subscription is what makes
 * "reported" observable at all rather than merely "rendered".
 */
export function CrashCount(): JSX.Element {
  const count = useSyncExternalStore(crashReports.subscribe, crashReports.count);
  return <p data-testid="crash-count">{count}</p>;
}

function Boom(): JSX.Element {
  throw new Error('a página explodiu');
}

/** The page under the boundary: fine until asked to crash. */
export function CrashingPanel({ crashed }: { crashed: boolean }): JSX.Element {
  return crashed ? <Boom /> : <p data-testid="crash-idle">ok</p>;
}
