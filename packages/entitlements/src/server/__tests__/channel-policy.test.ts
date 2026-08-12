// @vitest-environment node
/**
 * The notification channel plan gate — a revoked transport must DEGRADE the
 * emit to the channels the tier still covers, never drop it.
 */
import { describe, expect, it } from 'vitest';

import { createEntitlements } from '../../core/engine';
import { definePlans } from '../../core/plans';
import { defineFeatures } from '../../core/registry';
import { createMemorySource } from '../../memory';
import { createChannelEntitlementFilter } from '../channel-policy';

type Channel = 'EMAIL' | 'WEB_PUSH' | 'WHATSAPP' | 'SMS';

const FEATURES = defineFeatures({
  // E-mail survives dunning: the collection path must never gate itself off.
  'notifications.email': { onRevoke: 'disable', retainWhenRestricted: true },
  'notifications.push': { onRevoke: 'disable' },
  'notifications.whatsapp': { onRevoke: 'disable' },
  'notifications.sms': { onRevoke: 'disable' },
} as const);

const PLANS = definePlans(FEATURES, {
  free: { entitlements: { 'notifications.email': true } },
  basic: { extends: 'free', entitlements: { 'notifications.push': true } },
  max: {
    extends: 'basic',
    entitlements: { 'notifications.whatsapp': true, 'notifications.sms': true },
  },
} as const);

type Feature = (typeof FEATURES.list)[number];

const CHANNEL_FEATURE: Record<Channel, Feature> = {
  EMAIL: 'notifications.email',
  WEB_PUSH: 'notifications.push',
  WHATSAPP: 'notifications.whatsapp',
  SMS: 'notifications.sms',
};

const ALL: Channel[] = ['EMAIL', 'WEB_PUSH', 'WHATSAPP', 'SMS'];

/** A fresh engine + policy over one tenant's state — no shared mutables. */
function policyOn(planKey: (typeof PLANS.list)[number], status?: 'restricted') {
  const source = createMemorySource<Feature>({
    'client-1': {
      plan: PLANS.get(planKey).entitlements,
      planKey,
      ...(status === undefined ? {} : { status }),
    },
  });
  const engine = createEntitlements({ features: FEATURES, plans: PLANS, source });
  return createChannelEntitlementFilter(engine, CHANNEL_FEATURE);
}

describe('the channel policy', () => {
  it('keeps only e-mail on the free tier', async () => {
    await expect(policyOn('free')('client-1', ALL)).resolves.toEqual(['EMAIL']);
  });

  it('adds push at basic and the per-message channels only at max', async () => {
    await expect(policyOn('basic')('client-1', ALL)).resolves.toEqual(['EMAIL', 'WEB_PUSH']);
    await expect(policyOn('max')('client-1', ALL)).resolves.toEqual(ALL);
  });

  it('retains e-mail through a dunning restriction — the collection path itself', async () => {
    // `retainWhenRestricted`: a delinquent tenant still gets the e-mail that
    // asks them to pay; the paid channels are withheld while restricted.
    await expect(policyOn('max', 'restricted')('client-1', ALL)).resolves.toEqual(['EMAIL']);
  });
});
