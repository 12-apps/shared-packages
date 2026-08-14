/**
 * The TENANT layer's writer — the tenant's own switches over entitled
 * features, persisted wherever the host keeps them (a JSON column on the
 * tenant row, typically).
 *
 * The four layers are code -> plan -> status -> TENANT SETTING. Reads narrow
 * through the same declared-keys coercion as the resolver, so a typo or a
 * retired key is dropped at read rather than silently becoming a setting
 * nobody can see; this writer is the other half — typed against the feature
 * union so an undeclared key cannot be written in the first place (it would
 * be dropped again at read, and the switch would appear to "not stick").
 *
 * ⚠️ NOT ATOMIC. The store is read-modify-write: two concurrent writes on
 * DIFFERENT keys can lose one of them. Accepted deliberately — the surface is
 * one owner flipping one Switch on one config page. Closing it is a one-line
 * JSONB-merge `UPDATE` in the host's store when a caller appears that needs
 * it.
 *
 * ## The write gates on exactly what the read gates on
 *
 * `describe` reports `entitled`, and that is what disables the Switch on the
 * panel. `set` used to check NOTHING, which was inert only because layer 4
 * runs after layer 2 — a setting for an unentitled feature changes no
 * decision. But it is STORED, and `defaultWhenEntitled: false` exists exactly
 * so that some features stay off until the tenant deliberately asks for them
 * (a preview that borrows a colleague's identity; an approvals gate over
 * writes). Pre-arming that switch while unentitled meant the deliberate opt-in
 * happened before the entitlement did: the moment a plan change granted the
 * feature it was already ON, and nobody ever made that choice knowing what it
 * would do. So the write applies the read's gate.
 */
import type { EntitlementsEngine } from '../core/engine';
import { EntitlementRequiredError } from '../core/errors';
import type { FeatureRegistry } from '../core/types';
import { toSettingsMap } from '../coerce';

/** A feature as a config panel presents it: may they, and did they. */
export interface FeatureSettingState {
  /** The plan/status layers allow it — what decides whether the Switch is live. */
  entitled: boolean;
  /** Entitled AND switched on — the effective answer every gate uses. */
  enabled: boolean;
}

/** Where the host keeps the tenant's own switches. */
export interface FeatureSettingsStore {
  /** The raw column value — untrusted JSON, narrowed by this module. */
  read(tenantId: string): Promise<unknown>;
  /** Persist the merged map. The host owns the column and the write. */
  write(tenantId: string, settings: Record<string, boolean>): Promise<void>;
}

export interface FeatureSettingsConfig<F extends string> {
  engine: EntitlementsEngine<F>;
  features: FeatureRegistry<F>;
  store: FeatureSettingsStore;
}

export interface FeatureSettings<F extends string> {
  /**
   * Resolve one feature into the `{ entitled, enabled }` pair a config panel
   * renders.
   *
   * `entitled` is derived from the DECISION rather than read back off the
   * plan, because "entitled but off" is a reason the engine already names:
   * `disabled-by-tenant` is the one denial the tenant can undo themselves.
   * Every other denial — a plan gap, a suspension, a dunning restriction —
   * leaves the Switch disabled, which is what stops the panel offering a
   * toggle that would 402 the moment it is used.
   */
  describe(tenantId: string, feature: F): Promise<FeatureSettingState>;
  /**
   * Merge one switch into the tenant layer (the config-panel write path), and
   * invalidate the engine's cached state — the column IS the engine's settings
   * layer, so the cache is stale the moment the write lands.
   *
   * Throws {@link EntitlementRequiredError} when the feature is not entitled,
   * which is the SAME condition `describe` reports as `entitled: false` and
   * the panel renders as a dead Switch. The host's existing denial mapping
   * turns it into the right status (402 for a plan gap or a dunning
   * restriction, 404 for a key this build does not have).
   */
  set(tenantId: string, feature: F, enabled: boolean): Promise<void>;
}

/**
 * May the tenant's own switch be touched at all?
 *
 * `disabled-by-tenant` counts as entitled — it IS the state this writer exists
 * to leave and return from. Everything else (a plan gap, `restricted`,
 * `suspended`, a key this build does not declare) is a denial the tenant
 * cannot undo with a toggle.
 */
function mayToggle(reason: string, enabled: boolean): boolean {
  return enabled || reason === 'disabled-by-tenant';
}

export function createFeatureSettings<F extends string>(
  config: FeatureSettingsConfig<F>,
): FeatureSettings<F> {
  const { engine, features, store } = config;
  return {
    async describe(tenantId, feature) {
      const decision = await engine.check(tenantId, feature);
      return {
        entitled: mayToggle(decision.reason, decision.enabled),
        enabled: decision.enabled,
      };
    },
    async set(tenantId, feature, enabled) {
      const decision = await engine.check(tenantId, feature);
      if (!mayToggle(decision.reason, decision.enabled)) {
        throw new EntitlementRequiredError(tenantId, decision);
      }
      const current = toSettingsMap(features, await store.read(tenantId));
      await store.write(tenantId, { ...current, [feature]: enabled });
      // After the commit: silent without a cache configured, which is why a
      // dropped call is only caught by an invalidation tripwire test.
      await engine.invalidate(tenantId);
    },
  };
}
