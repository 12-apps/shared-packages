import { describe, it, expect } from 'vitest';
import {
  allOf,
  amountAtMost,
  contextFlag,
  isActiveAssignment,
  notExpired,
  withinShift,
} from '../core/caveats';
import { createRbac } from '../core/engine';
import { definePermissions } from '../core/registry';

const NOW = Date.parse('2026-07-24T12:00:00Z');
const HOUR = 60 * 60 * 1000;

describe('amountAtMost', () => {
  const caveat = amountAtMost(5000);

  it('passes at or under the limit', () => {
    expect(caveat({ amount: 4999 })).toBe(true);
    expect(caveat({ amount: 5000 })).toBe(true);
  });

  it('denies over the limit', () => {
    expect(caveat({ amount: 5001 })).toBe(false);
  });

  it('denies a missing or mistyped amount (no silent allow)', () => {
    expect(caveat({})).toBe(false);
    expect(caveat({ amount: '10' })).toBe(false);
    expect(caveat({ amount: Number.NaN })).toBe(false);
  });

  it('reads a custom context key', () => {
    expect(amountAtMost(100, 'refundCents')({ refundCents: 50 })).toBe(true);
    expect(amountAtMost(100, 'refundCents')({ amount: 50 })).toBe(false);
  });
});

describe('withinShift / contextFlag', () => {
  it('passes only on a literal true', () => {
    expect(withinShift()({ onShift: true })).toBe(true);
    expect(withinShift()({ onShift: false })).toBe(false);
    expect(withinShift()({ onShift: 'yes' })).toBe(false);
    expect(withinShift()({})).toBe(false);
  });

  it('reads a custom key', () => {
    expect(contextFlag('clockedIn')({ clockedIn: true })).toBe(true);
    expect(contextFlag('clockedIn')({ onShift: true })).toBe(false);
  });
});

describe('notExpired — time-boxed elevation', () => {
  const caveat = notExpired();

  it('passes while the elevation is in the future (pinned now)', () => {
    expect(caveat({ elevationExpiresAt: NOW + HOUR, now: NOW })).toBe(true);
  });

  it('denies at and after expiry', () => {
    expect(caveat({ elevationExpiresAt: NOW, now: NOW })).toBe(false);
    expect(caveat({ elevationExpiresAt: NOW - 1, now: NOW })).toBe(false);
  });

  it('denies a missing or unparsable expiry (no unbounded elevation)', () => {
    expect(caveat({ now: NOW })).toBe(false);
    expect(caveat({ elevationExpiresAt: 'not-a-date', now: NOW })).toBe(false);
  });

  it('accepts ISO strings and Dates for both instants', () => {
    expect(
      caveat({
        elevationExpiresAt: '2026-07-24T13:00:00Z',
        now: new Date('2026-07-24T12:00:00Z'),
      }),
    ).toBe(true);
  });

  it('falls back to the wall clock when now is not pinned', () => {
    // Fixed instants far on either side of any real clock: year 9999 / 1970.
    expect(caveat({ elevationExpiresAt: '9999-01-01T00:00:00Z' })).toBe(true);
    expect(caveat({ elevationExpiresAt: 1 })).toBe(false);
  });
});

describe('allOf', () => {
  it('grants only when every caveat passes', () => {
    const caveat = allOf(amountAtMost(5000), notExpired());
    const context = { amount: 100, elevationExpiresAt: NOW + HOUR, now: NOW };
    expect(caveat(context)).toBe(true);
    expect(caveat({ ...context, amount: 9999 })).toBe(false);
    expect(caveat({ ...context, elevationExpiresAt: NOW - 1 })).toBe(false);
  });

  it('an empty composition adds no condition', () => {
    expect(allOf()({})).toBe(true);
  });
});

describe('isActiveAssignment — temporal filter-not-delete', () => {
  it('active: started, not ended', () => {
    expect(isActiveAssignment({ validFrom: NOW - HOUR, validTo: null }, NOW)).toBe(true);
    expect(isActiveAssignment({ validFrom: NOW - HOUR }, NOW)).toBe(true);
  });

  it('revoked: validTo stamped in the past stays for audit but stops granting', () => {
    expect(isActiveAssignment({ validFrom: NOW - HOUR, validTo: NOW - 1 }, NOW)).toBe(false);
    expect(isActiveAssignment({ validFrom: NOW - HOUR, validTo: NOW }, NOW)).toBe(false);
  });

  it('not yet started / future validTo', () => {
    expect(isActiveAssignment({ validFrom: NOW + 1 }, NOW)).toBe(false);
    expect(isActiveAssignment({ validFrom: NOW - HOUR, validTo: NOW + 1 }, NOW)).toBe(true);
  });

  it('accepts Dates and ISO strings; unparsable bounds fail closed', () => {
    expect(
      isActiveAssignment(
        { validFrom: new Date(NOW - HOUR), validTo: '2026-07-24T13:00:00Z' },
        new Date(NOW),
      ),
    ).toBe(true);
    expect(isActiveAssignment({ validFrom: 'garbage' }, NOW)).toBe(false);
  });
});

describe('caveats through the engine (grant-level ABAC)', () => {
  const makeEngine = () =>
    createRbac({
      permissions: definePermissions({ 'orders:refund': 'class' } as const),
      roles: [
        {
          name: 'ACTING_MANAGER',
          permissions: [
            {
              permission: 'orders:refund',
              caveat: allOf(amountAtMost(5000), notExpired()),
            },
          ],
        },
      ],
      resolver: () => [{ role: 'ACTING_MANAGER', scope: 'restaurant-1' }],
    });

  it('grants a small refund during the elevation window', async () => {
    const rbac = makeEngine();
    expect(
      await rbac.can('u1', 'orders:refund', null, {
        scope: 'restaurant-1',
        amount: 1000,
        elevationExpiresAt: NOW + HOUR,
        now: NOW,
      }),
    ).toBe(true);
  });

  it('denies once the elevation lapsed or the amount exceeds the cap', async () => {
    const rbac = makeEngine();
    expect(
      await rbac.can('u1', 'orders:refund', null, {
        scope: 'restaurant-1',
        amount: 1000,
        elevationExpiresAt: NOW - 1,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      await rbac.can('u1', 'orders:refund', null, {
        scope: 'restaurant-1',
        amount: 999999,
        elevationExpiresAt: NOW + HOUR,
        now: NOW,
      }),
    ).toBe(false);
  });

  it('denies when the call site forgot to populate the context', async () => {
    const rbac = makeEngine();
    expect(await rbac.can('u1', 'orders:refund', null, { scope: 'restaurant-1' })).toBe(false);
  });
});
