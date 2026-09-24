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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FRESH_RELOAD_PARAM } from '../../core/chunk-recovery';
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

/** A page whose chunk the last deploy removed, as Safari words it. */
function StalePage(): JSX.Element {
  throw new TypeError('Importing a module script failed.');
}

/** The club's "newer version" screen — its own words, like the rest of its copy. */
const CLUB_UPDATE = {
  title: 'O site do clube foi atualizado',
  body: 'Carregue de novo para ver a versão nova do clube.',
  retry: 'Carregar a versão nova',
};

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

/**
 * Replaces `window.location` with one that records where it was sent. The
 * record is returned, so the test owns it — no module-scope state for the next
 * test to inherit.
 */
function stubNavigation(): { replaced: string[]; reloads: number } {
  const calls = { replaced: [] as string[], reloads: 0 };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: 'https://clube.example/pedaladas?grupo=2',
      replace: (url: string) => {
        calls.replaced.push(url);
      },
      reload: () => {
        calls.reloads += 1;
      },
    },
  });
  return calls;
}

const originalLocation = Object.getOwnPropertyDescriptor(window, 'location');

beforeEach(() => {
  // React logs the caught error itself, and so does the boundary; silence both so a
  // passing run is quiet.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalLocation) Object.defineProperty(window, 'location', originalLocation);
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

  it('keeps the plain reload for an ordinary crash', () => {
    const nav = stubNavigation();
    const RouteErrorBoundary = createShellRouteErrorBoundary({
      ...reporter(),
      messages: { ...CLUB_MESSAGES, routeUpdate: CLUB_UPDATE },
    });
    render(
      <RouteErrorBoundary resetKey="a">
        <BadPage />
      </RouteErrorBoundary>,
    );
    // A page bug is not a newer build: the new-version screen must not claim it.
    expect(screen.getByTestId('route-error').textContent).not.toContain(CLUB_UPDATE.title);
    fireEvent.click(screen.getByRole('button', { name: CLUB_MESSAGES.routeErrorRetry }));
    expect(nav.replaced).toEqual([]);
    expect(nav.reloads).toBe(1);
  });
});

/**
 * Seen in production by an adopter: a page from an older build is not an error the reader
 * can act on beyond one tap, and "Importing a module script failed." is noise to
 * them. The host's own "there is a new version" screen replaces it, and its
 * button reloads PAST the caches — the plain reload the recovery already tried
 * is the one a stale document won.
 */
describe('createShellRouteErrorBoundary · a page from an older build', () => {
  it("shows the host's new-version screen instead of the raw message", () => {
    const RouteErrorBoundary = createShellRouteErrorBoundary({
      ...reporter(),
      messages: { ...CLUB_MESSAGES, routeUpdate: CLUB_UPDATE },
    });
    render(
      <RouteErrorBoundary resetKey="a">
        <StalePage />
      </RouteErrorBoundary>,
    );
    // Same test id: every host's e2e specs still find the crashed page.
    expect(screen.getByTestId('route-error')).toBeDefined();
    expect(screen.getByText(CLUB_UPDATE.title)).toBeDefined();
    expect(screen.getByText(CLUB_UPDATE.body)).toBeDefined();
    const shown = screen.getByTestId('route-error').textContent ?? '';
    expect(shown).not.toMatch(/module script/);
    expect(shown).not.toContain(CLUB_MESSAGES.routeErrorTitle);
  });

  it('reloads past every cache from its button, not with a bare reload', () => {
    const nav = stubNavigation();
    const RouteErrorBoundary = createShellRouteErrorBoundary({
      ...reporter(),
      messages: { ...CLUB_MESSAGES, routeUpdate: CLUB_UPDATE },
    });
    render(
      <RouteErrorBoundary resetKey="a">
        <StalePage />
      </RouteErrorBoundary>,
    );
    fireEvent.click(screen.getByRole('button', { name: CLUB_UPDATE.retry }));
    expect(nav.reloads).toBe(0);
    expect(nav.replaced).toHaveLength(1);
    const target = new URL(nav.replaced[0] ?? '');
    expect(target.searchParams.has(FRESH_RELOAD_PARAM)).toBe(true);
    expect(target.pathname).toBe('/pedaladas');
    expect(target.searchParams.get('grupo')).toBe('2');
  });

  it('still reports the stale chunk — the screen changes, the signal does not', () => {
    const host = reporter();
    const RouteErrorBoundary = createShellRouteErrorBoundary({
      ...host,
      messages: { ...CLUB_MESSAGES, routeUpdate: CLUB_UPDATE },
    });
    render(
      <RouteErrorBoundary resetKey="a">
        <StalePage />
      </RouteErrorBoundary>,
    );
    expect(host.seen).toHaveLength(1);
  });

  it('keeps the generic screen for a host with no new-version copy, and still reloads fresh', () => {
    const nav = stubNavigation();
    const RouteErrorBoundary = createShellRouteErrorBoundary(reporter());
    render(
      <RouteErrorBoundary resetKey="a">
        <StalePage />
      </RouteErrorBoundary>,
    );
    expect(screen.getByText(CLUB_MESSAGES.routeErrorTitle)).toBeDefined();
    expect(screen.getByText('Importing a module script failed.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: CLUB_MESSAGES.routeErrorRetry }));
    expect(nav.reloads).toBe(0);
    expect(nav.replaced).toHaveLength(1);
  });
});
