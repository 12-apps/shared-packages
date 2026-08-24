import type { JSX } from 'react';

import { defineAuditVocabulary } from '@12-apps/audit';
import { auditManifest } from '@12-apps/audit/manifest';
import { auditWebManifest } from '@12-apps/audit/manifest/web';

import { webWiringHost } from '../wiring-web';

/**
 * The whole wiring a frontend host performs for @12-apps/audit.
 *
 * Everything the viewer IS — the filter bar, the pills, the day bounds, the actor
 * picker, the trail, the diff summary, the pagination, and the impersonation PAIR
 * — lives inside the package. This file names where the API is mounted and what
 * this application's own actions, resources and words are; that is the only part
 * genuinely the host's.
 *
 * The vocabulary is DECLARED here rather than imported from the package. It used
 * to be the package's own default, so this page rendered another product's
 * filter bar in another product's language and nothing said so. It is the same
 * shape the backend harness declares (`harness/backend/src/audit-host.ts`); a
 * real host would import one module from a shared layer, which the two harness
 * apps deliberately do not have — they are separate installs of the tarball,
 * which is the arrangement under test.
 *
 * There is no `transport`, also deliberately: the package's default is
 * same-origin `fetch`, Vite proxies `/api` to `harness/backend`, and so every
 * click below crosses a real socket into the package's own Hono router over a
 * real Postgres — the arrangement a real consumer has. The backend's actor seam
 * answers headerless requests as the seeded owner, which is who an admin screen
 * assumes is driving it.
 */
const AUDIT_VOCABULARY = defineAuditVocabulary({
  actions: {
    'lamp.extinguish': { label: 'Lamp extinguished' },
    'lamp.relight': { label: 'Lamp relit' },
    'supply.deliver': { label: 'Supply run delivered' },
    'keeper.assign': { label: 'Keeper assigned' },
  },
  resources: {
    lamp: { label: 'Lamp', fields: ['state', 'lumens', 'characteristic'] },
    supply: { label: 'Supply run', fields: ['crates', 'vessel', 'status'] },
    keeper: { label: 'Keeper', fields: ['watch', 'previousWatch', 'note'] },
  },
});

/**
 * Adopted through `@12-apps/wiring/consumer`, not by calling the factory.
 *
 * The manifest carries an AREA this page could never have stated for itself:
 * one admin route and its nav row, both gated on `AUDIT_READ_PERMISSION` — the
 * id the package's own core exports, so the suggestion cannot drift from the
 * gate its server half enforces. Calling `createWebAudit` directly leaves that
 * declaration on the floor, which is the drift this package wrote the estate's
 * definitive argument against.
 */
const { surface } = webWiringHost.adoptWeb({
  manifest: auditManifest,
  web: auditWebManifest,
  bindings: {
    surface: { config: { apiBase: '/api/admin/tenant-a', vocabulary: AUDIT_VOCABULARY } },
  },
});

const { page: AuditLogSurface } = surface as { page: () => JSX.Element };

export function AuditLogPage(): JSX.Element {
  return <AuditLogSurface />;
}
