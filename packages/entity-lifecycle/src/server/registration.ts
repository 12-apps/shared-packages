/**
 * The DECLARATION a host writes to plug one collection into the surface
 * (12-17). future-pay's eleven per-entity files each repeated the same four
 * mechanical steps — build the service, build the context, join the dispatch
 * registry, hand-write ~7 route files. All of that is generated from this one
 * object now; what remains host vocabulary is exactly what only the host can
 * know: which tables the entity lives in ({@link EntityOps}) and which
 * permission decides its approvals.
 */

import type { DiffOptions, EntityOps, FeatureFlagMap, RetentionPolicy, Snapshot } from '../types';

export interface LifecycleEntityRegistration {
  /** Stable type key persisted on every record ("product"). */
  entityType: string;
  /**
   * URL segment the generated per-entity routes live under ("products" →
   * `GET /products/:id/versions`, …). Must be unique across registrations and
   * must not collide with the shared surfaces (`recycle-bin`, `approvals`).
   */
  slug: string;
  /** Which flaggable features this collection supports in code. */
  features: FeatureFlagMap;
  /** Tenant-toggle default per feature when entitled but never touched. */
  featureDefaults?: FeatureFlagMap;
  /** Human label for a snapshot, shown in history/recycle-bin UIs. */
  label: (snapshot: Snapshot) => string;
  /** Diff behaviour (ignored fields etc.). */
  diff?: DiffOptions;
  /** Version-history auto-clean policy. */
  retention?: RetentionPolicy;
  /**
   * The permission id that lets an actor DECIDE this collection's approvals
   * ("products:approve"). Checked against the actor's resolved permission
   * set; `isSuper` bypasses. Omitted = only `isSuper` approves.
   */
  approvePermission?: string;
  /** How the host performs actual entity writes (its tables, its rules). */
  ops: EntityOps;
  /**
   * The version currently live on the entity row, for the history dialog's
   * "Versão atual" badge. Hosts that mirror a `published_version` column via
   * `ops.onVersionRecorded` read it back here; omitted, the surface falls
   * back to the highest recorded version — identical for every applied write.
   */
  publishedVersion?: (tenantId: string, entityId: string) => Promise<number | null>;
}
