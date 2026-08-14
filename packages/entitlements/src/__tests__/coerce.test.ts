/**
 * The untrusted-JSON narrowing — a security rule, not a convenience: a
 * garbage value read as a ceiling is a quota bypass.
 */
import { describe, expect, it } from 'vitest';

import { asRecord, toEntitlementMap, toSettingsMap } from '../coerce';
import { defineFeatures } from '../core/registry';

const FEATURES = defineFeatures({
  'forecast.history': { onRevoke: 'hide' },
  'stations.online': { kind: 'quota', onRevoke: 'readonly' },
} as const);

describe('asRecord', () => {
  it('narrows to a plain object and nothing else', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord(null)).toEqual({});
    expect(asRecord([1, 2])).toEqual({});
    expect(asRecord('x')).toEqual({});
  });
});

describe('toEntitlementMap', () => {
  it('keeps only DECLARED keys carrying well-typed values', () => {
    expect(
      toEntitlementMap(FEATURES, {
        'forecast.history': true,
        'stations.online': 'unlimited',
        ghost: true, // retired or typo'd key: dropped, would resolve not-supported anyway
      }),
    ).toEqual({ 'forecast.history': true, 'stations.online': 'unlimited' });
  });

  it('drops a garbage value rather than reading it as a ceiling', () => {
    expect(
      toEntitlementMap(FEATURES, { 'stations.online': 'lots', 'forecast.history': 'yes' }),
    ).toEqual({});
  });

  it('keeps zero — a real value meaning "entitled to none"', () => {
    expect(toEntitlementMap(FEATURES, { 'stations.online': 0 })).toEqual({
      'stations.online': 0,
    });
  });
});

describe('toSettingsMap', () => {
  it('keeps only declared keys carrying booleans', () => {
    expect(
      toSettingsMap(FEATURES, { 'forecast.history': false, 'stations.online': 1, ghost: true }),
    ).toEqual({ 'forecast.history': false });
  });
});
