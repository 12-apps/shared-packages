import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pollRedirectVerification, startRedirectVerification } from '../activation/verify-redirect';
import type { ActivationContext } from '../activation/context';
import { UnknownProviderError } from '../core/errors';
import {
  ACME,
  activationAdapter,
  activationContextFor,
  activationRegistry,
  connectedConfig,
  fakeSettings,
  type FakeSettings,
} from './activation-fixtures';

const h = {
  createCharge: vi.fn(),
  findChargeByReference: vi.fn(),
};

function redirectContext(options: { proven?: boolean } = {}): {
  ctx: ActivationContext;
  world: FakeSettings;
} {
  // Named differently from the binding tests destructure on purpose: the
  // flakiness gate tracks module-scope declarations by NAME, and a helper
  // creating fresh per-call state is exactly what it asks for.
  const freshPendingRows = fakeSettings();
  const adapter = activationAdapter('infinitepay', {
    displayName: 'InfinitePay',
    createCharge: h.createCharge as never,
    findChargeByReference: h.findChargeByReference as never,
  });
  const ctx = activationContextFor({
    providers: activationRegistry({ infinitepay: adapter }),
    config: connectedConfig({
      provider: 'infinitepay',
      environments: { SANDBOX: {}, PRODUCTION: { handle: '$loja' } },
      ...(options.proven ? { chargeVerifiedAt: new Date('2026-07-31T00:00:00Z') } : {}),
    }),
    settings: freshPendingRows,
    returnUrl: async () => 'https://paladira.com/admin/acme/config/payments/infinite-pay',
  });
  return { ctx, world: freshPendingRows };
}

/**
 * FUT-684 — the poll must ask about the charge that was actually MINTED.
 *
 * `start` creates every attempt under a fresh `base--attempt` reference (the
 * InfinitePay dedup fix, FUT-541), and the poll used to ask `payment_check`
 * about the bare base — a payment that was never created. InfinitePay answers
 * that with the same `{"success":false}` it gives nonsense, so the browser
 * could never confirm a paid activation and every settlement silently
 * depended on the webhook reaching a public URL.
 */
describe('pollRedirectVerification reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.findChargeByReference.mockResolvedValue(null);
  });

  it("asks the provider about the PENDING attempt's reference, not the base", async () => {
    const { ctx, world } = redirectContext();
    await world.setPendingVerification(ACME, 'infinitepay', {
      reference: 'verify-infinitepay-client-1--k9x',
      checkoutUrl: 'https://pay.example/x',
      startedAt: '2026-08-05T00:00:00.000Z',
      slug: 'INV123',
    });

    await pollRedirectVerification(ctx, ACME, 'infinitepay', { transactionNsu: 'nsu-1' });

    expect(h.findChargeByReference).toHaveBeenCalledWith(
      'verify-infinitepay-client-1--k9x',
      expect.anything(),
      // Both correlation halves still ride along: the stored slug and the
      // returned transaction id are what `payment_check` insists on.
      expect.objectContaining({ slug: 'INV123', transactionNsu: 'nsu-1' }),
    );
  });

  it('falls back to the base reference when no attempt is pending', async () => {
    // Not proven either — otherwise the poll short-circuits before asking.
    const { ctx } = redirectContext();

    await pollRedirectVerification(ctx, ACME, 'infinitepay');

    expect(h.findChargeByReference).toHaveBeenCalledWith(
      'verify-infinitepay-client-1',
      expect.anything(),
      expect.anything(),
    );
  });

  it('a paid pending attempt confirms through the poll alone', async () => {
    const { ctx, world } = redirectContext();
    await world.setPendingVerification(ACME, 'infinitepay', {
      reference: 'verify-infinitepay-client-1--k9x',
      checkoutUrl: 'https://pay.example/x',
      startedAt: '2026-08-05T00:00:00.000Z',
      slug: 'INV123',
    });
    h.findChargeByReference.mockResolvedValue({ status: 'PAID' });

    await expect(
      pollRedirectVerification(ctx, ACME, 'infinitepay', { transactionNsu: 'nsu-1' }),
    ).resolves.toMatchObject({ ok: true });
  });

  /**
   * Already settled — by the webhook, usually — while this tab was still
   * asking. `alreadyProven` tells the caller to apply NOTHING: re-applying
   * would switch a paused-but-proven provider back on uninvited.
   */
  it('answers alreadyProven for a proven config with nothing pending, without asking', async () => {
    const { ctx } = redirectContext({ proven: true });

    await expect(pollRedirectVerification(ctx, ACME, 'infinitepay')).resolves.toMatchObject({
      ok: true,
      alreadyProven: true,
    });
    expect(h.findChargeByReference).not.toHaveBeenCalled();
  });

  /**
   * A name outside the registry THROWS, exactly as the host code did before
   * the move — the graceful `Provedor desconhecido` answer is reserved for a
   * REGISTERED adapter that cannot be polled (no `findChargeByReference`).
   */
  it('throws UnknownProviderError for a name outside the registry', async () => {
    const { ctx } = redirectContext();
    await expect(pollRedirectVerification(ctx, ACME, 'not-a-provider')).rejects.toThrow(
      UnknownProviderError,
    );
    expect(h.findChargeByReference).not.toHaveBeenCalled();
  });
});

