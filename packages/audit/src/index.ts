/**
 * `@12-apps/audit` — action audit as a package (12-14).
 *
 * This root entry is FRAMEWORK-FREE and Prisma-free: the vocabulary, the
 * deny-by-default diff redaction and the wire types, importable from anywhere
 * (including a surface that must not pull a database client in — future-pay
 * loads its MCP registry offline, which is why its action list lived in a
 * constants-only module in the first place).
 *
 * The two halves live behind their own subpaths, one factory each:
 *
 *   import { createApiAudit } from '@12-apps/audit/server';   // backend
 *   import { createWebAudit } from '@12-apps/audit/react';    // frontend
 *   import { auditRouter }   from '@12-apps/audit/hono';      // the adapter
 *
 * Adoption contract, config seam and the honest limits: ADOPTING.md.
 */
export {
  AuditVocabularyError,
  indexVocabulary,
  redactDiff,
  type AuditActionDef,
  type AuditResourceDef,
  type AuditScalar,
  type AuditVocabulary,
  type AuditVocabularyIndex,
} from './core/vocabulary';

export {
  DISPUTE_PAYMENT_ACTION,
  FUTURE_PAY_AUDIT_ACTIONS,
  FUTURE_PAY_AUDIT_RESOURCES,
  FUTURE_PAY_AUDIT_VOCABULARY,
  FUTURE_PAY_TRACKED_MODELS,
  OVER_PAYMENT_ACTION,
  REFUND_PAYMENT_ACTION,
  SHORT_PAYMENT_ACTION,
  SHORT_PAYMENT_RESOLVED_ACTION,
} from './core/future-pay-vocabulary';

export type {
  AuditActorOptionWire,
  AuditLogFilters,
  AuditLogPageWire,
  AuditLogWire,
  AuditPagination,
} from './core/types';
