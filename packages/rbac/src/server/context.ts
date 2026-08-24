import type { RbacCatalog } from '../core/compose';
import type { AuthzContext, OwnershipPredicate } from '../core/types';

import type { RbacDbProvider } from './db';
import type { RbacNotifyPort } from './notifications';

/**
 * What every route in this surface shares (12-13): the actor, the request, the
 * response envelope and the config seam. Mirrors the report-builder shape —
 * framework-neutral descriptors a forty-line adapter mounts.
 */

/**
 * What a host must resolve before a request reaches these handlers: WHO is
 * calling and WHICH tenant the request is scoped to. Everything else — the
 * caller's permissions, their membership tier, governance — the package
 * resolves itself, from the tables it owns.
 */
export interface RbacActor {
  /** The tenant row id this admin surface is scoped to. */
  tenantId: string;
  /**
   * The caller's DB user id, or `null` for an authenticated caller with no
   * user row (e.g. an env-allowlist platform admin).
   */
  userId: string | null;
  /**
   * Platform operator (the host's own allowlist). Short-circuits every gate —
   * and is exactly what an impersonating host must force FALSE.
   */
  isSuper: boolean;
  /**
   * An optional permission CEILING (e.g. an impersonation preview): the
   * resolved set is intersected with it, so a ceiling can only ever NARROW.
   */
  permissionCeiling?: ReadonlySet<string> | null;
}

/** One request, already authenticated and routed by the host. */
export interface RbacRequest {
  actor: RbacActor;
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  body?: unknown;
}

/** What a handler answers with; the host maps this onto its response type. */
export interface RbacResponse {
  status: number;
  /** `undefined` means NO body at all (204) — not the same as `null`. */
  body: unknown;
}

export interface RbacRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /**
   * Path relative to the host's admin mount, in `:param` form. The SHAPE is
   * fixed because the packaged client builds these URLs.
   */
  path: string;
  handle(request: RbacRequest): Promise<RbacResponse>;
}

