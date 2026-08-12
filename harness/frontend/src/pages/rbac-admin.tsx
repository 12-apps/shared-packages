import type { JSX } from 'react';

import { createWebRbac } from '@12-apps/rbac/react';

/**
 * The whole wiring a frontend host performs for @12-apps/rbac (12-13).
 *
 * Everything the roles + team admin IS — the catalog grid, the permission
 * picker with its governance affordances, the roster, the unified role-edit
 * dialog, the wire calls between them — lives inside the package. This file
 * names where the API is mounted, and that is the only part that is
 * genuinely the host's.
 *
 * There is no `transport`, deliberately: the package's default is same-origin
 * `fetch`, Vite proxies `/api` to `harness/backend`, and so every click below
 * crosses a real socket into the package's own Hono router over a real
 * Postgres — the arrangement a real consumer has. The backend's actor seam
 * answers headerless requests as the seeded OWNER, which is who an admin
 * screen assumes is driving it.
 */
const { page: RbacAdminSurface } = createWebRbac({
  apiBase: '/api/admin/harness',
});

export function RbacAdminPage(): JSX.Element {
  return <RbacAdminSurface />;
}
