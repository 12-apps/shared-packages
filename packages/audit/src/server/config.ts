/**
 * What every route in this surface shares (12-14): the actor, the request, the
 * response envelope and the config seam. Mirrors the report-builder / rbac shape
 * — framework-neutral descriptors that a forty-line adapter mounts.
 */
import type { AuditVocabulary } from '../core/vocabulary';

import type { AuditDbProvider } from './db';

/**
 * What a host must resolve before a request reaches these handlers: WHO is
 * calling, WHICH tenant the request is scoped to, and what they may do.
 *
 * The package derives none of it. In exchange it trusts none of the request
 * either: `tenantId` is taken from here and NEVER from a path/query parameter,
 * which is the whole of this surface's tenancy story (see `store.ts`).
 */
export interface AuditActor {
  /** The tenant row id every read and write is scoped to. */
  tenantId: string;
  /**
   * The caller's user id, or `null` for an authenticated caller with no user row
   * (an env-allowlist platform operator, say).
   */
  userId: string | null;
  /**
   * The caller's resolved permission ids — REQUIRED, and required so the gate
   * fails closed: an actor that forgets to carry them can read nothing rather
   * than everything. `'*'` in the list satisfies any gate.
   */
  permissions: readonly string[];
  /** Platform operator. Short-circuits the permission gate. */
  isSuper?: boolean;
  /** The role the request was authorized under, for the actor-context stamp. */
  role?: string | null;
  /** The scope the authorization decision was made in. */
  scope?: string | null;
  /**
   * The identity this request is being RENDERED AS, when a session is
   * impersonating. The host resolves it (from its own signed cookie / session);
   * the package records it beside `userId`, never instead of it, and derives the
   * real human from `userId` at stamp time so nothing downstream can forge it.
   */
  onBehalfOfUserId?: string | null;
}

/**
 * One request, as this package sees it — framework-neutral.
 *
 * `raw` is the adapter's own context object (a Hono `Context`, an Express
 * `req`…). It exists for `resolveActor` alone: reading a session cookie is host
 * work, and a host must not have to re-implement it against a normalized shape.
 * No handler in this package touches it.
 */
export interface AuditRequest {
  params: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  header(name: string): string | undefined;
  raw?: unknown;
}

/**
 * Resolve the caller. `null` means unauthenticated, which answers 401 before any
 * handler runs. Billing gates (an entitlement check on the audit surface, say)
 * belong here too — answered before delegating.
 */
export type ResolveAuditActor = (
  request: AuditRequest,
) => Promise<AuditActor | null> | AuditActor | null;

/** What a handler answers with; the adapter maps this onto its response type. */
export interface AuditResponse {
  status: number;
  /** `undefined` means NO body at all (204) — not the same as `null`. */
  body: unknown;
}

export interface AuditRoute {
  method: 'GET';
  /**
   * Path relative to the host's admin mount, in `:param` form. The SHAPE is
   * fixed because the packaged viewer builds these URLs.
   */
  path: string;
  handle(request: AuditRequest): Promise<AuditResponse>;
}

/** A member's identity, resolved by the host's user directory. */
export interface AuditUserIdentity {
  id: string;
  /** Display name; falls back to `email` when absent, then to the raw id. */
  name?: string | null;
  email?: string | null;
}

/**
 * The host's user directory (OPTIONAL).
 *
 * The package owns audit rows; WHO a user id is (name, e-mail) is host identity
 * data and crosses this seam by value. Without a directory the viewer shows raw
 * ids — which is legible for nobody, so a host that has a user table should wire
 * it. Names are resolved for BOTH id columns in ONE batched call: the
 * impersonated person is very often the actor of some other row on the same
 * page, so the union is usually no wider, and resolving them separately would
 * leave "X on behalf of <uuid>" on screen.
 */
export interface AuditDirectory {
  getUsers(ids: readonly string[]): Promise<readonly AuditUserIdentity[]>;
  /**
   * The actors the viewer may offer in its "who" filter, for one tenant. Without
   * it the filter degrades to a free-text actor id (documented in ADOPTING.md) —
   * the package will not invent a roster it does not own.
   */
  listActors?(tenantId: string): Promise<readonly AuditUserIdentity[]>;
}

