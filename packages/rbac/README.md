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
| `@12-apps/rbac` | core + governance + Future Pay templates (data) |
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
import { validateGrant, FUTURE_PAY_GOVERNANCE } from '@12-apps/rbac';

const verdict = validateGrant({
  granterPermissions: myPermissions, // the granter's ceiling ('*' allowed)
  roleBeingGranted: 'MANAGER',        // a catalog role name or an inline RoleDef
  targetScope: { isLeaf: true },      // leaf (restaurant) vs org/parent
  catalog: FUTURE_PAY_GOVERNANCE,
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

## Future Pay templates (data, not core)

`FUTURE_PAY_PERMISSIONS`, `DEFAULT_ROLE_TEMPLATES` (OWNER, ADMIN, MANAGER, WAITER,
CHEF, FINANCIAL, BUYER, SUPERADMIN), `FUTURE_PAY_GOVERNANCE`,
`FUTURE_PAY_SOD_PAIRS`, `FUTURE_PAY_LEAF_ONLY_ROLES`, and `CLIENT_CAPABILITIES`
ship as importable data. `CLIENT_CAPABILITIES` is a **population capability set**
(`products:read:published`, `orders:read:own`, `orders:create`) — what a
logged-in customer can do — applied by capability, **never** as a staff role
assignment. A different host imports none of this and supplies its own.

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

The same core powers a completely different domain — no Future Pay concept leaks
in, and an OpenFGA adapter could replace the default engine without touching any
of this. This is not just prose: `src/__tests__/portability.test.ts` is the
RUNNABLE version of this host — its own catalog, roles, scope chain, ownership,
temporal review assignments and governance policy, exercised end-to-end with
zero imports from the Future Pay templates:

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
