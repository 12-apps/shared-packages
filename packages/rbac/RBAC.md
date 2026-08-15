# Adopting `@12-apps/rbac` in another project

A step-by-step **integration playbook**. For the API reference (adapter seams,
`definePermissions`, caveats, scope-walk, governance, React) see
[`README.md`](./README.md); this doc is the "how do I wire it into my app, my DB,
and my CI" guide.

The library is **framework-free, DB-free and application-free**. You supply four
things — a permission catalog, role definitions, a `resolver` that maps an actor
id to their role assignments, and (optionally) the entity gate — and you get
point/list authorization plus a governance validator. Nothing about the host app
leaks into the core, and the package ships no application's catalog: it declares
only the three permissions guarding its own roles/team surface
(`RBAC_PERMISSIONS`) and you COMPOSE yours with them.

---

## 1. Declare your domain's permission contribution

Model every guarded capability as a permission string carrying everything true
about it: whether it is **class** (RBAC alone decides) or **instance** (RBAC
first, then an entity gate — ownership / assignment / caveat), whether it is an
owner marker, which permissions it may never share a role with, and how it
reads on screen.

```ts
// lib/authz/permissions.ts
import { definePermissionContribution } from "@12-apps/rbac";

export const SHOP_PERMISSIONS = definePermissionContribution({
  source: "shop",                            // named in composition errors
  permissions: {
    "products:write": { kind: "class" },
    "orders:read:all": { kind: "class" },
    "orders:read:own": { kind: "instance" },  // a buyer sees only their own
    "purchasing:write": { kind: "class" },
    "purchasing:approve": {
      kind: "class",
      separateFrom: ["purchasing:write"],     // separation of duties
    },
    "payouts:manage": { kind: "class", ownerMarker: true },
  },
  labels: {
    domains: { products: "Produtos", orders: "Pedidos" },
    actions: { write: "Editar", read: "Ver", approve: "Aprovar" },
    scopes: { own: "próprios", all: "todos" },
  },
});
```

Rules of thumb:
- A permission string is a wire to a **code gate**. Custom roles can only
  *compose* existing permissions — they can't invent new strings.
- `instance` permissions require you to also provide `ownership` and/or
  `assignmentResolver` when building the engine (step 3).
- Declare a permission where the surface it guards lives. If another package
  owns the screen, that package owns the id and exports its own contribution.

## 2. Compose the catalog and bind your role policy

Roles are **data**, and they are always the HOST's — no package can know your
role matrix. `composePermissions` unions every source's ids (keeping the literal
union), and `withRoles` binds the role half.

```ts
// lib/authz/catalog.ts
import {
  composePermissions,
  RBAC_PERMISSIONS,
  type PermissionOf,
  type RoleDef,
} from "@12-apps/rbac";
import { LIFECYCLE_PERMISSIONS } from "@12-apps/entity-lifecycle";
import { SHOP_PERMISSIONS } from "./permissions";

const PERMISSIONS = composePermissions(
  RBAC_PERMISSIONS,        // the packaged roles/team surface's own three ids
  LIFECYCLE_PERMISSIONS,   // another package's surfaces
  SHOP_PERMISSIONS,        // your domain
);

export type AppPermission = PermissionOf<typeof PERMISSIONS>;

const ROLE_TEMPLATES: readonly RoleDef<AppPermission>[] = [
  { name: "OWNER", permissions: "*" },
  { name: "MANAGER", permissions: ["products:write", "orders:read:all"] },
  { name: "STAFF", permissions: ["orders:read:own"] },
];

export const CATALOG = PERMISSIONS.withRoles({
  roles: ROLE_TEMPLATES,
  ownerRoles: ["OWNER"],            // never grantable via a custom role
  leafOnlyRoles: ["MANAGER"],       // assignable only at a leaf scope
  platformOnlyRoles: [],            // never seeded per tenant
  roleLabels: { OWNER: "Proprietário" },
});
```

`CATALOG` carries the registry, the templates, the governance catalog, the
per-tenant seed rows and the merged labels. It is the single `catalog` field
`createApiRbac`, `rbacRouter` and `createWebRbac` take — one object rather than
four, so the screen and the endpoints can never be governed by different
policies. Owner markers and SoD pairs come from the contributions, so a package
that owns an approval gate ships its own duty pair rather than asking every host
to remember it.

