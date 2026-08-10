import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useRef, type JSX } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import { createWebReportBuilder } from '@12-apps/report-builder/react';

/**
 * The whole wiring a frontend host performs for this package.
 *
 * Everything the reports feature IS — the list, the viewer, the editor, the
 * config panel, the pickers, the routes between them — lives inside
 * @12-apps/report-builder. This file names the tenant and mounts the surface
 * into a router, which is the only part that is genuinely the host's.
 *
 * There is no `transport`, and that absence is the point. This page used to
 * pass one that mounted the package's Hono router INSIDE the browser — Hono is
 * isomorphic, so `router.request()` answered every screen with no socket in
 * between. It proved the client and server halves of the contract against each
 * other, and it lied about being a consumer: hitting Save produced no network
 * request, and a reload threw the work away. `harness/backend` is a real server
 * on a real port now and Vite proxies `/api` to it, so omitting `transport`
 * gets the package's own same-origin `fetch` — the arrangement a real host has,
 * and therefore the one this fixture should be exercising.
 */

/** This page's harness slug — and so the hash prefix everything below owns. */
const PAGE_SLUG = 'report-builder';

/** Whose reports these are. The package builds its own paths out of it. */
const TENANT_SLUG = 'harness';

/**
 * Where the surface has to be mounted inside the router.
 *
 * Not a preference: every screen in the package navigates to an absolute
 * `/<tenantSlug>/reports/…`, so a host that mounts it anywhere else matches
 * nothing the moment anything is clicked.
 */
const SURFACE_ROOT = `/${TENANT_SLUG}/reports`;

const { page: ReportBuilderSurface } = createWebReportBuilder({
  tenantSlug: TENANT_SLUG,
  // NOT standalone. `standalone` wraps the surface in a `MemoryRouter`, which
  // is what a host with no router at all needs — and a memory router keeps its
  // location in a variable, so opening a report changed the screen and left the
  // address bar saying `#/report-builder`. Nothing could be linked to, reloaded
  // or backed out of. This page has a router, so the surface uses it.
  standalone: false,
});

/**
 * The cache the surface shares with its host.
 *
 * `standalone` used to stand one up. A host that owns the router owns this too
 * — the arrangement future-pay's admin has, where an invalidation anywhere in
 * the app reaches the reports screens.
 */
const queryClient = new QueryClient();

/** The router's path: whatever the hash holds BELOW this page's own slug. */
function pathBelowSlug(): string | null {
  const hash = window.location.hash.replace(/^#/, '');
  const prefix = `/${PAGE_SLUG}`;
  if (hash === prefix) return '/';
  // Another page entirely — the shell is about to unmount this one, so there is
  // nothing here to follow and a bare remainder is not a path to navigate to.
  if (!hash.startsWith(`${prefix}/`)) return null;
  return hash.slice(prefix.length);
}

/**
 * Follow a hash the SHELL changed.
 *
 * react-router's hash history listens on `popstate` alone, and writes its own
 * navigations with `pushState` — which fires no `hashchange`. That is right in
 * an app that owns the whole hash; here the shell owns the first segment, and
 * its nav rows are plain `<a href="#/…">`. So clicking "Report builder" while
 * reading a report moved the address bar and nothing else, leaving the URL and
 * the screen disagreeing — the same defect this page exists to fix, arrived at
 * from the other side.
 *
 * `replace`, not push: the anchor has already added the entry the click asked
 * for, and pushing would make one click cost two steps of history.
 */
function FollowShellHash(): null {
  const navigate = useNavigate();
  const location = useLocation();
  // What is on screen, readable from inside a listener that outlives a render.
  const shown = useRef(location);
  shown.current = location;

  useEffect(() => {
    const onHashChange = (): void => {
      const wanted = pathBelowSlug();
      if (wanted === null) return;
      if (wanted === `${shown.current.pathname}${shown.current.search}`) return;
      void navigate(wanted, { replace: true });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [navigate]);

  return null;
}

export function ReportBuilderPage(): JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      {/* A REAL router, on the address bar. Its `basename` is this page's own
          slug — the segment the shell reads — so the surface writes
          `#/report-builder/harness/reports/r1` and the shell still finds
          `report-builder` at the front of it. */}
      <HashRouter basename={`/${PAGE_SLUG}`}>
        <FollowShellHash />
        <Routes>
          <Route path={`${SURFACE_ROOT}/*`} element={<ReportBuilderSurface />} />
          {/* `#/report-builder` on its own is the PAGE, not one of its screens.
              Replaced rather than pushed, so Back leaves the harness page it
              landed on instead of bouncing off this redirect. */}
          <Route path="*" element={<Navigate to={SURFACE_ROOT} replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
