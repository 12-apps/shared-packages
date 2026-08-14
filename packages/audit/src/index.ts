/**
 * `@12-apps/audit` — action audit as a package: an append-only "who did what"
 * trail, assembled from a vocabulary the ADOPTING APPLICATION declares.
 *
 * This package used to publish one application's vocabulary. Two arrays sat in
 * `core/`, holding that product's actions, its resource kinds, its per-resource
 * field allowlists and its user-facing labels — and the React half DEFAULTED to
 * them, so a host that forgot to pass its own silently ran somebody else's. The
 * symbol was even part of the public API by name. Every one of those exports is
 * gone; `ADOPTING.md` carries the migration table.
 *
 * What stayed is the shape, which is a fact about audit trails rather than
 * about any one product: an action is a closed labelled id, a resource type
 * carries a DENY-BY-DEFAULT field allowlist, an entry names a PAIR of
 * identities (who acted, and who the screen claimed to be), the entry lands
 * inside the caller's transaction, and the table is append-only afterwards.
 *
 * This root entry is FRAMEWORK-FREE and Prisma-free: the vocabulary factory,
 * the deny-by-default diff redaction, this package's own permission id and the
 * wire types — importable from anywhere, including a surface that must not pull
 * a database client in (an offline tool registry, a build-time doc generator).
 *
 * The two halves live behind their own subpaths, one factory each:
 *
 *   import { createApiAudit } from '@12-apps/audit/server';   // backend
 *   import { createWebAudit } from '@12-apps/audit/react';    // frontend
 *   import { auditRouter }   from '@12-apps/audit/hono';      // the adapter
 *
 * Adoption contract, config seam and the honest limits: ADOPTING.md.
 */
export { AuditConfigError, AuditVocabularyError } from './core/errors';

export {
  assertAuditVocabulary,
  defineAuditVocabulary,
  redactDiff,
  type AuditActionOf,
  type AuditActionSpec,
  type AuditResourceOf,
  type AuditResourceSpec,
  type AuditScalar,
  type AuditVocabulary,
  type AuditVocabularySpec,
} from './core/vocabulary';

export { AUDIT_READ_PERMISSION } from './core/permissions';

export type {
  AuditActorOptionWire,
  AuditLogFilters,
  AuditLogPageWire,
  AuditLogWire,
  AuditPagination,
} from './core/types';
