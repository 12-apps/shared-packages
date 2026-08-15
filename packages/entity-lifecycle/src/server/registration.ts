/**
 * The DECLARATION a host writes to plug one collection into the surface
 * (12-17). The origin host's per-entity files each repeated the same mechanical
 * steps — build the service, build the context, join the dispatch registry,
 * hand-write six route files (ten collections in the registry, eight with
 * per-entity routes, ~1.8k LOC of registrations beside them). All of that is
 * generated from this one object now; what remains host vocabulary is exactly
 * what only the host can know: which tables the entity lives in
 * ({@link EntityOps}), which permission decides its approvals, and which
 * plan/permission gates guard the collection's surface.
 */

import type { LifecycleAuthorizeGate } from './context';
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
   * The collection's own authorization gate — the origin host's per-collection
   * PLAN entitlement lives here (the host wraps `requireEntitlement`, keeping
   * this package money-free). Awaited before every collection-scoped route
   * AND, on the shared recycle-bin/approvals item routes, after the row has
   * identified the collection — those paths carry no collection prefix, so a
   * gate wrapped around the mount can never express this. A denial's
   * `status`/`error` pass through the wire unmodified (default: the 403
   * feature-off message). Omitted = the collection is always authorized.
   */
  authorize?: LifecycleAuthorizeGate;
  /**
   * A permission id required for EVERY collection-scoped route (drafts,
   * versions, restore) — the origin host's `roles` collection gates its whole
   * lifecycle surface on `roles:manage` where the other collections need
   * only the mount's own admin gate. Checked against the actor's resolved
   * permission set; `isSuper` bypasses; denial is the 403
   * `routeNotAllowed` message. The shared recycle-bin/approvals surfaces are
   * NOT gated by it (parity with the origin host, where the bin and the inbox
   * require the admin tier plus the collection's `authorize` gate).
   */
  routePermission?: string;
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
