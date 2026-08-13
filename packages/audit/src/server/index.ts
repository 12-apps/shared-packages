/**
 * `@12-apps/audit/server` — the backend half (12-14).
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
  getActorAttribution,
  getActorUserId,
  runWithActor,
  runWithActorScope,
  setActor,
  type ActorAttribution,
  type ActorAttributionSnapshot,
  type ActorContext,
} from './actor-context';

export {
  AppendOnlyViolationError,
  applyAppendOnlyGuard,
  type AppendOnlyConfig,
} from './append-only-extension';
export { applyAuditStamps, type AuditStampConfig } from './audit-extension';

export {
  AuditApiError,
  DEFAULT_GATE_PERMISSIONS,
  DEFAULT_MESSAGES,
  gatesOf,
  messagesOf,
  requirePermission,
  type AuditActor,
  type AuditDirectory,
  type AuditGatePermissions,
  type AuditMessages,
  type AuditRequest,
  type AuditResponse,
  type AuditRetentionConfig,
  type AuditRoute,
  type AuditServerConfig,
  type AuditUserIdentity,
  type ResolveAuditActor,
} from './config';

export type {
  AuditDb,
  AuditDbProvider,
  AuditLogCreateData,
  AuditLogDelegate,
  AuditLogRecord,
  AuditLogWhere,
  AuditWriteClient,
} from './db';

export { createAuditRetention, type AuditRetention } from './retention';
export { buildAuditWhere, createAuditStore, paginationMeta, type AuditStore } from './store';
export { auditLogQuerySchema, parseAuditLogQuery, type AuditLogQuery } from './wire';
export { createAuditWriter, type AuditEntryInput, type AuditWriter } from './writer';
