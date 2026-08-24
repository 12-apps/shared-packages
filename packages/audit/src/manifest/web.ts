/**
 * `@12-apps/audit/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebAudit`: the trail with its filter bar, and the
 * same screen with filter state LIFTED for a host that mirrors filters into
 * its own router's URL (which a package cannot do for it). Built once per
 * adoption by the consumer's binder — the members are component TYPES.
 *
 * ## Why this manifest exists now
 *
 * This package wrote the estate's definitive argument against undeclared
 * contributions: that structural discovery — a host finding a capability by
 * scanning rather than by being told — is the exact drift the contract exists
 * to prevent, and that a package's models reach a database because it SAID so.
 * `./react` then shipped `create-web-audit.tsx`, a real `createWeb*` factory,
 * with no `manifest/web` and, unlike this package's other absences, no written
 * narrowing anywhere. The argument and the omission were in the same package.
 *
 * ## The area
 *
 * One admin route, gated on `AUDIT_READ_PERMISSION` — the constant the core
 * already exports, referenced rather than retyped, so the manifest cannot
 * drift from the gate the server half enforces. It is an id this package
 * itself owns, so a host projecting it is mapping something it already
 * received rather than being handed vocabulary a package guessed at. The trail
 * names who did what, so it is not a screen to leave ungated.
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createWebAudit } from '../react/create-web-audit';
import { AUDIT_READ_PERMISSION } from '../core/permissions';

export const auditWebManifest = {
  name: '@12-apps/audit',
  surface: { create: createWebAudit },
  areas: [
    {
      area: 'admin',
      routes: [{ path: 'audit', screen: 'page', permission: AUDIT_READ_PERMISSION }],
      nav: [{ testId: 'audit-log', path: 'audit', permission: AUDIT_READ_PERMISSION }],
    },
  ],
} as const satisfies AnyWebManifest;
