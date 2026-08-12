/**
 * A plan gate over notification channels — the entitlements half of the seam
 * a notifications system exposes as a per-send channel policy.
 *
 * For a tenant-scoped emit the notifications router hands over the channels
 * that survived preferences + transport support, and this policy keeps the
 * ones the tenant's plan covers — so a revoked channel DEGRADES to the ones
 * still granted rather than dropping the notification.
 *
 * Declare the always-on channel's feature `retainWhenRestricted` in the host
 * catalog so the dunning path that collects payment can never gate itself
 * off.
 */
import type { EntitlementsEngine } from '../core/engine';

/**
 * Build the filter a notifications system installs as its channel policy.
 *
 * `channelFeature` maps every channel the host can send through to the feature
 * key that sells it — TOTAL by construction (`Record` over the channel union),
 * so a new channel fails typecheck until it names its gate.
 */
export function createChannelEntitlementFilter<C extends string, F extends string>(
  engine: EntitlementsEngine<F>,
  channelFeature: Record<C, F>,
): (tenantId: string, channels: readonly C[]) => Promise<C[]> {
  return async (tenantId, channels) => {
    const kept: C[] = [];
    for (const channel of channels) {
      const decision = await engine.check(tenantId, channelFeature[channel]);
      if (decision.enabled) kept.push(channel);
    }
    return kept;
  };
}
