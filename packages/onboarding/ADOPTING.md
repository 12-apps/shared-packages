# Adopting @12-apps/onboarding

A **plug-and-play guided-onboarding plugin** (12-23): one library holding both
halves of the feature — the screens a user walks through, and the endpoints that
remember where they stopped. A host repo only *points* at these surfaces; when
the library updates, every host updates with **no app changes**. Same contract
`@12-apps/report-builder` and `@12-apps/rbac` established.

## The standardized plugin surfaces

| Surface | Export | What the host does |
|---|---|---|
| **React** | `@12-apps/onboarding` | `<OnboardingProvider featureKey store initialState>` + `useOnboarding()` + `<GuidedSection>`. Nothing to wire beyond the store below. |
| **Store** | `@12-apps/onboarding` | `createOnboardingApiStore({ apiBase, featureKey })` — the `OnboardingStore` bound to the package's OWN endpoints, plus `fetchOnboardingState(...)` for the first paint. A host with different persistence still writes its own store; the seam is unchanged. |
| **Server** | `@12-apps/onboarding/server` | `createApiOnboarding({ db })` and mount the `routes` it returns — `GET`/`PATCH /onboarding/:featureKey`, with parsing, statuses, the three operations and the `{ data }` envelope inside. Also returns the `repository`, for host surfaces reading the same table (the cross-tenant reach-out list). |
| **Hono** | `@12-apps/onboarding/hono` | `const onboarding = onboardingRouter({ db, resolveActor }); app.route('/api/admin/:tenantSlug', onboarding.router)`. A one-call mount; `hono` is an OPTIONAL peer, so importing the root or `/server` never resolves it. |
| **Prisma** | `prisma/onboarding.prisma` + `prisma/migrations/*` | `pnpm --filter @12-apps/onboarding prisma:sync -- <host schema dir>`: the partial is **COPIED** into the host's multi-file schema folder — never symlinked (a symlinked migration is silently skipped by Prisma; a symlinked partial dangles under `turbo prune`). Migrations are discovered structurally from the installed package's `prisma/migrations` by the host's plugin-migration sync. |

## Host wiring rules (the ones that bite)

1. **The host resolves WHO and WHERE.** `resolveActor` answers
   `{ userId, clientId }`, and that pair IS the isolation: the row's identity is
   `(userId, clientId, featureKey)`, so there is no tenant parameter on the wire
   for a caller to tamper with. `userId` must be the host's **DB user id** —
   the origin host resolves it by email, because `session.user.id` is the OAuth `sub`
   and not a users row.
2. **Authorization stays outside.** The origin host gates these routes with
   `requireTenantAdminBySlug` before delegating; the package never learns what a
   tenant admin is. A `resolveActor` that throws is the host's refusal (403/402)
   and the adapter lets it through untouched — only `null` is the packaged 401.
3. **Declare your feature keys.** `featureKeys: ['ai_integration', 'payments']`
   makes an undeclared key a 404. Omit it and any key is accepted (the origin host's
   original behaviour), which means a typo mints its own row and reads back as
   "no progress" forever.
4. **`reset` is DEV-only, and the host decides what dev means.**
   `resetEnabled: () => process.env.APP_ENV !== 'production'`; the default is
   `NODE_ENV !== 'production'`. A refused reset is a 403 with the pt-BR copy and
   the row untouched — never a half-delete.
5. **Duck-typed DB, never a generated client.** `db` is a lazy provider of the
   structural `OnboardingPrisma` seam — a Prisma client satisfies it directly
   (one cast); the harness satisfies it with hand-written SQL. The four delegate
   shapes are CLOSED (documented in `src/repository.ts`), so a non-Prisma host
   has a finite surface to fill.
6. **`GET` answers `{ data: null }` before any progress**, not 404. That is what
   `OnboardingProvider`'s `initialState` takes, and a 404 would make a first
   visit indistinguishable from a broken mount.
7. **Every user-facing string is pt-BR and overridable** through `messages` —
   product copy, not developer text, so it is never "translated" while tidying.

## The config, field by field