/** An audit event this surface emits through the host's sink. */
export interface RbacAuditEntry {
  clientId: string;
  action:
    | 'governance.reject'
    | 'role.create'
    | 'role.update'
    | 'role.delete'
    | 'team.role_set'
    | 'team.role_grant'
    | 'team.role_revoke'
    | 'team.member_remove'
    | 'team.member_status'
    | 'team.invite'
    | 'team.invite_cancel';
  resourceType: 'role' | 'membership' | 'governance';
  resourceId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Host audit sink. The package FENCES every call ({@link fencedAudit}), so a
 * failing sink can never turn the write it reports — or a governance DENIAL —
 * into a 500; the entry is simply lost, which is why a host wanting a
 * complete trail should also persist inside its own transaction (the
 * @12-apps/audit ticket owns that seam). */
export type RbacAuditSink = (entry: RbacAuditEntry) => Promise<void> | void;

/**
 * The fence around the host's sink: every store/governance call site reports
 * through this wrapper, so an audit failure is swallowed rather than escaping
 * AFTER the guarded write already committed (a 500 for a write that
 * succeeded, with no entry to show for it — the worst of both).
 */
export function fencedAudit(sink: RbacAuditSink | undefined): RbacAuditSink | undefined {
  if (!sink) return undefined;
  return async (entry) => {
    try {
      await sink(entry);
    } catch {
      // Deliberately silent: the security outcome (the write, or the denial)
      // stands; the host owns its sink's health.
    }
  };
}

/** A member's identity, resolved by the host's user directory. */
export interface RbacUserIdentity {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  /** Last successful sign-in, when the host records one. */
  lastLoginAt?: Date | null;
}

/**
 * The host's user directory. The package owns memberships and grants; WHO a
 * user id is (email, display name) is host identity data and crosses this
 * seam by value.
 */
export interface RbacUserDirectory {
  getUsers(ids: readonly string[]): Promise<RbacUserIdentity[]>;
  /**
   * The user ids whose name/email match a roster keyword, for the roster's
   * `q` search. Optional: without it the keyword is ignored (documented in
   * ADOPTING.md).
   */
  searchUsers?(q: string): Promise<string[]>;
}

/** A pending accountless invite, when the host wires the invites seam. */
export interface RbacPendingInvite {
  id: string;
  email: string;
  role: string;
}

/**
 * OPTIONAL invite seam. Accountless invites need a table and a signup hook
 * this package does not own, so a host that wants the roster's invite surface
 * plugs its own storage in; without it the two invite routes answer 501 and
 * the packaged screen hides the affordance.
 */
export interface RbacInvitesPort {
  /**
   * Grant-or-invite by e-mail; the host decides which happened.
   *
   * `userId` is the account membership was granted to, when there was one —
   * the `added` branch. It is what makes the invitee REACHABLE: a notification
   * needs a recipient, and this port is the only thing that knows whether the
   * address resolved to an account. Optional, so an existing implementation
   * keeps compiling; omitted, the invite notification is skipped with a
   * written reason rather than sent to nobody.
   */
  invite(
    tenantId: string,
    email: string,
  ): Promise<{ status: 'added' | 'invited'; userId?: string }>;
  listPending(tenantId: string): Promise<RbacPendingInvite[]>;
  /** Cancel a pending invite by id. Idempotent. */
  cancel(tenantId: string, inviteId: string): Promise<void>;
}

/** Every user-facing string this surface emits — REQUIRED host config; pt-BR ships as `./pt-BR`. */
export interface RbacMessages {
  forbidden: string;
  notAMember: string;
  memberNotFound: string;
  roleNotFound: string;
  duplicateRoleName: string;
  reservedRoleName: string;
  lastOwner: string;
  onlyOwnerRemovesOwner: string;
  ownerNotDisableable: string;
  templateNotEditable: string;
  invalidEmail: string;
  /** Composed as `${invalidBody} (field).` by the wire's body validation. */
  invalidBody: string;
  notFound: string;
  invitesNotConfigured: string;
  unauthenticated: string;
  baseRoleNotAssignable: string;
  governance: {
    escalation: string;
    scopeCeiling: string;
    separationOfDuties: string;
    ownerProtected: string;
    unknownRole: string;
    fallback: string;
  };
}

/** The permission ids gating each surface, overridable per host catalog. */
export interface RbacGatePermissions {
  /** Role CRUD, template overrides, member custom-role grant/revoke. */
  manageRoles: string;
  /** Roster + member detail reads. */
  readTeam: string;
  /** Member base-role set, enable/disable, invite cancel. */
  manageTeam: string;
}

export const DEFAULT_GATE_PERMISSIONS: RbacGatePermissions = {
  manageRoles: 'roles:manage',
  readTeam: 'team:read',
  manageTeam: 'team:manage',
};

/** The scope key that satisfies any requested scope. */
export const GLOBAL_SCOPE = 'GLOBAL' as const;

export interface RbacServerConfig<
  P extends string = string,
  E extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Prisma-shaped client for the five owned models, through the seam. */
  db: RbacDbProvider;
  /**
   * The host's composed catalog: the permission registry the engine and the
   * wire validate against, the seeded role templates, the governance catalog
   * and the per-tenant seed rows — assembled once by
   * `composePermissions(...).withRoles(...)`.
   *
   * ONE field, not four, on purpose. As four they could disagree: a registry
   * from the host beside a governance catalog left on a package default is a
   * config that type-checks and enforces the wrong policy.
   */
  catalog: RbacCatalog<P>;
  /** The host's user directory (roster identity). */
  directory: RbacUserDirectory;
  /**
   * Roles the roster may hand out as a member's BASE role
   * (`PATCH /team/:userId`). ENFORCED before governance: a name outside the
   * set is the wire's 400. Defaults to the non-owner template names — a
   * custom role is additive (`POST /team/:userId/roles`), never a base.
   */
  assignableBaseRoles?: readonly string[];
  /**
   * The coarse admin tier — the base roles whose members may reach this
   * surface at all (the outer boundary; the permission gates do the fine
   * work).
   *
   * REQUIRED, and nothing in the catalog can answer it: "which roles are
   * administrators" is not a property of the permissions or of the role
   * policy. It used to default to `['OWNER', 'ADMIN']`, which is one
   * application's vocabulary — closed for a host that spells its tiers
   * otherwise (every admin locked out), and merely wrong for a host that
   * happens to have a role called `ADMIN` meaning something else.
   */
  adminRoles: readonly string[];
  /**
   * Roles protected from the disable/removal invariants (last owner, "only an
   * owner removes an owner"). Defaults to the composed
   * `catalog.governance.ownerRoles` — the host already had to state that set
   * to assemble its catalog, so the two cannot silently disagree.
   *
   * Set it only to NARROW the protected set below the grant-protected one
   * (the origin host protects grants for `OWNER` + `SUPERADMIN` but runs the roster
   * invariants on `OWNER` alone). It used to default to `['OWNER']`, so a host
   * spelling its owner tier any other way lost both invariants outright.
   */
  ownerRoles?: readonly string[];
  /**
   * The storefront/no-op membership role excluded from the roster and from the
   * staff tier, or `null` for a host whose memberships are all staff.
   *
   * REQUIRED — and `null` has to be written out — because both effects fail
   * OPEN when it is wrong: `requireStaffTier` admits every shopper, and the
   * roster stops excluding customers, so their names and e-mails appear in a
   * staff list. It used to default to `'CUSTOMER'`.
   */
  customerRole: string | null;
  /** Optional audit sink; every write and governance denial reports here. */
  audit?: RbacAuditSink;
  /** Optional invites seam — see {@link RbacInvitesPort}. */
  invites?: RbacInvitesPort;
  /**
   * OPTIONAL notification port — how this package tells an invitee they were
   * invited. Bound, `POST /team` emits `rbac.team.invited` after the write
   * commits and the host's pipeline delivers it with no new host code.
   * Unbound, nothing is emitted, which is the behaviour every host has today —
   * the difference is that the silence is now a capability a host declines
   * rather than a hole nobody can see. See `./notifications`.
   */
  notify?: RbacNotifyPort;
  /** Walk a scope to its parent (`org:` chains). Default: flat scopes. */
  scopeParent?: (scope: string) => string | null;
  /**
   * Awaited before a scoped decision so an async parent edge (a DB read) can
   * be cached for the synchronous {@link RbacServerConfig.scopeParent} walk.
   */
  warmScope?: (scope: string) => Promise<void>;
  /** Entity-gate ownership map for INSTANCE permissions. Default: none. */
  ownership?: (subject: string, resourceType: string) => OwnershipPredicate | null;
  /**
   * Expand the direct resource-assignment ids for a type (e.g. sector → the
   * live tables of that sector). Default: the direct ids unchanged.
   */
  expandAssignments?: (
    direct: string[],
    resourceType: string,
    context: AuthzContext,
  ) => Promise<string[]> | string[];
  /**
   * Extra payload merged into `GET /permissions` (e.g. an entitlement
   * snapshot) so a host extends the shell read with zero route code.
   *
   * Whatever this resolves to becomes part of the answer, so it is part of the
   * CONTRACT — see `MyPermissionsPayload` in `./payloads`, which is the shape
   * a host should hold its advertised schema to.
   */
  permissionsExtras?: (actor: RbacActor) => Promise<E>;
  /** Gate permission ids, when the host's catalog spells them differently. */
  gatePermissions?: Partial<RbacGatePermissions>;
  /**
   * The refusal sentences this surface answers with — REQUIRED, the host's
   * words. A pt-BR host passes `PT_BR_RBAC_MESSAGES` from `./pt-BR`, which is
   * verbatim what the origin host's routes said; requiring it turns that
   * choice into a line in the host's diff instead of a silence.
   */
  messages: RbacMessages;
}

