/**
 * THIS PACKAGE'S OWN PERMISSION ID.
 *
 * `@12-apps/audit` ships an endpoint and a screen of its own — the tenant's
 * trail and the actor options behind its filter — so it owns the permission
 * that gates them, and exports it rather than making every host invent the
 * string. The rule is the one `@12-apps/rbac` states for its own three ids: a
 * permission belongs to whoever owns the surface it guards. An id gating a HOST
 * feature is the host's and never arrives from here.
 *
 * Declared in the framework-free core so there is exactly ONE definition: the
 * server's `DEFAULT_GATE_PERMISSIONS` reads it, the root entry re-exports it for
 * a host composing its RBAC catalog offline, and neither is a second copy.
 *
 * Deliberately a plain constant rather than an `@12-apps/rbac` contribution:
 * making the audit package depend on the RBAC package to state one string would
 * pull a router, a React surface and a Next adapter into every tree that wanted
 * only the writer. A host that uses `@12-apps/rbac` wraps it at composition
 * time — `definePermissionContribution({ source: '@12-apps/audit', permissions:
 * { [AUDIT_READ_PERMISSION]: { kind: 'class' } }, … })` — which is one line in
 * the place the rest of its catalog is already assembled. ADOPTING.md §4 has it.
 *
 * A host whose catalog spells the id differently passes `gatePermissions.read`;
 * this is the default, not a requirement.
 */
export const AUDIT_READ_PERMISSION = 'audit:read';
