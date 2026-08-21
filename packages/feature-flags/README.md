# @12-apps/feature-flags

User-level feature flags: a superadmin grants a feature in beta to individual
**people** — an owner and a couple of users — and only they see it.

## The one rule: a flag is a veil, never a key

A flag composes by **AND** over every axis the host already has. It can only
*narrow* visibility; it never turns on a feature that the tenant's plan,
lifecycle status, own settings or RBAC turn off. Two consequences:

- **Grants are user-global and safe to be.** The grant follows the person, and
  in a store whose tenant axes deny the feature, the grant lights nothing —
  which is exactly why no per-tenant grant column is needed.
- **The veil fails CLOSED.** A flag that is absent, stale or failed-to-load
  hides the feature. This is the *opposite* of the entitlements degradation
  rule (absent ⇒ unlocked), and deliberately so: a stale client must never
  paywall an owned feature, and must never leak an unreleased one.

In the origin host the server-side order is `401 auth → 403 RBAC → flag veil →
402 entitlements` — the veil sits before the entitlement stack so nobody is
upsold a feature that is not purchasable yet.

## What lives where

- **Grants** live in the database: `user_feature_grants`, one row per
  (user, flag), no row = the flag's default (off), `enabled: false` = an
  explicit opt-out that survives a future default-on rollout. `user_id` is a
  by-value scalar — no FK into host tables (the payments-backend doctrine).
- **The catalog** is HOST CODE, handed in as config. A flag with no code
  behind it does nothing — every flag ships with a deploy anyway. A grant
  whose key left the catalog is an **orphan**: reported by the management
  surface, invisible to the reader.
- **Every word is the host's.** The screen's `copy` (`FeatureFlagsCopy`) and
  the routes' denial sentences (`FeatureFlagsServerCopy`) are REQUIRED config
  with no defaults — the package ships no silent language, and server
  assembly fails naming every missing key. pt-BR still ships, as NAMED packs
  (`PT_BR_FEATURE_FLAGS_COPY` from `./react`,
  `PT_BR_FEATURE_FLAGS_SERVER_COPY` from `./server`): a host imports one and
  passes it by hand, so choosing the language is a reviewable line. The
  machine `error` codes (`unknown_flag`, `user_not_found`, …) are the stable
  half a client may branch on; the sentences beside them are the host's.

## Surfaces

| subpath | export | what it is |
|---|---|---|
| `.` | `createFlagReader` | the enforcement half — `flagsFor(userId)` for host gates |
| `./server` | `createApiFeatureFlags` | six framework-neutral route descriptors (WireRoute-shaped) for the superadmin management surface |
| `./react` | `createWebFeatureFlags` | the management screen, `{ page }` |
| `./manifest`, `./manifest/server`, `./manifest/web` | wiring manifests | adopt through `@12-apps/wiring/consumer` |

Deliberate absences in the manifest: **no `mcp`** (the surface is browser-only
— a superadmin bearer already inherits cross-tenant reach over shared tools)
and **no `permissions`** (platform authority in the origin host is an env
allowlist no permission id can express).

## Adoption sketch (server)

```ts
import { createWiringHost } from '@12-apps/wiring/consumer';
import { featureFlagsManifest } from '@12-apps/feature-flags/manifest';
import { featureFlagsServerManifest } from '@12-apps/feature-flags/manifest/server';

const host = createWiringHost({ name: 'my-host', kind: 'server' });
host.adoptServer({
  manifest: featureFlagsManifest,
  server: featureFlagsServerManifest,
  bindings: {
    http: {
      mountPath: '/api/platform/feature-flags',
      // `copy` is every denial sentence — required; pass a named pack or
      // your own object.
      config: { db, catalog, directory, copy, audit },
    },
  },
});
const wired = host.assemble();
```

The host resolves the actor (its superadmin guard) before any handler runs;
the actor is `{ email }` — the audit identity, not an authorization input.
Route order is load-bearing for an in-order dispatcher (`/users/:userId`
before `/:key/…`), and `assertCatalog` refuses a flag named `users` so the
static segment can never be swallowed.

## Prisma

`prisma/feature-flags.prisma` is copied — never symlinked — into the host's
schema folder by `pnpm --filter @12-apps/feature-flags prisma:sync`
(`--check` gates drift). Migrations are discovered structurally by the host's
plugin sync from `prisma/migrations/`.
