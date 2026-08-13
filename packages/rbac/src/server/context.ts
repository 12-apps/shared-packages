import type { RbacCatalog } from '../core/compose';
import type { AuthzContext, OwnershipPredicate } from '../core/types';

import type { RbacDbProvider } from './db';

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
  /** Grant-or-invite by e-mail; the host decides which happened. */
  invite(tenantId: string, email: string): Promise<{ status: 'added' | 'invited' }>;
  listPending(tenantId: string): Promise<RbacPendingInvite[]>;
  /** Cancel a pending invite by id. Idempotent. */
  cancel(tenantId: string, inviteId: string): Promise<void>;
}

/** The user-facing copy this surface emits (pt-BR product copy by default). */
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

export const DEFAULT_MESSAGES: RbacMessages = {
  forbidden: 'Você não tem permissão para esta ação.',
  notAMember: 'Este usuário não faz parte da equipe.',
  memberNotFound: 'Membro não encontrado.',
  roleNotFound: 'Papel não encontrado.',
  duplicateRoleName: 'Já existe um papel com esse nome.',
  reservedRoleName:
    'Esse nome é reservado para um papel do sistema. Edite o papel do sistema.',
  lastOwner: 'A loja precisa de ao menos um proprietário.',
  onlyOwnerRemovesOwner: 'Apenas o proprietário pode remover outro proprietário.',
  ownerNotDisableable: 'Não é possível desativar um proprietário.',
  templateNotEditable: 'Este papel do sistema não pode ser editado.',
  invalidEmail: 'Informe um e-mail válido.',
  invalidBody: 'Dados inválidos',
  notFound: 'Não encontrado.',
  invitesNotConfigured: 'Convites não estão configurados.',
  unauthenticated: 'Não autenticado.',
  baseRoleNotAssignable: 'Este papel não pode ser definido como papel principal.',
  governance: {
    escalation: 'Você não pode conceder um papel com permissões que você mesmo não possui.',
    scopeCeiling: 'Este papel não pode ser atribuído neste nível de acesso.',
    separationOfDuties: 'Este papel viola a separação de funções e não pode ser atribuído.',
    ownerProtected: 'Este papel é protegido e não pode ser atribuído por aqui.',
    unknownRole: 'Papel desconhecido.',
    fallback: 'Não foi possível atribuir este papel.',
  },
};

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

export interface RbacServerConfig<P extends string = string> {
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
   * work). Default `['OWNER', 'ADMIN']`.
   */
  adminRoles?: readonly string[];
  /** Roles protected from disable/removal invariants. Default `['OWNER']`. */
  ownerRoles?: readonly string[];
  /** The storefront/no-op membership role excluded from the roster. */
  customerRole?: string;
  /** Optional audit sink; every write and governance denial reports here. */
  audit?: RbacAuditSink;
  /** Optional invites seam — see {@link RbacInvitesPort}. */
  invites?: RbacInvitesPort;
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
   */
  permissionsExtras?: (actor: RbacActor) => Promise<Record<string, unknown>>;
  /** Gate permission ids, when the host's catalog spells them differently. */
  gatePermissions?: Partial<RbacGatePermissions>;
  /** User-facing copy overrides. */
  messages?: Partial<RbacMessages>;
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

/** Pagination meta, the same wire shape the future-pay search engine emits. */
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

/** The messages in force, defaulted to the pt-BR product copy. */
export function messagesOf(config: { messages?: Partial<RbacMessages> }): RbacMessages {
  return {
    ...DEFAULT_MESSAGES,
    ...config.messages,
    governance: { ...DEFAULT_MESSAGES.governance, ...config.messages?.governance },
  };
}

/** The gate permission ids in force. */
export function gatesOf(config: {
  gatePermissions?: Partial<RbacGatePermissions>;
}): RbacGatePermissions {
  return { ...DEFAULT_GATE_PERMISSIONS, ...config.gatePermissions };
}
