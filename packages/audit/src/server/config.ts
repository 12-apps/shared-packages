/**
 * What every route in this surface shares: the actor, the request, the response
 * envelope and the config seam. Framework-neutral descriptors that a forty-line
 * adapter mounts.
 */
import { AUDIT_READ_PERMISSION } from '../core/permissions';
import type { AuditCopySource } from '../core/copy';
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
  /**
   * The language to answer this caller in, as a language tag (`pt-BR`,
   * `en-US`) — the same field `@12-apps/wiring`'s `WireRequest` carries.
   *
   * Populated by the host's adapter, which is the only layer that can
   * negotiate one. Absent is meaningful and not an error: a host with one
   * audience never sets it, and this surface must then answer with the words
   * it was configured with rather than invent a language.
   */
  locale?: string;
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
   *
   * Defaults to {@link DEFAULT_RETENTION_FLOOR_DAYS} — twelve months, which
   * covers a full fiscal year of "who did this?" disputes while bounding table
   * growth. That number is one deployment's policy, so it is a DEFAULT and not
   * a rule; a host with a regulator saying otherwise passes its own.
   *
   * Validated at ASSEMBLY, and it has to be: this value is the sweep's cutoff,
   * so `0` puts the cutoff at `now` and the first sweep deletes the entire
   * trail, while `NaN` — what `Number(process.env.AUDIT_RETENTION_DAYS)` yields
   * for an unset variable — reaches the same statement. There is nothing to
   * undo either with.
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

/**
 * The gate this package's own endpoints use, from this package's own id.
 *
 * One definition, in `core/permissions.ts`, so the value a host composes into
 * its RBAC catalog and the value this surface checks are the same string.
 */
export const DEFAULT_GATE_PERMISSIONS: AuditGatePermissions = {
  read: AUDIT_READ_PERMISSION,
};

/**
 * The user-facing copy this surface emits.
 *
 * ENGLISH by default, and that is a fallback rather than a recommendation: a
 * message has to be in some language, and the only defensible default for a
 * package is its own documented one. This package used to default to the
 * extraction origin's market language, so an adopter that never passed
 * `messages` shipped somebody else's locale to its users and had no compile
 * error to notice it by. Pass your product's copy — see ADOPTING.md.
 */
export interface AuditMessages {
  unauthenticated: string;
  forbidden: string;
  invalidQuery: string;
}

export const DEFAULT_MESSAGES: AuditMessages = {
  unauthenticated: 'Not authenticated.',
  forbidden: 'You do not have permission to view the audit trail.',
  invalidQuery: 'Invalid filters',
};

/**
 * The listing's paging policy — one deployment's numbers, as config with those
 * numbers as the defaults.
 *
 * All three bound work a URL can ask for, so all three are validated at
 * assembly: `pageSize` caps the rows one request returns, and `maxPage` caps
 * the `OFFSET` behind it, because Postgres COUNTS AND DISCARDS every skipped
 * row before returning any. `?page=999999999` at the default size is
 * `OFFSET 19999999980` against a table that only grows.
 */
export interface AuditPaginationConfig {
  /** Rows per page when the request names none. Default 20. */
  defaultPageSize?: number;
  /** The ceiling a request's `pageSize` is clamped to. Default 100. */
  maxPageSize?: number;
  /**
   * The ceiling a request's `page` is clamped to. Default 10 000 — past the end
   * of any trail a human is paging through (200k entries at the default size),
   * and a caller who genuinely wants the far end of a big tenant's trail should
   * be narrowing with `from`/`to` instead.
   */
  maxPage?: number;
}

/** The paging policy in force. */
export interface AuditPagingPolicy {
  defaultPageSize: number;
  maxPageSize: number;
  maxPage: number;
}

export const DEFAULT_PAGINATION: AuditPagingPolicy = {
  defaultPageSize: 20,
  maxPageSize: 100,
  maxPage: 10_000,
};

/** The retention floor in force when a host names none. */
export const DEFAULT_RETENTION_FLOOR_DAYS = 365;

export interface AuditServerConfig {
  /** Prisma-shaped client for the one owned model, through the seam. */
  db: AuditDbProvider;
  /** Who is calling, per request. See {@link ResolveAuditActor}. */
  resolveActor: ResolveAuditActor;
  /**
   * What may be audited, and what a row may say — the value
   * `defineAuditVocabulary()` returned, and the SAME value the React half is
   * given. Required, and checked: there is deliberately no default, because a
   * package-supplied vocabulary is one host's, and a host that inherited it
   * would silently drop every diff field its own writers emit.
   */
  vocabulary: AuditVocabulary;
  /**
   * The models whose writes carry `created_by`/`updated_by`, for the stamping
   * extension. Omitted or empty = the extension is a pass-through, which is an
   * honest setting: naming no model means stamping no model, and nothing else
   * in the package depends on it.
   */
  trackedModels?: readonly string[];
  /**
   * ADDITIONAL models the append-only guard protects, for a host with immutable
   * tables of its own.
   *
   * This package's own model is ALWAYS guarded and cannot be removed from the
   * set. It used to be the default value of this field, which meant declaring
   * `appendOnlyModels: ['MyLedger']` — the obvious way to add one — silently
   * turned the audit table's own immutability off, and `[]` turned the guard
   * off entirely while reading like "the default, spelled out".
   */
  appendOnlyModels?: readonly string[];
  retention?: AuditRetentionConfig;
  directory?: AuditDirectory;
  gatePermissions?: Partial<AuditGatePermissions>;
  /**
   * The refusals this surface puts on the wire — a partial override of the
   * packaged defaults, or a RESOLVER that picks one per reader.
   *
   * Read it through `messagesOf(config, locale)` at the moment a sentence is
   * needed. An audit log is opened by whichever operator is looking, so the
   * language is the REQUEST's rather than the deployment's.
   */
  messages?: AuditCopySource<Partial<AuditMessages>>;
  pagination?: AuditPaginationConfig;
}

/**
 * What a copy field takes once its words can follow a reader.
 *
 * The declarations moved to `core/copy.ts` when the VOCABULARY's labels started
 * taking a resolver too — `core/` cannot import from `server/`, and two
 * structurally-identical copies of a seam type is how the two halves come to
 * disagree about it. Re-exported here under the names adopters already import.
 */
// `AuditCopyContext` is deliberately NOT re-exported: nothing here consumes it,
// and this surface's job is to keep the names adopters already import working,
// not to widen them. It is reachable from `core/copy.ts` where it is declared.
export type { AuditCopyResolver, AuditCopySource } from '../core/copy';

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
