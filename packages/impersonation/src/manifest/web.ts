/**
 * `@12-apps/impersonation/manifest/web` — the web capabilities.
 *
 * `surface.create` IS `createWebImpersonation`: the banner, the start dialog
 * (or `null` for an app that only ever WEARS sessions), and `startPreview` for
 * a host driving the start from its own picker.
 *
 * ## Why this manifest exists, and why its absence was the worst of the set
 *
 * This package's other three absences — no `db`, no `env`, no `permissions` —
 * are each narrowed IN WRITING in the shared manifest, and each is correct.
 * `web` was simply missing: not declared, not narrowed, not mentioned. That is
 * the one surface this package's own README calls mandatory, because the start
 * handshake REFUSES to begin a session in a document with no banner host. A
 * host adopting the server manifest and never learning the banner exists gets
 * a mount whose every start fails — the failure the capability is there to
 * prevent, on the capability that was left out.
 *
 * ## The banner is not a route, and the areas say so
 *
 * `banner` is per-DOCUMENT: mounted once in the app chrome, rendering nothing
 * when there is no session but STAYING MOUNTED, because unmounting it is
 * exactly what makes the next start refuse. No `AreaContribution` can express
 * "mount this in the shell" — areas are routed screens — so the banner is
 * carried by the surface alone and the constraint stays documented here and in
 * the README.
 *
 * What IS routed is the operator's start dialog, and only in the platform
 * area: choosing somebody to look through is an operator action, and a tenant
 * app that merely wears the session has no such screen. `screen: 'dialog'` is
 * the surface key, which a host with no `dialog` configured gets as `null` —
 * so a host projecting this row must be one that configured the dialog, which
 * is the same pairing the factory already enforces.
 */

import type { AnyWebManifest } from '@12-apps/wiring';

import { createWebImpersonation } from '../react/create-web-impersonation';

/** The OPERATOR surface: the banner plus the start dialog it gates. */
export const impersonationWebManifest = {
  name: '@12-apps/impersonation',
  surface: { create: createWebImpersonation },
  areas: [
    {
      area: 'super-admin',
      routes: [{ path: 'impersonate', screen: 'dialog' }],
      nav: [{ testId: 'impersonation-start', path: 'impersonate' }],
    },
  ],
} as const satisfies AnyWebManifest;

/**
 * The tenant PREVIEW surface: the same factory, the banner half only.
 *
 * A previewing tenant app mounts the banner so a session can start and be
 * ended; it never shows the operator's picker, which is why this manifest
 * declares `surface` and no `areas` at all. Two manifests rather than one for
 * the same reason the server half has two — the mounts differ in audience and
 * authority, and a single manifest could not express the difference.
 */
export const impersonationPreviewWebManifest = {
  name: '@12-apps/impersonation-preview',
  surface: { create: createWebImpersonation },
} as const satisfies AnyWebManifest;
