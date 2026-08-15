/**
 * `@12-apps/audit/server` — the backend half.
 *
 * One factory: {@link createApiAudit}. Everything else exported here is either a
 * type a host needs to satisfy the config, or a piece a host composes on its own
 * (the actor context, so a job or a script can enter one; the two extensions, for
 * a host building its client by hand).
 *
 * Server-only: the actor context is `node:async_hooks`. Never import from an Edge
 * runtime.
 */
export { createApiAudit, type ApiAudit } from './create-api-audit';

export {
  actorContextKey,
  DEFAULT_ACTOR_STORE_KEY,
  getActorAttribution,
  getActorUserId,
  runWithActor,
  runWithActorScope,
  setActor,
  declareActorContextKey,
  type ActorAttribution,
  type ActorAttributionSnapshot,
  type ActorContext,
} from './actor-context';

export {
  AppendOnlyViolationError,
  applyAppendOnlyGuard,
  AUDIT_LOG_MODEL,
  type AppendOnlyConfig,
} from './append-only-extension';
export { applyAuditStamps, type AuditStampConfig } from './audit-extension';

export {
  AuditApiError,
  DEFAULT_GATE_PERMISSIONS,
  DEFAULT_MESSAGES,
  DEFAULT_PAGINATION,
  DEFAULT_RETENTION_FLOOR_DAYS,
  requirePermission,
  type AuditActor,
  type AuditDirectory,
  type AuditGatePermissions,
  type AuditMessages,
  type AuditPagingPolicy,
  type AuditPaginationConfig,
  type AuditRequest,
  type AuditResponse,
  type AuditRetentionConfig,
  type AuditRoute,
  type AuditServerConfig,
  type AuditUserIdentity,
  type ResolveAuditActor,
} from './config';

/** This package's own permission id, re-exported so `/server` is self-sufficient. */
export { AUDIT_READ_PERMISSION } from '../core/permissions';

export { gatesOf, messagesOf, modelNamesOf, pagingOf } from './policy';

export { auditLogOrderBy, AUDIT_LOG_ORDER_BY, AUDIT_LOG_ORDER_BY_ASC } from './db';
export type {
  AuditDb,
  AuditDbProvider,
  AuditLogCreateData,
  AuditLogDelegate,
  AuditLogOrderBy,
  AuditLogRecord,
  AuditLogWhere,
  AuditSortDirection,
  AuditWriteClient,
} from './db';

export { createAuditRetention, type AuditRetention } from './retention';
export { buildAuditWhere, createAuditStore, paginationMeta, type AuditStore } from './store';
export { auditLogQuerySchema, parseAuditLogQuery, type AuditLogQuery } from './wire';
export {
  AuditActorConflictError,
  createAuditWriter,
  type AuditEntryInput,
  type AuditWriter,
} from './writer';