Composition throws `RbacCatalogError` on a duplicated id (naming both sources),
a spec that does not declare a valid `kind` / `ownerMarker` / `separateFrom`, an
SoD counterpart nothing contributes, a role granting an unknown id, or a policy
naming an unknown role.

## 3. Build the engine (the DB seam)

The engine is a **module singleton**. The only app-specific part is `resolver`:
map your DB `users.id` to `RoleAssignment[]`. Typically two sources unioned — a
per-tenant membership table and a free-form role-assignment table.

```ts
// lib/authz/rbac.ts
import { createRbac, type RoleAssignment } from "@12-apps/rbac";
import { CATALOG, type AppPermission } from "./catalog";
import { db } from "../db";

async function resolver(actorId: string): Promise<RoleAssignment[]> {
  const [memberships, grants] = await Promise.all([
    db.membership.findMany({ where: { userId: actorId }, select: { role: true, clientId: true } }),
    db.roleAssignment.findMany({ where: { userId: actorId }, select: { roleName: true, scope: true } }),
  ]);
  return [
    ...memberships.map((m) => ({ role: m.role, scope: m.clientId })),
    ...grants.map((g) => ({ role: g.roleName, scope: g.scope })),
  ];
}

export const rbac = createRbac<AppPermission>({
  permissions: CATALOG.permissions,
  roles: CATALOG.roleTemplates,
  resolver,
  globalScope: "GLOBAL",   // a grant here satisfies any requested scope (superadmin)
  // scopeParent, ownership, assignmentResolver — see README for the entity gate
});
```

> **Env-allowlist superadmin.** If you have platform admins identified by email
> (no DB row), check that at the **actor layer** (in your guard wrapper), *before*
> calling the engine — not in the resolver.

## 4. Wrap guards for your routes / actions / components

Put one thin wrapper around the engine that resolves "the current request's actor"
and delegates. Every server action, route handler, and page uses it.

```ts
// lib/authz/guards.ts
import { PermissionDeniedError } from "@12-apps/rbac";
import { rbac } from "./rbac";

export async function requirePermission(action: AppPermission, opts: { scope: string; resource?: string | null }) {
  const actor = await resolveRequestActor();          // your session → DB user id + isSuper
  if (actor.isSuper) return;                           // allowlisted platform admin
  if (!actor.userId) throw new ForbiddenError();
  try {
    await rbac.requirePermission(actor.userId, action, opts.resource ?? null, { scope: opts.scope });
  } catch (e) {
    if (e instanceof PermissionDeniedError) throw new ForbiddenError();
    throw e;
  }
}
```

React: resolve the permission set **server-side** for the current scope and pass
it to `RbacProvider`; the client uses `useCan` / `<Can>` (see README). Filter your
nav server-side by the same permissions so hidden pages never render.

---

## 5. CI enforcement — fail the build on an unprotected surface

The load-bearing safety net: a static gate that walks every route handler and
every server action and fails CI (and pre-commit) unless each one **calls an
accepted guard** or is listed, with a reason, in a human-owned exclusions file.

Pattern (see `apps/web/scripts/rbac/` in this repo for a reference implementation):

1. **Enumerate the guard identifiers** that count as "protected" (your
   `requirePermission`, tenant-permission guards, etc.).
2. **Walk the surfaces** — `app/api/**/route.ts` HTTP exports and
   `**/*actions.ts` server actions.
3. **Attribute guards per exported symbol, not per file.** A file-level check lets
   a new *unguarded* action piggyback on a guarded sibling. Compute the transitive
   set of top-level symbols that reach a guard (directly, or via a local helper /
   wrapper) and require each exported action's own symbol to be in it.
4. **Strip comments/strings before matching** so a guard named only in a `// TODO`
   or a string literal never satisfies the gate.
5. **Exclusions live in one protected file** with a per-entry reason (storefront /
   auth / webhook / infra routes that are legitimately public). Adding an entry
   should require a human review step.
6. Wire it into pre-commit and a CI job; block merges on it.

This is what makes "a new privileged endpoint can't ship unauthenticated" a
mechanical guarantee rather than a review hope.

---

