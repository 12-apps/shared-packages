/**
 * The untrusted-JSON narrowing — a security rule, not a convenience: a
 * garbage value read as a ceiling is a quota bypass.
 */
import { describe, expect, it } from 'vitest';

import { asRecord, toEntitlementMap, toSettingsMap } from '../coerce';
import { defineFeatures } from '../core/registry';

const FEATURES = defineFeatures({
  audit: { onRevoke: 'hide' },
  'stock.locations': { kind: 'quota', onRevoke: 'readonly' },
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
        audit: true,
        'stock.locations': 'unlimited',
        ghost: true, // retired or typo'd key: dropped, would resolve not-supported anyway
      }),
    ).toEqual({ audit: true, 'stock.locations': 'unlimited' });
  });

  it('drops a garbage value rather than reading it as a ceiling', () => {
    expect(
      toEntitlementMap(FEATURES, { 'stock.locations': 'lots', audit: 'yes' }),
    ).toEqual({});
  });

  it('keeps zero — a real value meaning "entitled to none"', () => {
    expect(toEntitlementMap(FEATURES, { 'stock.locations': 0 })).toEqual({
      'stock.locations': 0,
    });
  });
});

describe('toSettingsMap', () => {
  it('keeps only declared keys carrying booleans', () => {
    expect(
      toSettingsMap(FEATURES, { audit: false, 'stock.locations': 1, ghost: true }),
    ).toEqual({ audit: false });
  });
});
