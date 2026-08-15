/**
 * Framework-free RBAC type contract.
 *
 * The core knows nothing about the host application: scopes and actors are
 * opaque, host-defined values. This file has zero runtime code and zero
 * framework imports.
 */

/** A permission is any string; hosts narrow it to a literal union via {@link definePermissions}. */
export type PermissionString = string;

/**
 * A permission's scope-kind flag.
 *
 * - `'class'`: RBAC alone decides. Holding the permission grants the action on
 *   every instance of the type (products:write, reports:read, ...).
 * - `'instance'`: RBAC is only the FIRST gate. After RBAC grants the action the
 *   default adapter runs a SECOND, entity-level gate (ownership / assignment /
 *   caveat) before allowing a specific resource id.
 */
export type PermissionKind = 'class' | 'instance';

/**
 * The subject of an authorization decision. The core only needs an `id`; hosts
 * may pass richer actor objects, but nothing here reads beyond `id`.
 */
export interface Actor {
  id: string;
}

/**
 * A host-defined opaque scope key that a role assignment applies to.
 * For a multi-tenant app this is typically the tenant id.
 */
export type Scope = string;

/** A single grant: an actor holds `role` within `scope`. */
export interface RoleAssignment {
  role: string;
  scope: Scope;
  /**
   * Inline permission set for a DB-defined CUSTOM role (FUT-146). When present,
   * the engine expands THESE instead of looking `role` up in the template index —
   * so a tenant's own role actually grants (a name absent from the templates would
   * otherwise resolve to zero permissions). `'*'` grants everything. Omit for the
   * seeded template roles, whose name resolves against the prebuilt index as before.
   */
  permissions?: readonly RolePermissionEntry[] | '*';
}

/**
 * Host-populated attribute bag threaded through every check. Used by ABAC
 * caveats (amountUnder, withinShift, notExpired, ...). Never inspected by the
 * core itself — only by host-supplied caveat functions.
 */
export type AuthzContext = Record<string, unknown>;

/** A caveat: a pure predicate over the host-populated context. */
export type Caveat = (context: AuthzContext) => boolean;

/**
 * A role's permission entry. Either a bare permission string, or a permission
 * paired with a caveat that must additionally pass for the grant to hold.
 */
export type RolePermissionEntry<P extends string = string> =
  | P
  | { permission: P; caveat?: Caveat };

/**
 * A role definition. `permissions` is either an explicit list of permission
 * entries (bare strings and/or `{ permission, caveat }` objects) or the
 * wildcard `'*'` (grants everything). `inherits` names other roles whose
 * permissions are unioned in.
 */
export interface RoleDef<P extends string = string> {
  name: string;
  permissions: readonly RolePermissionEntry<P>[] | '*';
  inherits?: readonly string[];
  description?: string;
}

/**
 * A compile-time-checked permission registry. `list` is the full set; `has` is
 * a type guard narrowing an arbitrary string to the registered union `P`;
 * `kind` reports whether a permission is class- or instance-scoped.
 */
export interface PermissionRegistry<P extends string> {
  list: readonly P[];
  has(p: string): p is P;
  /**
   * Scope-kind of a permission; a permission the registry does not KNOW
   * defaults to `'class'`. In a composed catalog that default reaches only ids
   * no source contributes — composition refuses a spec that does not declare a
   * valid `kind`, so a registered id always answers with its own.
   */
  kind(p: string): PermissionKind;
}

/**
 * Resolves an actor id to their role assignments. Host-supplied; may hit a DB.
 * Sync or async return is accepted.
 */
export type AssignmentResolver = (
  actorId: string,
) => RoleAssignment[] | Promise<RoleAssignment[]>;

/**
 * Describes "the actor owns this resource" for the default adapter's entity
 * gate. Either the name of an owner column (compared to the subject id) or an
 * explicit predicate the host evaluates. `subjectField`/`value` are surfaced so
 * a SQL host can turn a field descriptor into a `WHERE owner_id = $1` clause.
 */
export type OwnershipPredicate =
  | { kind: 'field'; field: string }
  | { kind: 'predicate'; test: (resourceId: string) => boolean };

/** The result of a LIST-seam query: what instances of a type are visible. */
export type VisibleResult =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'ids'; ids: string[] }
  /** An opaque, host-interpreted narrowing (e.g. a SQL WHERE fragment). */
  | { kind: 'predicate'; predicate: unknown };

/**
 * The Policy Decision Point. Two seams:
 *
 * - `check`: a POINT decision — may this subject do this action to this exact
 *   resource (or a class action when `resource` is null)?
 * - `visible`: the LIST seam — which instances of `resourceType` may this
 *   subject act on? Returns `all` / `none` / concrete `ids` / an opaque
 *   `predicate` the host turns into a query filter.
 *
 * The default SQL/in-process adapter implements both. An OpenFGA adapter would
 * implement the SAME interface (check -> Check RPC, visible -> ListObjects),
 * making the engine swappable without touching call sites.
 */
export interface AuthzAdapter {
  check(
    subject: string,
    action: string,
    resource: string | null,
    context: AuthzContext,
  ): boolean | Promise<boolean>;
  visible(
    subject: string,
    action: string,
    resourceType: string,
    context: AuthzContext,
  ): VisibleResult | Promise<VisibleResult>;
}

/** Everything {@link createRbac} needs to build an engine. */
export interface RbacConfig<P extends string> {
  permissions: PermissionRegistry<P>;
  roles: readonly RoleDef<P>[];
  resolver: AssignmentResolver;
  /** Scope key that satisfies any requested scope. Defaults to `'GLOBAL'`. */
  globalScope?: string;
  /**
   * Swap the Policy Decision Point. Omit to use the built-in default SQL /
   * in-process adapter (RBAC + ownership + assignment + caveats). Supply e.g.
   * an OpenFGA-backed {@link AuthzAdapter} to delegate decisions instead.
   */
  adapter?: AuthzAdapter;
  /**
   * Walk from a scope to its parent (org -> site chains). A grant at a
   * parent scope satisfies checks at any descendant. Return `null` at the root.
   * The walk is cycle-guarded by the engine.
   */
  scopeParent?: (scope: Scope) => Scope | null;
  /**
   * Entity gate — "the actor owns resources of this type". Returns a field name
   * or an explicit predicate. Only consulted for INSTANCE permissions.
   */
  ownership?: (
    subject: string,
    resourceType: string,
  ) => OwnershipPredicate | null;
  /**
   * Entity gate — the RELATION of resource ids currently assigned to the
   * subject (temporal filtering is the host's job). Many ids, never a single
   * column. Only consulted for INSTANCE permissions.
   */
  assignmentResolver?: (
    subject: string,
    resourceType: string,
    context: AuthzContext,
  ) => string[] | Promise<string[]>;
  /**
   * The scope a check is performed in when a call site does not pass one
   * explicitly (the engine's `can`/`visibleResources` take an optional scope in
   * their context). Defaults to `globalScope`.
   */
  defaultScope?: Scope;
}