## 6. DB-persisted **custom roles** (optional, advanced)

Templates are compiled-in. To let tenants compose their **own** roles at runtime:

**Schema** — a `Role` table: `(clientId nullable, name, permissions TEXT, isTemplate)`,
unique per `(clientId, name)`. `permissions` is `'*'` or a JSON array of permission
strings. `clientId = NULL` marks a global template row; a non-null `clientId` is a
tenant-owned custom role.

**Engine change (already in the library):** `RoleAssignment` carries an optional
`permissions` field. When present, `canWith`/`permissionsFor` expand it **inline**
instead of looking the role name up in the template index — so a role name absent
from the templates still grants. Backward-compatible: omit `permissions` and you
get today's template-by-name behavior.

**Resolver wiring:** for each assignment whose `(scope, roleName)` matches a tenant
`Role` row, emit the assignment **with** `permissions` (parsed from the row);
otherwise emit just the name (template path). A tenant row overrides a same-named
template at that tenant. Keep the template path DB-free — only look up non-template
names.

```ts
const custom = await getTenantRolesByName(tenantScopedAssignments); // (clientId,name) -> perms
const fromAssignments = grants.map((g) => {
  const perms = custom.get(key(g.scope, g.roleName));
  return perms ? { role: g.roleName, scope: g.scope, permissions: perms }
               : { role: g.roleName, scope: g.scope };
});
```

**Governance still applies:** validate a custom role's *composed permission set*
(not just a name) with `validateGrant` passing an inline `RoleDef` — so a store
admin can only compose from permissions they themselves hold (no escalation),
can't include an owner-marker permission, and can't bundle an SoD pair.

## 7. A roles admin panel + assigning custom roles to members

- **Create/edit a role** → `validateGrant({ roleBeingGranted: { name, permissions }, ... })`
  before writing the `Role` row. Build the permission-picker UI from
  `CATALOG.permissions.list`, grouped by domain, disabling owner-marker perms and
  the SoD counterpart of any selected permission (or mount the packaged
  `createWebRbac` surface, which already does both).
- **Assign a role to a member.** ⚠️ **Gotcha:** if your membership table pins the
  base role with a DB CHECK constraint (a fixed template enum), a custom role name
  **cannot** be stored there. Grant it as an **additive `RoleAssignment`**
  (`roleName` + `scope = clientId`) instead — a member keeps one base template role
  **plus** zero-or-more custom roles. When you change the base role, clear only the
  **legacy template-named** assignments and preserve the custom ones; when you
  **remove** a member, clear all their tenant-scoped assignments in the same
  transaction so nothing dangles and re-activates on re-invite.
- Gate the whole roles surface (panel, routes, actions, member-assignment) on a
  single owner-marker permission (`roles:manage`). Enforce it on the **page** too
  (not just the nav filter), since a URL is reachable directly.

## 8. Testing

Test the real path against a real engine, not mocks:

- **Unit** — the pure core: `canWith` / `permissionsFor` / `validateGrant` matrices
  (the library ships these; mirror them for your catalog).
- **Integration** — boot an in-process Postgres (e.g. PGlite), replay your
  migrations, point the singleton at it, stub the session, and assert
  `requirePermission` / `getPermissions` reflect exactly the granted set — including
  a custom-role holder getting *exactly* its permissions and the same assignment
  with no backing row granting **nothing** (proves the inline expansion is
  load-bearing).

---

## Gotchas checklist

- [ ] `session.user.id` is usually the **OAuth subject**, not your `users.id` —
      resolve the DB user by email for anything keyed to `users.id`.
- [ ] **Missing ABAC context denies.** A caveat that can't find its data returns
      `false`; never silent-allow.
- [ ] The **entity gate is only for instance permissions**; assignment is a
      *relation* (many ids), and the host does the temporal filtering.
- [ ] `globalScope` grants satisfy any scope — reserve it for platform admins.
- [ ] Custom roles compose **existing** permissions only; they can't mint new
      strings (those are wired to code gates).
- [ ] The coverage gate must attribute guards **per exported symbol** and strip
      comments/strings, or unguarded surfaces slip through.
- [ ] A membership-role **CHECK constraint** means custom roles ride on
      `RoleAssignment`, not the membership row.
