import type { JSX } from 'react';

import { createWebRbac } from '@12-apps/rbac/react';

import { HARNESS_CATALOG } from '../../../backend/src/rbac-catalog';

/**
 * The whole wiring a frontend host performs for @12-apps/rbac (12-13).
 *
 * Everything the roles + team admin IS — the catalog grid, the permission
 * picker with its governance affordances, the roster, the unified role-edit
 * dialog, the wire calls between them — lives inside the package. This file
 * names where the API is mounted and hands over the host's own permission
 * catalog, and that is the only part that is genuinely the host's.
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
const { page: RbacAdminSurface } = createWebRbac({
  apiBase: '/api/admin/harness',
  catalog: HARNESS_CATALOG,
});

export function RbacAdminPage(): JSX.Element {
  return <RbacAdminSurface />;
}
