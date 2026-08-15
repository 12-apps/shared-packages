# @12-apps/rbac

Generic, portable, **engine-agnostic** authorization. A framework-free core plus
optional React and framework-neutral server adapters. **Zero app coupling**: the
core knows nothing about Future Pay — permissions, roles, scopes and actors are
all host-supplied data.

> **Adopting this in another project?** This README is the API reference. See
> **[`RBAC.md`](./RBAC.md)** for the step-by-step integration playbook — DB
> resolver, guards, the CI coverage gate, DB-persisted custom roles, and the roles
> admin panel + member-assignment patterns (with the gotchas).

## Subpath exports

| Import | Contents |
| --- | --- |
| `@12-apps/rbac` | core + composition (`composePermissions`) + governance + this package's own `RBAC_PERMISSIONS` |
| `@12-apps/rbac/react` | `RbacProvider`, `useCan`, `<Can>` |
| `@12-apps/rbac/next` | `createRbacGuards` (framework-neutral server guards) |

The exports map points at `./src` directly — no build step is required at
runtime.

## The two seams behind a swappable PDP

All authorization goes through a **Policy Decision Point** — the `AuthzAdapter`
interface — with exactly two seams. Call sites use `can()` and
`visibleResources()` **only**; they never know which engine answers.

```ts
interface AuthzAdapter {
  // POINT seam: may this subject do this action to this exact resource?
  check(subject, action, resource: string | null, context): boolean | Promise<boolean>;
  // LIST seam: which instances of resourceType may this subject act on?
  visible(subject, action, resourceType, context): VisibleResult | Promise<VisibleResult>;
}

type VisibleResult =
  | { kind: 'all' }                       // hold the class permission
  | { kind: 'none' }                      // denied
  | { kind: 'ids'; ids: string[] }        // exactly these instances
  | { kind: 'predicate'; predicate: unknown }; // host turns this into a WHERE clause
```

- `check` answers **point** decisions (a specific row, or a class action when
  `resource` is `null`).
- `visible` is the **list** seam — never fetch-then-filter. Ask the PDP what is
  visible, then push `all` / `none` / `ids` / `predicate` down into your query.

### Default adapter (SQL / in-process)

Ships built-in. It is the classic roles-as-data engine plus the entity gate:

- **Class permission** → RBAC alone decides. `visible` = `all` when held.
- **Instance permission** → RBAC gate **then** an entity gate: ownership OR the
  assignment relation OR a caveat. `visible` = the union as `ids` / `predicate`.

### Swapping in OpenFGA (later)

An OpenFGA adapter implements the **same** `AuthzAdapter`:
`check` → the FGA `Check` RPC, `visible` → `ListObjects`. Pass it as
`config.adapter` and every call site keeps working unchanged.

```ts
createRbac({ ...config, adapter: myOpenFgaAdapter });
```

## Class vs instance permissions

Declare permissions with `definePermissions`. Either the backward-compatible
string tuple (everything defaults to `'class'`) or an **object map** that flags
each permission's scope-kind:

```ts
import { definePermissions } from '@12-apps/rbac';

const PERMISSIONS = definePermissions({
  'products:write': 'class',       // RBAC alone
  'orders:read:own': 'instance',   // RBAC gate THEN entity gate
} as const);

PERMISSIONS.kind('orders:read:own'); // 'instance'
PERMISSIONS.kind('products:write');  // 'class'
PERMISSIONS.kind('unknown');         // 'class' (default)
```

## Roles as data (with caveats)

```ts
const ROLES: readonly RoleDef<AppPermission>[] = [
  { name: 'OWNER', permissions: '*' },
  { name: 'STAFF', permissions: ['products:read:all', 'orders:create'] },
  {
    name: 'JUNIOR_FINANCE',
    permissions: [
      // ABAC caveat: refunds only under a threshold in the host context
      { permission: 'orders:refund', caveat: (ctx) => Number(ctx.amount) < 100 },
    ],
  },
];
```

`'*'` grants everything. `inherits: ['OTHER']` unions another role's permissions
(recursively, cycle-guarded).

## ABAC caveats + context

A role-permission entry may carry a `caveat: (context) => boolean`. The
class/instance gate additionally requires the caveat to pass. `context` is
host-populated and threaded through `can()` / `visibleResources()` (as the last
argument). **Missing context denies** — a caveat that cannot find the data it
needs must return `false`; there is no silent allow.

```ts
await rbac.can(userId, 'orders:refund', orderId, { scope: tenantId, amount: 50 });  // true
await rbac.can(userId, 'orders:refund', orderId, { scope: tenantId, amount: 500 }); // false
await rbac.can(userId, 'orders:refund', orderId, { scope: tenantId });              // false (no amount)
```

The three condition shapes the design names ship as ready-made factories
(`src/core/caveats.ts`), each denying on missing/mistyped context:

