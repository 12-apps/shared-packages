/**
 * Three-layer feature resolution.
 *
 * A lifecycle feature is active for a tenant+collection only when:
 *   1. code    — the collection declared it in `EntityLifecycleConfig.features`
 *   2. plan    — the tenant is entitled to it (`entitlements`, what they pay for)
 *   3. tenant  — the tenant hasn't switched it off in the config panel
 *                (`settings`; missing = the feature's default-when-entitled).
 *
 * An entitled tenant is never forced: layer 3 always wins over layer 2.
 */

import type {
  EntityLifecycleConfig,
  FeatureDecision,
  FeatureFlagMap,
  LifecycleFeature,
} from './types';

export function resolveFeature(
  feature: LifecycleFeature,
  config: Pick<EntityLifecycleConfig, 'features' | 'featureDefaults'>,
  entitlements: FeatureFlagMap,
  settings: FeatureFlagMap,
): FeatureDecision {
  if (config.features[feature] !== true) {
    return { enabled: false, reason: 'not-supported' };
  }
  if (entitlements[feature] !== true) {
    return { enabled: false, reason: 'not-entitled' };
  }
  const setting = settings[feature];
  const defaultOn = config.featureDefaults?.[feature] ?? true;
  const enabled = setting ?? defaultOn;
  return enabled
    ? { enabled: true, reason: 'enabled' }
    : { enabled: false, reason: 'disabled-by-tenant' };
}
