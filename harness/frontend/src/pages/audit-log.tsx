import type { JSX } from 'react';

import { createWebAudit } from '@12-apps/audit/react';

/**
 * The whole wiring a frontend host performs for @12-apps/audit (12-14).
 *
 * Everything the viewer IS — the filter bar, the pills, the day bounds, the actor
 * picker, the trail, the diff summary, the pagination, and the impersonation PAIR
 * — lives inside the package. This file names where the API is mounted, and that
 * is the only part that is genuinely the host's.
 *
 * There is no `transport`, deliberately: the package's default is same-origin
 * `fetch`, Vite proxies `/api` to `harness/backend`, and so every click below
 * crosses a real socket into the package's own Hono router over a real Postgres —
 * the arrangement a real consumer has. The backend's actor seam answers headerless
 * requests as the seeded owner, which is who an admin screen assumes is driving
 * it.
 */
const { page: AuditLogSurface } = createWebAudit({
  apiBase: '/api/admin/tenant-a',
});

export function AuditLogPage(): JSX.Element {
  return <AuditLogSurface />;
}