/** The retention policy — the ONLY sanctioned removal path for entries. */
export interface AuditRetentionConfig {
  /**
   * The global floor, in days: `purgeExpired()` deletes entries older than this.
   * Default 365 — twelve months covers a full fiscal year of "who did this?"
   * disputes for the smallest tenant while bounding table growth.
   */
  floorDays?: number;
  /**
   * The physical table name, when a host maps the model elsewhere. The sweep is
   * raw SQL, so it needs the real name; it is an IDENTIFIER, never a parameter,
   * so it is validated against `[A-Za-z_][A-Za-z0-9_]*` before interpolation.
   */
  table?: string;
}

/** The permission ids gating this surface, overridable per host catalog. */
export interface AuditGatePermissions {
  /** Reading the tenant's trail (and the actor options behind its filter). */
  read: string;
}

export const DEFAULT_GATE_PERMISSIONS: AuditGatePermissions = { read: 'audit:read' };

/** The user-facing copy this surface emits (pt-BR product copy by default). */
export interface AuditMessages {
  unauthenticated: string;
  forbidden: string;
  invalidQuery: string;
}

export const DEFAULT_MESSAGES: AuditMessages = {
  unauthenticated: 'Não autenticado.',
  forbidden: 'Você não tem permissão para ver a auditoria.',
  invalidQuery: 'Filtros inválidos',
};

export interface AuditServerConfig {
  /** Prisma-shaped client for the one owned model, through the seam. */
  db: AuditDbProvider;
  /** Who is calling, per request. See {@link ResolveAuditActor}. */
  resolveActor: ResolveAuditActor;
  /**
   * What may be audited, and what a row may say. Required: an audit surface with
   * a vocabulary the package guessed would silently drop diffs.
   */
  vocabulary: AuditVocabulary;
  /**
   * The models whose writes carry `created_by`/`updated_by`, for the stamping
   * extension. This is the value future-pay hard-coded INSIDE the extension
   * (`TRACKED_MODELS`); it is config here. Empty/omitted = the extension is a
   * pass-through.
   */
  trackedModels?: readonly string[];
  /**
   * The models the append-only guard protects. Defaults to `['AuditLog']` — this
   * package's own. A host with other immutable tables can add them.
   */
  appendOnlyModels?: readonly string[];
  retention?: AuditRetentionConfig;
  directory?: AuditDirectory;
  gatePermissions?: Partial<AuditGatePermissions>;
  messages?: Partial<AuditMessages>;
}

/** A user-safe API error carrying the HTTP status the wire promises. */
export class AuditApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AuditApiError';
    this.status = status;
    Object.setPrototypeOf(this, AuditApiError.prototype);
  }
}

export const ok = (data: unknown, status = 200): AuditResponse => ({ status, body: { data } });

/**
 * A denial: `{ error }` at the TOP level, never wrapped in `data`. Not exported —
 * every failure in this surface travels as an {@link AuditApiError} through
 * {@link foldApiError}, so there is exactly one place a status and a message
 * become a response.
 */
const fail = (status: number, error: string): AuditResponse => ({ status, body: { error } });

/** A `{ data, pagination }` page — returned UNWRAPPED (no outer envelope). */
export const pageResponse = (data: unknown[], pagination: unknown): AuditResponse => ({
  status: 200,
  body: { data, pagination },
});

/** Fold an {@link AuditApiError} into a response; rethrow anything else. */
export function foldApiError(error: unknown): AuditResponse {
  if (error instanceof AuditApiError) return fail(error.status, error.message);
  throw error;
}

/** The messages in force, defaulted to the pt-BR product copy. */
export const messagesOf = (config: Pick<AuditServerConfig, 'messages'>): AuditMessages => ({
  ...DEFAULT_MESSAGES,
  ...config.messages,
});

/** The gate permission ids in force. */
export const gatesOf = (
  config: Pick<AuditServerConfig, 'gatePermissions'>,
): AuditGatePermissions => ({ ...DEFAULT_GATE_PERMISSIONS, ...config.gatePermissions });

/**
 * The permission gate. A platform operator passes; everyone else must carry the
 * id (or `'*'`) in the set the HOST resolved. There is no "the host already
 * checked" mode on purpose: that mode is indistinguishable from a host that
 * forgot, and this surface reads a security log.
 */
export function requirePermission(
  actor: AuditActor,
  permission: string,
  messages: Pick<AuditMessages, 'forbidden'>,
): void {
  if (actor.isSuper) return;
  if (actor.permissions.includes('*') || actor.permissions.includes(permission)) return;
  throw new AuditApiError(403, messages.forbidden);
}
