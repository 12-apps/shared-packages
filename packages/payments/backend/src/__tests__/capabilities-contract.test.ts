import { describe, expect, it } from 'vitest';

import { allProviderAdapters } from '../providers/catalog';

/**
 * The capabilities audit (FUT-692): a capability an adapter declares `true`
 * must have the implementation seam behind it, for EVERY adapter — the flags
 * cross the settings API and the MCP manifest, so a false one is a lie told
 * to every host and every operator.
 *
 * Two lies prompted this sweep: Stripe's `splits: true` with no
 * transfer_data/application_fee in any payload (and no reader of the flag
 * anywhere), and Stone's `savedCards: true` with no vault seam. Both are now
 * false; this test is what keeps the next flag honest.
 *
 * Only introspectable truths are asserted — a predicate that cannot be read
 * off the adapter object belongs in that capability's own behavior tests.
 */
describe('capabilities contract — no capability true without an implementation', () => {
  const adapters = allProviderAdapters();

  it('Given the catalog, Then it is non-empty (the sweep sweeps something)', () => {
    expect(adapters.length).toBeGreaterThan(0);
  });

  for (const adapter of adapters) {
    describe(adapter.name, () => {
      it('Given savedCards true, Then the vault seam exists', () => {
        if (adapter.capabilities.savedCards) {
          expect(adapter.vault, `${adapter.name} declares savedCards without a vault`).toBeDefined();
        }
      });

      it('Given refunds true, Then the refund operation exists', () => {
        if (adapter.capabilities.refunds) {
          expect(adapter.refund, `${adapter.name} declares refunds without refund()`).toBeDefined();
        }
      });

      it('Given partialRefunds true, Then refunds is also true', () => {
        if (adapter.capabilities.partialRefunds) {
          expect(
            adapter.capabilities.refunds,
            `${adapter.name} declares partialRefunds without refunds`,
          ).toBe(true);
        }
      });

      it('Given splits declared, Then it is false while ChargeInput carries no split instruction', () => {
        // No adapter may claim splits until the core charge model can express
        // one — there is no field to forward, so a `true` here cannot be
        // implemented. The day ChargeInput grows a split instruction, this
        // assertion is the reminder to replace itself with a payload test.
        expect(
          adapter.capabilities.splits ?? false,
          `${adapter.name} declares splits but ChargeInput has no split field`,
        ).toBe(false);
      });

      it('Given APPLE_PAY in wallets, Then the applePay operations exist', () => {
        if (adapter.capabilities.wallets?.includes('APPLE_PAY')) {
          expect(
            adapter.applePay,
            `${adapter.name} declares APPLE_PAY without the certificate operations`,
          ).toBeDefined();
        }
      });

      it('Given authMode oauth, Then the oauth seam exists', () => {
        if (adapter.authMode === 'oauth') {
          expect(adapter.oauth, `${adapter.name} declares oauth onboarding without oauth()`).toBeDefined();
        }
      });
    });
  }
});
