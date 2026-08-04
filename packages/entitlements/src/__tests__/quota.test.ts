import { describe, expect, it } from 'vitest';

import {
  isExceeded,
  isGranted,
  remainingOf,
  toLimit,
  toWireLimit,
} from '../core/quota';

describe('toLimit', () => {
  it('maps booleans to an unbounded / zero ceiling', () => {
    expect(toLimit(true)).toBe(Number.POSITIVE_INFINITY);
    expect(toLimit(false)).toBe(0);
  });

  it("maps 'unlimited' to Infinity", () => {
    expect(toLimit('unlimited')).toBe(Number.POSITIVE_INFINITY);
  });

  it('passes finite positive numbers through', () => {
    expect(toLimit(5)).toBe(5);
  });

  it('treats a missing key as not entitled', () => {
    expect(toLimit(undefined)).toBe(0);
  });

  it('degrades a nonsense value to zero rather than throwing', () => {
    // One bad row must never take down every gate in the app.
    expect(toLimit(-3)).toBe(0);
    expect(toLimit(Number.NaN)).toBe(0);
  });
});

describe('isGranted', () => {
  it('reads 0 as OFF so a tier can explicitly zero out an inherited quota', () => {
    expect(isGranted(0)).toBe(false);
    expect(isGranted(1)).toBe(true);
    expect(isGranted(false)).toBe(false);
    expect(isGranted(true)).toBe(true);
    expect(isGranted(undefined)).toBe(false);
  });
});

describe('toWireLimit', () => {
  it('returns null for boolean features', () => {
    expect(toWireLimit(true, false)).toBeNull();
  });

  it('keeps unlimited as a JSON-safe sentinel, never Infinity', () => {
    expect(toWireLimit('unlimited', true)).toBe('unlimited');
    expect(toWireLimit(true, true)).toBe('unlimited');
    expect(JSON.parse(JSON.stringify({ l: toWireLimit('unlimited', true) })).l).toBe(
      'unlimited',
    );
  });

  it('returns the finite ceiling for numeric quotas', () => {
    expect(toWireLimit(5, true)).toBe(5);
    expect(toWireLimit(undefined, true)).toBe(0);
  });
});

describe('remainingOf / isExceeded', () => {
  it('never reports negative remaining', () => {
    expect(remainingOf(10, 14)).toBe(0);
    expect(remainingOf(10, 4)).toBe(6);
  });

  it('is never exceeded when unlimited', () => {
    expect(isExceeded(Number.POSITIVE_INFINITY, 1_000_000)).toBe(false);
    expect(remainingOf(Number.POSITIVE_INFINITY, 5)).toBe(
      Number.POSITIVE_INFINITY,
    );
  });

  it('is exceeded at exactly the limit — the ceiling is inclusive of usage', () => {
    expect(isExceeded(10, 9)).toBe(false);
    expect(isExceeded(10, 10)).toBe(true);
  });

  it('reports over-quota state without implying data loss', () => {
    // An over-quota tenant (plan shrank under them) keeps every existing row;
    // only `create` is refused. The algebra just reports it.
    expect(isExceeded(1, 7)).toBe(true);
    expect(remainingOf(1, 7)).toBe(0);
  });
});
