'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { remainingOf } from '../core/quota';
import type { EntitlementDecision, EntitlementSnapshot } from '../core/types';

/**
 * React bindings.
 *
 * ⚠️ **Boundary rule:** this entry may import TYPES and PURE functions from
 * `../core` only — never a port, an adapter or the engine. The browser bundle
 * must not be able to reach host wiring. There is a test that enforces this.
 *
 * The client NEVER re-resolves entitlements: it receives a server-resolved
 * {@link EntitlementSnapshot} and renders. Mirrors how `@12-apps/rbac`'s
 * `RbacProvider` takes an already-resolved permission set.
 */

/** What an upsell handler is told when a locked surface is activated. */
export interface UpsellRequest<F extends string = string> {
  feature: F;
  /** The cheapest plan that would grant it, when the denial is a plan problem. */
  requiredPlan: string | null;
  decision: EntitlementDecision<F>;
}

interface EntitlementsContextValue {
  snapshot: EntitlementSnapshot<string>;
  onUpsell: ((request: UpsellRequest) => void) | null;
}

const EntitlementsContext = createContext<EntitlementsContextValue | null>(
  null,
);

export interface EntitlementsProviderProps<F extends string = string> {
  /** Server-resolved snapshot (`engine.toSnapshot(tenantId)`). */
  snapshot: EntitlementSnapshot<F>;
  /**
   * Called when a locked surface is activated.
   *
   * The package deliberately does NOT own the upgrade modal — pricing copy,
   * plan comparison and the checkout CTA are app branding, and owning them is
   * what would stop this library being reusable. It reports "this feature was
   * blocked, here is the cheapest plan that includes it"; the host renders.
   */
  onUpsell?: (request: UpsellRequest<F>) => void;
  children: ReactNode;
}

export function EntitlementsProvider<F extends string = string>({
  snapshot,
  onUpsell,
  children,
}: EntitlementsProviderProps<F>) {
  const value = useMemo<EntitlementsContextValue>(
    () => ({
      snapshot: snapshot as EntitlementSnapshot<string>,
      onUpsell: (onUpsell ?? null) as
        | ((request: UpsellRequest) => void)
        | null,
    }),
    [snapshot, onUpsell],
  );
  return (
    <EntitlementsContext.Provider value={value}>
      {children}
    </EntitlementsContext.Provider>
  );
}

function useEntitlementsContext(): EntitlementsContextValue {
  const ctx = useContext(EntitlementsContext);
  if (ctx === null) {
    throw new Error(
      'useEntitlement/<Entitled> must be used within an <EntitlementsProvider>',
    );
  }
  return ctx;
}

/** The whole snapshot, for surfaces that render plan state directly. */
export function useEntitlementSnapshot<
  F extends string = string,
>(): EntitlementSnapshot<F> {
  return useEntitlementsContext().snapshot as EntitlementSnapshot<F>;
}

/**
 * Resolve one feature from the snapshot.
 *
 * A feature absent from the snapshot resolves to `not-supported` rather than
 * throwing — a stale client must degrade to "hidden", never to a crash.
 */
export function useEntitlement<F extends string = string>(
  feature: F,
): EntitlementDecision<F> {
  const { snapshot } = useEntitlementsContext();
  return useMemo(() => {
    const decision = snapshot.features[feature];
    if (decision) return decision as EntitlementDecision<F>;
    return {
      feature,
      enabled: false,
      reason: 'not-supported' as const,
      policy: 'hide' as const,
      limit: null,
      requiredPlan: null,
    };
  }, [snapshot, feature]);
}

/** Convenience boolean for the common case. */
export function useIsEntitled(feature: string): boolean {
  return useEntitlement(feature).enabled;
}

export interface QuotaView<F extends string = string>
  extends EntitlementDecision<F> {
  used: number;
  remaining: number;
  exceeded: boolean;
}

/**
 * Quota view for a feature.
 *
 * `used` is supplied by the caller because live usage is NOT in the snapshot —
 * the component rendering the list already knows how many rows it has, and
 * inventing a fetch here would make the binding non-portable.
 */
export function useQuota<F extends string = string>(
  feature: F,
  used: number,
): QuotaView<F> {
  const decision = useEntitlement(feature);
  return useMemo(() => {
    const limit =
      decision.limit === 'unlimited' || decision.limit === null
        ? Number.POSITIVE_INFINITY
        : decision.limit;
    return {
      ...decision,
      used,
      remaining: remainingOf(limit, used),
      exceeded: Number.isFinite(limit) && used >= limit,
    };
  }, [decision, used]);
}

/** Trigger the host's upsell surface for a feature. No-op without a handler. */
export function useUpsell<F extends string = string>(): (
  feature: F,
) => void {
  const { snapshot, onUpsell } = useEntitlementsContext();
  return useMemo(
    () => (feature: F) => {
      if (!onUpsell) return;
      const decision = snapshot.features[feature];
      if (!decision) return;
      onUpsell({
        feature,
        requiredPlan: decision.requiredPlan,
        decision,
      });
    },
    [snapshot, onUpsell],
  );
}

export interface EntitledProps<F extends string = string> {
  feature: F;
  /** Rendered when the feature is NOT usable. */
  fallback?: ReactNode;
  children: ReactNode;
}

/** Render `children` only when the feature is usable. */
export function Entitled<F extends string = string>({
  feature,
  fallback = null,
  children,
}: EntitledProps<F>) {
  return useEntitlement(feature).enabled ? <>{children}</> : <>{fallback}</>;
}

export interface LockedProps<F extends string = string> {
  feature: F;
  /**
   * Headless render prop — the host owns all markup. Receives the decision and
   * an `upsell()` callback to wire to a click.
   */
  children: (ctx: {
    decision: EntitlementDecision<F>;
    requiredPlan: string | null;
    upsell: () => void;
  }) => ReactNode;
}

/**
 * Headless counterpart to {@link Entitled}: renders ONLY when the feature is
 * unusable, handing the host what it needs to draw a lock + upsell.
 *
 * Renders nothing when the reason is not a plan problem (`disabled-by-tenant`,
 * `not-supported`) — showing "upgrade to unlock" for something the tenant
 * already owns and switched off themselves would be a lie.
 *
 * ⚠️ `requiredPlan` can still be `null` in what this DOES render: a
 * `restricted` / `suspended` account already paid for the feature, and a
 * platform override can revoke one the plan grants. Those are locks without an
 * upgrade path, so branch on it rather than interpolating it blindly —
 * `Upgrade to {requiredPlan}` renders "Upgrade to " for all three.
 */
export function Locked<F extends string = string>({
  feature,
  children,
}: LockedProps<F>) {
  const decision = useEntitlement(feature);
  const upsell = useUpsell<F>();
  if (decision.enabled) return null;
  if (decision.reason === 'disabled-by-tenant') return null;
  if (decision.reason === 'not-supported') return null;
  return (
    <>
      {children({
        decision,
        requiredPlan: decision.requiredPlan,
        upsell: () => upsell(feature),
      })}
    </>
  );
}