| Field | Required | Default | Notes |
|---|---|---|---|
| `db` | yes | — | lazy provider of the structural `OnboardingPrisma` seam |
| `featureKeys` | no | any key accepted | an undeclared key is 404 (see rule 3) |
| `resetEnabled` | no | `NODE_ENV !== 'production'` | the DEV-only reset gate |
| `messages` | no | pt-BR product copy | every user-facing string |
| `resolveActor` (hono) | yes | — | `{ userId, clientId }`; `null` → 401 |
| `unauthenticatedMessage` (hono) | no | `Não autenticado.` | the 401 body |

## The endpoints

Mounted under whatever prefix the host chooses (the origin host uses
`/api/admin/:tenantSlug`). Bodies are the house `{ data }` envelope.

| Method | Path | Answers |
|---|---|---|
| GET | `/onboarding/:featureKey` | `{ data: snapshot \| null }` — the caller's progress |
| PATCH | `/onboarding/:featureKey` | `{ data: snapshot }` for `{ op: 'save', status?, step?, data? }` (data is shallow-MERGED), `{ op: 'dismiss' }`, `{ op: 'reset' }`; 400 on an unknown op or a bad field, 403 on a refused reset, 404 on an undeclared feature |

## Minimal host (Hono)

```ts
import { onboardingRouter } from '@12-apps/onboarding/hono';
import type { OnboardingPrisma } from '@12-apps/onboarding/server';

const onboarding = onboardingRouter({
  db: async () => (await getPrismaClient()) as unknown as OnboardingPrisma,
  featureKeys: ['ai_integration', 'payments'],
  resolveActor: async (c) => {
    const { tenantId, grant } = await requireTenantAdminBySlug(c.req.param('tenantSlug'));
    const userId = grant.userId || (await requireSessionUser()).userId;
    return { userId, clientId: tenantId };
  },
});

app.route('/api/admin/:tenantSlug', onboarding.router);
```

## Minimal host (React)

```tsx
import {
  OnboardingProvider,
  createOnboardingApiStore,
  fetchOnboardingState,
} from '@12-apps/onboarding';

const apiBase = `/api/admin/${tenantSlug}`;
const store = createOnboardingApiStore({ apiBase, featureKey: 'ai_integration' });
const initialState = await fetchOnboardingState({ apiBase, featureKey: 'ai_integration' });

<OnboardingProvider featureKey="ai_integration" store={store} initialState={initialState}>
  <GuidedSection … />
</OnboardingProvider>
```

## Phase B — adopting into a host that ALREADY has the table (the origin host)

**Nothing to baseline.** Every statement in the package migration is guarded
(`CREATE TABLE IF NOT EXISTS`, `CREATE [UNIQUE] INDEX IF NOT EXISTS`, and a
conrelid-scoped `DO` block for the status CHECK, which has no `IF NOT EXISTS`
form), so applying it to a host that already has `onboarding_states` changes
nothing and exits 0 — no `prisma migrate resolve --applied` step, and no risk of
a green deploy that skipped a schema change. The columns, defaults, indexes and
the CHECK are the origin host's `20260715180000_add_onboarding_state_mcp_connection`
verbatim.

Two deliberate deltas to reconcile:

- **The FKs to `users` / `clients` are not in the package migration.** They are
  host vocabulary — this package cannot know the name of a host's user or tenant
  table. The origin host keeps its own `ON DELETE CASCADE` constraints; they are
  compatible with everything the package writes.
- **`mcp_connections` is not here.** The origin host's migration created both tables;
  the MCP half belongs to `@12-apps/mcp` and ships in its folder (12-23).

Then delete the host's own copies: the two route files, the onboarding schema
module, the repository binding, and `apps/admin/src/shared/onboarding-store.ts`
(replaced by `createOnboardingApiStore`).

## What deliberately did NOT move into the package

- **The superadmin funnel** (`GET /api/platform/onboarding`) — a cross-tenant,
  paginated platform view whose auth and pagination conventions are the host's.
  `repository.listOnboardingByStatus` is the per-tenant half it is built on.
- **Which features are guided, and their steps** — `GuidedStep[]` is content the
  host composes; the package renders it.
- **Server actions.** The origin host had both an action pair and these routes; only
  the REST surface moved, because an action is a framework's calling convention
  rather than part of this contract.
