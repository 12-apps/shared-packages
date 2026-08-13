/**
 * The wire types BOTH halves of this package speak (12-14) — declared once in
 * the framework-free core, so the endpoint that serializes a row and the viewer
 * that renders it cannot disagree about its shape. (The bug class this closes is
 * the one FUT-740 shipped three times over: a payload each half described for
 * itself, agreeing nowhere.)
 */

/** Pagination meta, the shape the listing endpoint returns. */
export interface AuditPagination {
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  hasNextPage: boolean;
}

/** One immutable audit entry as the viewer receives it (`createdAt` is ISO). */
export interface AuditLogWire {
  id: string;
  createdAt: string;
  /**
   * The real human whose credentials authorized the write; `null` = a system
   * write (a provider webhook, a job).
   */
  actorUserId: string | null;
  /** Display name for {@link actorUserId}, resolved by the host's directory. */
  actorName: string | null;
  /** The role the action was authorized under; `null` on a system write. */
  actorRole: string | null;
  /** The scope the authorization decision was made in. */
  scope: string | null;
  /**
   * The identity the actor was RENDERING AS during an impersonation session;
   * `null` for every ordinary write, which is nearly all of them.
   *
   * Beside {@link actorUserId}, never instead of it. The PAIR is what lets "who
   * really did this" and "who did the screen claim to be" be answered
   * independently; a viewer that collapsed them would lose exactly the fact the
   * column exists to keep.
   */
  onBehalfOfUserId: string | null;
  /** Display name for {@link onBehalfOfUserId}; `null` when there was none. */
  onBehalfOfName: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  /** Allowlist-redacted state before the mutation (empty for a pure create). */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  requestId: string | null;
}

/** The listing endpoint's body: the page, and its totals. */
export interface AuditLogPageWire {
  data: AuditLogWire[];
  pagination: AuditPagination;
}

/** One pickable actor for the viewer's "who" filter. */
export interface AuditActorOptionWire {
  id: string;
  label: string;
}

/** The filters the listing endpoint accepts, as the viewer holds them. */
export interface AuditLogFilters {
  /** Free text over the resource id (paste an order id to see its trail). */
  q?: string;
  /** Action ids to include (an OR within the filter). */
  actionIn?: string[];
  /** Resource type ids to include. */
  resourceTypeIn?: string[];
  /** Exact actor match — the real human, never the impersonated subject. */
  actorUserId?: string;
  /** Exact resource id match. */
  resourceId?: string;
  /** Inclusive `YYYY-MM-DD` day bounds. */
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}