/**
 * The redirect start records the attempt BEFORE the owner is sent away to
 * pay: held only in the browser, it died on that trip, and the screen then
 * offered to mint a SECOND real charge on the owner's own card.
 */
describe('startRedirectVerification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('mints the link with the return URL stamped and remembers the attempt', async () => {
    const { ctx, world } = redirectContext();
    h.createCharge.mockResolvedValue({
      status: 'PENDING',
      hostedCheckoutUrl: 'https://pay.example/link',
      settlementHints: { slug: 'INV9' },
    });

    const started = await startRedirectVerification(ctx, ACME, 'infinitepay', { name: 'Ana' });

    expect(started).toEqual({ ok: true, checkoutUrl: 'https://pay.example/link' });
    const [input, credentials] = h.createCharge.mock.calls[0] as [
      { reference: string; method: string },
      { fields: Record<string, string> },
    ];
    // PIX is the honest default — the hosted page offers card AND PIX.
    expect(input.method).toBe('PIX');
    expect(input.reference).toMatch(/^verify-infinitepay-client-1--/);
    // The return trip is how the charge becomes confirmable at all.
    expect(credentials.fields['redirectUrl']).toBe(
      'https://paladira.com/admin/acme/config/payments/infinite-pay',
    );
    // The slug is kept: the mint response is the ONLY place it ever appears.
    expect(world.pendingOf(ACME, 'infinitepay')).toMatchObject({
      reference: input.reference,
      checkoutUrl: 'https://pay.example/link',
      slug: 'INV9',
    });
  });

  it('refuses without recording when the provider returns no URL', async () => {
    const { ctx, world } = redirectContext();
    h.createCharge.mockResolvedValue({ status: 'PENDING' });

    const started = await startRedirectVerification(ctx, ACME, 'infinitepay');

    expect(started.ok).toBe(false);
    expect(world.pendingOf(ACME, 'infinitepay')).toBeNull();
  });

  /**
   * A name outside the registry THROWS rather than answering `ok: false` —
   * the host's own contract at the move (`providers.get` throws), kept so the
   * library changes nothing an admin route could observe.
   */
  it('throws UnknownProviderError for a name outside the registry', async () => {
    const { ctx, world } = redirectContext();

    await expect(startRedirectVerification(ctx, ACME, 'not-a-provider')).rejects.toThrow(
      UnknownProviderError,
    );
    expect(h.createCharge).not.toHaveBeenCalled();
    expect(world.pendingOf(ACME, 'not-a-provider')).toBeNull();
  });
});
