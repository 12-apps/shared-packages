// @vitest-environment jsdom
/**
 * The shell's CONFIGURATION of the boundary — the fallback, not the mechanics.
 *
 * Reset-on-navigation, latching and reporting belong to `createRouteErrorBoundary`
 * and are covered in `@12-apps/observability-frontend`'s own suite. What these cases
 * pin down is what an adopting app renders when a page dies: the `route-error` test
 * id, which every host's e2e specs select on, the error's own message rather than a
 * generic apology, and the fact that the crash reaches the reporter the HOST passed
 * rather than the package's default.
 *
 * Ported from `@repo/spa-shared`'s route-error-boundary suite.
 */
import { render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppShellMessages } from '../messages';
import { CLUB_MESSAGES } from '../../__tests__/host-copy';
import { createShellRouteErrorBoundary } from '../route-error-boundary';

/** A page that renders — the healthy case. */
function GoodPage(): JSX.Element {
  return <p>conteúdo da página</p>;
}

/** A page that throws on render — a crashed chunk, or a page bug. */
function BadPage(): JSX.Element {
  throw new Error('chunk exploded');
}

/** The crashes a host's reporter saw, in a container the test owns. */
function reporter(): {
  seen: unknown[];
  onCrash: (error: unknown) => void;
  messages: AppShellMessages;
} {
  const seen: unknown[] = [];
  // `messages` is required config now, so the helper that builds every config
  // in this file states it once — in this suite's own voice, never a default.
  return { seen, onCrash: (error: unknown) => seen.push(error), messages: CLUB_MESSAGES };
}

beforeEach(() => {
  // React logs the caught error itself, and so does the boundary; silence both so a
  // passing run is quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createShellRouteErrorBoundary', () => {
  it('renders the page when nothing throws', () => {
    const RouteErrorBoundary = createShellRouteErrorBoundary(reporter());
    render(
      <RouteErrorBoundary resetKey="a">
        <GoodPage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('conteúdo da página')).toBeDefined();
  });

  it('renders an error state instead of blanking the tree', () => {
    const RouteErrorBoundary = createShellRouteErrorBoundary(reporter());
    render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('route-error')).toBeDefined();
    expect(screen.getByText('chunk exploded')).toBeDefined();
    expect(screen.getByText(CLUB_MESSAGES.routeErrorTitle)).toBeDefined();
  });

  it('clears the error when the location changes', async () => {
    const RouteErrorBoundary = createShellRouteErrorBoundary(reporter());
    const view = render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByTestId('route-error')).toBeDefined();

    // Navigating away must not carry the previous page's failure along.
    view.rerender(
      <RouteErrorBoundary resetKey="b">
        <GoodPage />
      </RouteErrorBoundary>,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('route-error')).toBeNull();
    });
    expect(screen.getByText('conteúdo da página')).toBeDefined();
  });

  /**
   * The reason `onCrash` is REQUIRED. The boundary's own default reports straight
   * through `@12-apps/observability-frontend`, past the noise classifiers a host
   * registers — so a crashed page could file an issue for a routine 404. A crash
   * that did not reach the host's reporter would be silent in exactly the place
   * browser reporting exists to cover.
   */
  it('reports the crash through the reporter the host passed', () => {
    const host = reporter();
    const RouteErrorBoundary = createShellRouteErrorBoundary(host);
    render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    expect(host.seen).toHaveLength(1);
    expect((host.seen[0] as Error).message).toBe('chunk exploded');
  });

  it('renders the copy of a host in another language', () => {
    // The seam is not a translation feature — it is where the sentences come
    // from at all. A host in English states English; nothing in the package
    // has an opinion about which language that is.
    const RouteErrorBoundary = createShellRouteErrorBoundary({
      ...reporter(),
      messages: {
        ...CLUB_MESSAGES,
        routeErrorTitle: 'This page could not open',
        routeErrorRetry: 'Reload',
      },
    });
    render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText('This page could not open')).toBeDefined();
    expect(screen.getByText('Reload')).toBeDefined();
  });
});