```ts
import { amountAtMost, withinShift, notExpired, allOf } from '@12-apps/rbac';

{ permission: 'orders:refund', caveat: amountAtMost(5000) }        // comp/refund cap
{ permission: 'payments:take', caveat: withinShift() }             // ctx.onShift === true
{ permission: 'config:write',  caveat: notExpired() }              // time-boxed elevation
{ permission: 'orders:refund', caveat: allOf(amountAtMost(5000), notExpired()) }
```

`isActiveAssignment({ validFrom, validTo }, now)` is the in-process mirror of
the SQL temporal predicate (`valid_to IS NULL OR valid_to > now()`) for
in-memory hosts, resolvers and tests.

## Scope parent-walk (chains)

Multi-level scopes (org → restaurant) are supported via `scopeParent`. A grant at
a **parent** scope satisfies checks at any descendant; a child grant never
reaches the parent or a sibling. The walk is cycle-guarded.

```ts
createRbac({
  ...config,
  scopeParent: (scope) => parentOf[scope] ?? null, // return null at the root
});
// OWNER@org-1 can config:write on restaurant-1 (child)   -> true
// OWNER@restaurant-1 cannot reach org-1 (parent)          -> false
```

## Create the engine

```ts
import { createRbac } from '@12-apps/rbac';

export const rbac = createRbac<AppPermission>({
  permissions: PERMISSIONS,
  roles: ROLES,
  resolver,                 // actorId -> RoleAssignment[]
  globalScope: 'GLOBAL',    // assignments here satisfy any scope
  scopeParent,              // optional: org -> restaurant chains
  ownership,                // optional entity gate: (subject, type) -> OwnershipPredicate | null
  assignmentResolver,       // optional entity gate: (subject, type, ctx) -> string[] (the RELATION)
  adapter,                  // optional: swap in OpenFGA etc.
});

// converged call sites:
await rbac.can(userId, 'products:write', null, { scope: tenantId });        // Promise<boolean>
await rbac.can(userId, 'orders:read:own', orderId, { scope: tenantId });    // instance point check
await rbac.visibleResources(userId, 'orders:read:own', 'orders', { scope: tenantId }); // LIST seam
await rbac.requirePermission(userId, 'orders:void', orderId, { scope: tenantId });      // throws
```

The **entity gate** (`ownership` + `assignmentResolver`) is only consulted for
instance permissions. Assignment is always a **relation** (many ids), never a
single column, and the host temporal-filters it. Composition: an instance check
passes iff RBAC grants the action **and** (ownership holds **or** the id is in
the assignment set **or** a caveat passes).

## Governance validator

`validateGrant` is a **pure, framework-free** guard on the role-administration
surface (who may create/assign which role, at which scope). It is NOT an
authorization check — it decides whether a grant is *allowed to be made*.

```ts
import { validateGrant } from '@12-apps/rbac';

const verdict = validateGrant({
  granterPermissions: myPermissions, // the granter's ceiling ('*' allowed)
  roleBeingGranted: 'MANAGER',        // a catalog role name or an inline RoleDef
  targetScope: { isLeaf: true },      // leaf (a single site) vs org/parent
  catalog: CATALOG.governance,        // from your composed catalog (see above)
});
// { ok: true } | { ok: false, reason: 'ESCALATION: ...' }
```

Enforced rules (stable `reason` prefixes):

- **`OWNER_PROTECTED`** — owner roles / owner-marker permissions / wildcard roles
  are never grantable via a custom role.
- **`ESCALATION`** — the granter may only grant permissions they hold.
- **`SCOPE_CEILING`** — leaf-only roles and instance permissions may only be
  assigned at a leaf scope, never at an org/parent scope.
- **`SEPARATION_OF_DUTIES`** — no single role may hold both halves of a
  configured mutually-exclusive pair (e.g. `purchasing:write` +
  `purchasing:approve`).

## Composing a catalog (the host is the assembler)

The package ships **no application catalog**. It declares the three permissions
guarding its own screens and endpoints — `roles:manage`, `team:read`,
`team:manage`, exported as `RBAC_PERMISSIONS` — and a host composes those with
every other owner's contribution.

```ts
import {
  composePermissions,
  definePermissionContribution,
  RBAC_PERMISSIONS,
  type PermissionOf,
} from '@12-apps/rbac';
import { LIFECYCLE_PERMISSIONS } from '@12-apps/entity-lifecycle';

/** Your domain declares its own ids, with everything true about each. */
export const SHOP_PERMISSIONS = definePermissionContribution({
  source: 'shop',
  permissions: {
    'products:write': { kind: 'class' },
    'orders:read:own': { kind: 'instance' },
    'payouts:manage': { kind: 'class', ownerMarker: true },
  },
  labels: { domains: { products: 'Produtos' }, actions: { write: 'Editar' } },
});

export const CATALOG = composePermissions(
  RBAC_PERMISSIONS,        // this package's own surfaces
  LIFECYCLE_PERMISSIONS,   // another package's surfaces
  SHOP_PERMISSIONS,        // your domain
).withRoles({
  roles: SHOP_ROLES,       // typed against the composed union
  ownerRoles: ['OWNER'],
  leafOnlyRoles: ['MANAGER'],
  platformOnlyRoles: ['SUPERADMIN'],
  roleLabels: { OWNER: 'Proprietário' },
});

/** The union your guards are checked against — it survives composition. */
export type ShopPermission = PermissionOf<typeof CATALOG>;
```

