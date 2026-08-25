import type { JSX } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';

import { PT_BR_RBAC_WEB_COPY } from '@12-apps/rbac/react';
import { rbacManifest } from '@12-apps/rbac/manifest';
import { rbacWebManifest } from '@12-apps/rbac/manifest/web';

import { webWiringHost } from '../wiring-web';

import { HARNESS_CATALOG } from '../../../backend/src/rbac-catalog';

/**
 * The whole wiring a frontend host performs for @12-apps/rbac (12-13).
 *
 * Everything the roles + team admin IS — the catalog grid, the permission
 * picker with its governance affordances, the roster, the invite flow, the
 * unified role-edit dialog, the per-member profile, the wire calls between
 * them — lives inside the package. This file names where the API is mounted,
 * hands over the host's own permission catalog, formats two dates and routes
 * three screens, and that is the only part that is genuinely the host's.
 *
 * The catalog is the SAME object the backend mounts (`rbac-catalog.ts`), not a
 * second copy: the picker's groups, its pt-BR labels, its owner markers and
 * its SoD pairs have to be the ones the endpoints enforce, and the surest way
 * for a screen and its API to agree about governance is for there to be one
 * assembly. The package used to supply a default here, which is exactly how
 * they could disagree — a host passing its own registry to the server and
 * saying nothing to the browser got a screen governed by another app's
 * catalog.
 *
 * There is no `transport`, deliberately: the package's default is same-origin
 * `fetch`, Vite proxies `/api` to `harness/backend`, and so every click below
 * crosses a real socket into the package's own Hono router over a real
 * Postgres — the arrangement a real consumer has. The backend's actor seam
 * answers headerless requests as the seeded DIRECTOR, which is who an admin
 * screen assumes is driving it.
 */

/** The tenant these screens act inside — the slug `apiBase` is mounted under. */
const TENANT_SLUG = 'harness';

/**
 * The screens render two dates and format neither: presentation is a locale
 * decision, and this host's locale is pt-BR. Built once at module scope because
 * an `Intl.DateTimeFormat` is expensive to construct and these never vary.
 */
const DATE = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Navigation, written to the hash directly rather than through `useNavigate`.
 *
 * The binding below is built ONCE at module scope — it has to be, because its
 * members are component types and rebuilding them per render would unmount the
 * tree mid-edit — so there is no hook context to read here. Writing the hash is
 * what a `HashRouter` listens to anyway, so the router picks it up exactly as
 * it would a `navigate()` call.
 */
const go = (path: string): void => {
  window.location.hash = `#/rbac-admin${path}`;
};

/**
 * Adopted through `@12-apps/wiring/consumer` rather than by calling the factory:
 * the same config, handed through a typed binding, and the AREAS the manifest
 * declares — three admin routes and their nav rows, each naming the permission
 * it is gated on — collected into the host's report instead of being invisible.
 *
 * `e2e` is BOUND here rather than declined. The package ships its own roster
 * and catalog journeys plus the `RbacWorld` port; this harness implements that
 * port in `tests/e2e/steps/rbac-world.ts` and points its bdd config at the
 * package's globs, so a scenario added upstream runs here on the next bump
 * instead of being quietly missed.
 */
const { surface } = webWiringHost.adoptWeb({
  manifest: rbacManifest,
  web: rbacWebManifest,
  e2e: { featuresRoot: '.features-gen' },
  bindings: {
    surface: {
      config: {
        apiBase: `/api/admin/${TENANT_SLUG}`,
        tenantSlug: TENANT_SLUG,
        catalog: HARNESS_CATALOG,
        // The screens' sentences are required host config; this host is pt-BR.
        copy: PT_BR_RBAC_WEB_COPY,
        formatters: {
          date: (iso: string) => DATE.format(new Date(iso)),
          dateTime: (iso: string) => DATE_TIME.format(new Date(iso)),
        },
        navigate: {
          member: (userId: string) => go(`/team/${encodeURIComponent(userId)}`),
          // A role's holders are the roster filtered to that role — the same
          // `role_in` pill the grid writes when an operator picks it by hand.
          roleMembers: (roleName: string) =>
            go(`/?role_in=${encodeURIComponent(roleName)}`),
        },
        breadcrumbs: {
          member: [{ label: 'Equipe', href: '#/rbac-admin' }],
        },
      },
    },
  },
});

const bound = surface as {
  page: () => JSX.Element;
  MemberScreen: () => JSX.Element;
};

/**
 * A REAL router, for the reason `discounts.tsx` states beside its own: the
 * screens keep their grid state in `useSearchParams`, so a filtered roster is
 * a URL somebody can bookmark and send on. A `MemoryRouter` would satisfy the
 * context and silently throw that away — every screen renders, every filter
 * works, and the address bar never moves.
 *
 * `basename` is this page's own slug, the segment the shell reads to decide
 * which page is showing, so the surface writes `#/rbac-admin?q=…` and the
 * shell still finds `rbac-admin` at the front of it.
 *
 * The index route keeps the package's own tabs, which is how this harness has
 * always mounted the surface. The member profile is a route because the
 * manifest declares it as one and the roster's rows navigate to it.
 */
export function RbacAdminPage(): JSX.Element {
  return (
    <div data-testid="page-rbac-admin">
      <HashRouter basename="/rbac-admin">
        <Routes>
          <Route path="/team/:userId" element={<bound.MemberScreen />} />
          <Route path="*" element={<bound.page />} />
        </Routes>
      </HashRouter>
    </div>
  );
}