/** A user-safe API error carrying the HTTP status the wire promises. */
export class RbacApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'RbacApiError';
    this.status = status;
    Object.setPrototypeOf(this, RbacApiError.prototype);
  }
}

export const ok = (data: unknown, status = 200): RbacResponse => ({
  status,
  body: { data },
});
export const fail = (status: number, error: string): RbacResponse => ({
  status,
  body: { error },
});

/** Fold a store/governance {@link RbacApiError} into a response; rethrow the rest. */
export function foldApiError(error: unknown): RbacResponse {
  if (error instanceof RbacApiError) return fail(error.status, error.message);
  throw error;
}

/** Pagination meta, the same wire shape the origin host search engine emits. */
export interface PaginationMeta {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
}

export function paginationMeta(total: number, page: number, pageSize: number): PaginationMeta {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return { total, page, pageSize, pageCount, hasNextPage: page < pageCount };
}

/** A `{ data, pagination }` page — returned UNWRAPPED (no outer envelope). */
export function pageResponse(data: unknown[], pagination: PaginationMeta): RbacResponse {
  return { status: 200, body: { data, pagination } };
}

/** The messages in force — REQUIRED host config; pt-BR ships as `./pt-BR`. */
export function messagesOf(config: { messages: RbacMessages }): RbacMessages {
  return config.messages;
}

/** The gate permission ids in force. */
export function gatesOf(config: {
  gatePermissions?: Partial<RbacGatePermissions>;
}): RbacGatePermissions {
  return { ...DEFAULT_GATE_PERMISSIONS, ...config.gatePermissions };
}