`CATALOG` is the ONE object `createApiRbac` / `createWebRbac` take. It carries
the registry, the role templates, the governance catalog, the per-tenant seed
rows and the merged labels, so a host cannot wire the registry from one place
and the governance from another and have them disagree.

**A contribution is one coherent unit.** Each id travels with its scope-kind
(`class` / `instance`), its owner-marker flag, its separation-of-duties
counterparts and its label. An id registered without its scope-kind resolves to
`class` and skips the entity gate — the half-wiring that fails open — so there
is no shape of the declaration that omits it. The TYPE says that where a catalog
is written; composition says it again at assembly, because a catalog that is
generated, read from config or parsed from JSON crosses that boundary exactly
once. A spec whose `kind` is not `class`/`instance`, whose `ownerMarker` is not
a boolean, or whose `separateFrom` is not a list of ids throws an
`RbacCatalogError` (`INVALID_PERMISSION_SPEC`) naming the id and its source.

**Collisions are loud.** Two sources contributing the same id throw an
`RbacCatalogError` (`PERMISSION_COLLISION`) naming both, in either order. There
is no last-write-wins: a silent overwrite is how one package's `instance`
becomes another's `class`. Composition also refuses an SoD counterpart nothing
contributes, a role granting an unknown id, and a policy naming an unknown role.

**A pair may span sources.** `separateFrom` is resolved against the whole
assembled catalog, so an approvals package can declare
`'products:approve': { separateFrom: ['products:write'] }` without owning
`products:write`.

## Server guards

```ts
import { createRbacGuards } from '@12-apps/rbac/next';
import { PermissionDeniedError } from '@12-apps/rbac';

const guards = createRbacGuards(rbac, async () => (await auth())?.user?.id ?? null);

export async function refundOrder(tenantId: string) {
  try {
    await guards.requirePermission('orders:refund', tenantId);
  } catch (e) {
    if (e instanceof PermissionDeniedError) return { status: 403 };
    throw e;
  }
  // ...perform the refund
}
```

## React: `useCan` / `<Can>`

The provider takes an **already-resolved** permission set (resolve it
server-side for the current scope and pass it down). The client never touches
the resolver or DB.

```tsx
import { RbacProvider, useCan, Can } from '@12-apps/rbac/react';

const permissions = await rbac.getPermissions(userId, tenantId);

<RbacProvider permissions={permissions}>
  <Can permission="orders:refund" fallback={null}>
    <RefundButton />
  </Can>
</RbacProvider>;
```

## Portability: a toy second host (a blog)

The same core powers a completely different domain, and an OpenFGA adapter
could replace the default engine without touching any of this. Not just prose:
`src/__tests__/portability.test.ts` is the RUNNABLE version of this host — its
own catalog, roles, scope chain, ownership, temporal review assignments and
governance policy — plus the tripwire that asserts what the PACKAGE contains,
which is what "portable" used to mean here and did not check:

```ts
import { definePermissions, createRbac, type RoleDef } from '@12-apps/rbac';

const BLOG = definePermissions({
  'posts:read': 'class',
  'posts:write:own': 'instance', // authors edit only their own drafts
  'posts:publish': 'class',
} as const);
type BlogPerm = (typeof BLOG.list)[number];

const ROLES: readonly RoleDef<BlogPerm>[] = [
  { name: 'READER', permissions: ['posts:read'] },
  { name: 'AUTHOR', permissions: ['posts:read', 'posts:write:own'] },
  { name: 'EDITOR', permissions: '*' },
];

const blogRbac = createRbac<BlogPerm>({
  permissions: BLOG,
  roles: ROLES,
  resolver: () => [{ role: 'AUTHOR', scope: 'blog-1' }],
  ownership: (subject, type) =>
    type === 'posts' ? { kind: 'predicate', test: (id) => id.startsWith(subject) } : null,
});

await blogRbac.can('u1', 'posts:read', null, { scope: 'blog-1' });        // true (class)
await blogRbac.can('u1', 'posts:write:own', 'u1-draft', { scope: 'blog-1' }); // true (owns it)
await blogRbac.can('u1', 'posts:write:own', 'u2-draft', { scope: 'blog-1' }); // false (not owner)
await blogRbac.can('u1', 'posts:publish', null, { scope: 'blog-1' });     // false (author lacks it)
```
