import { describe, expect, it } from 'vitest';

import { NoProviderSucceededError } from '../../core/errors';

import { MERCHANT, call, setupCheckoutWorld, testAdapter } from './harness';

const REF = 'inv_2024_0043';

/** What every case records: the hook's arguments, in call order. */
interface SeenError {
  merchant: unknown;
  error: unknown;
}

/**
 * The `onChargeError` seam (FUT-490) — the host's chance to bookkeep a THROWN
 * charge failure before it is worded. The origin host flips the merchant's
 * connection to FAILED on an account-level rejection (401/403) so its settings
 * screen surfaces the outage instead of a stale VERIFIED; without this seam a
 * host adopting the mount silently loses that, because both money paths catch
 * internally and the raw error never escapes.
 */
describe('onChargeError', () => {
  it('sees the RAW walk error on /charge, and the refusal still answers', async () => {
    const seen: SeenError[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { refuses: true }) }],
      config: {
        onChargeError: (merchant, error) => {
          seen.push({ merchant, error });
        },
      },
    });

    const { status, body } = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });

    expect(status).toBe(502);
    expect(body.code).toBe('PAYMENT_UNAVAILABLE');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.merchant).toEqual(MERCHANT);
    // Raw and unworded — the host's account-error reader needs the failures
    // the walk collected, not the sentence the buyer was answered with.
    expect(seen[0]?.error).toBeInstanceOf(NoProviderSucceededError);
  });

  it('fires on the create path too, so neither money path can skip it', async () => {
    const seen: SeenError[] = [];
    const world = setupCheckoutWorld({
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { refuses: true }) }],
      config: {
        onChargeError: (merchant, error) => {
          seen.push({ merchant, error });
        },
      },
    });

    const { status } = await call(world.routes, 'POST', '/', {});

    expect(status).toBe(502);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.merchant).toEqual(MERCHANT);
  });

  it('is contained: a hook that throws cannot mask the buyer\'s refusal', async () => {
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      chain: [{ name: 'alpha', adapter: testAdapter('alpha', { refuses: true }) }],
      config: {
        onChargeError: () => {
          throw new Error('the bookkeeping write failed');
        },
      },
    });

    const { status, body } = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });

    expect(status).toBe(502);
    expect(body.code).toBe('PAYMENT_UNAVAILABLE');
    expect(body.error).toBe('copy.chainExhausted.CARD');
  });

  it('never fires when the charge settles', async () => {
    const seen: SeenError[] = [];
    const world = setupCheckoutWorld({
      payable: { method: 'CARD' },
      config: {
        onChargeError: (merchant, error) => {
          seen.push({ merchant, error });
        },
      },
    });

    const { status } = await call(world.routes, 'POST', '/charge', {
      orderId: REF,
      card: { token: 'tok_ok' },
    });

    expect(status).toBe(200);
    expect(seen).toEqual([]);
  });
});
