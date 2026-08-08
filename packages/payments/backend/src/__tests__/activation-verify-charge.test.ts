import { beforeEach, describe, expect, it, vi } from 'vitest';

import { failureFor } from '../activation/failure';
import { verificationCardPublicKey, verifyProviderCharge } from '../activation/verify-charge';
import { ProviderRequestError, UnknownProviderError } from '../core/errors';
import type { ChargeSnapshot } from '../core/types';
import {
  ACME,
  activationAdapter,
  activationContextFor,
  activationRegistry,
  connectedConfig,
} from './activation-fixtures';

const CARD = { token: 'tok_1', taxId: '12345678909', holderName: 'Ana', email: 'a@x.com' };

const h = {
  createCharge: vi.fn(),
  refund: vi.fn(),
};

function cardContext() {
  const adapter = activationAdapter('pagbank', {
    createCharge: h.createCharge as never,
    refund: h.refund as never,
  });
  return activationContextFor({
    providers: activationRegistry({ pagbank: adapter }),
    config: connectedConfig(),
    // The verification charge must announce the same webhook URL a shopper's
    // charge does — it bypasses the credential store to skip the enabled
    // gate, so it would otherwise skip the stamping with it.
    webhookUrl: async () => 'https://paladira.com/api/webhooks/pagseguro/acme/notifications',
  });
}

/**
 * Activation is EARNED here (FUT-463). A store that connected but cannot
 * charge is the exact failure this exists to catch — it shipped once already,
 * as a `Conectado` card, an enabled provider, and every shopper hitting
 * `403 ACCESS_DENIED` at checkout.
 */
describe('verifyProviderCharge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("charges one cent through the merchant's own credentials and refunds it", async () => {
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'CHAR_1' } as ChargeSnapshot);
    // A real snapshot, because the flag is read off it (FUT-680): resolving
    // alone no longer counts as "the cent came back".
    h.refund.mockResolvedValue({ status: 'REFUNDED' });

    const result = await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    expect(result).toEqual({ ok: true, refunded: true });

    const [input, credentials] = h.createCharge.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(input['amount']).toEqual({ amountCents: 1, currency: 'BRL' });
    expect(input['method']).toBe('CARD');
    // The MERCHANT's own connection, not the platform's — charging anything
    // else would prove nothing about whether this store can take money.
    expect(credentials['fields']).toEqual({
      token: 'live-token',
      // Same destination a shopper's charge carries, or the verification
      // would be proving a path no real order takes.
      notificationUrl: 'https://paladira.com/api/webhooks/pagseguro/acme/notifications',
    });
    expect(h.refund).toHaveBeenCalledWith(
      expect.objectContaining({ providerChargeId: 'CHAR_1' }),
      expect.anything(),
    );
  });

  it('reads credentials of a provider that is still DISABLED', async () => {
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'C' } as ChargeSnapshot);
    // The row is off — verification runs before activation by definition, so
    // a path that required `enabled` could never run at all.
    await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);
    expect(h.createCharge).toHaveBeenCalled();
  });

  /**
   * ACCESS_DENIED is the one refusal the STORE OWNER can do nothing about.
   * PagBank exempts merchants on an e-commerce platform from homologação — it
   * is the platform's, done once — so the message must not send them after a
   * task that was never theirs.
   */
  it('puts ACCESS_DENIED on the platform, with nothing for the store to do', async () => {
    h.createCharge.mockRejectedValue(
      new Error('PagBank 403 Forbidden: {"code":"ACCESS_DENIED","description":"whitelist access required"}'),
    );

    const result = await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    expect(result.ok).toBe(false);
    const reason = result.ok === false ? result.reason : '';
    expect(reason).toMatch(/plataforma/i);
    // No instruction, and no step number: both were the original defect.
    expect(reason).not.toMatch(/passo\s*\d/i);
    expect(reason).not.toMatch(/conclua|siga|acesse/i);
  });

  /**
   * Rewording the refusal helps the OWNER and strands whoever is on the phone
   * with the provider, who is asked for its own error and had no way to see
   * it. The raw text rides alongside.
   */
  it("keeps the provider's raw refusal alongside the reworded ACCESS_DENIED", async () => {
    h.createCharge.mockRejectedValue(
      new Error(
        'PagBank 403 Forbidden: {"error_messages":[{"code":"ACCESS_DENIED","description":"whitelist access required. Contact PagSeguro"}]}',
      ),
    );

    const result = await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    const providerMessage = result.ok === false ? result.providerMessage : undefined;
    expect(providerMessage).toContain('ACCESS_DENIED');
    expect(providerMessage).toContain('whitelist access required');
    // Still distinct from the owner-facing sentence, not a replacement.
    expect(result.ok === false ? result.reason : '').toMatch(/plataforma/i);
  });

  it('carries the raw exchange on an ordinary failure too', async () => {
    h.createCharge.mockRejectedValue(new Error('PagBank 500: upstream unavailable'));

    const result = await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    expect(result.ok === false ? result.providerMessage : '').toContain('upstream unavailable');
    expect(result.ok === false ? result.reason : '').toContain('upstream unavailable');
  });

  it('does not pass on a declined charge', async () => {
    h.createCharge.mockResolvedValue({
      status: 'DECLINED',
      declineReason: 'CARD_DECLINED',
    } as ChargeSnapshot);

    const result = await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    expect(result.ok).toBe(false);
    expect(h.refund).not.toHaveBeenCalled();
  });

  it('still passes when the refund fails, and says the cent was kept', async () => {
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'C' } as ChargeSnapshot);
    h.refund.mockRejectedValue(new Error('refund unavailable'));

    // The store demonstrably charges — which is what was being proven — so a
    // stuck cent must not block activation, only be reported.
    expect(await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD)).toEqual({
      ok: true,
      refunded: false,
    });
  });

  it('Given the activation-cent refund FAILED, the owner is told the cent was kept and activation still concludes', async () => {
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'C' } as ChargeSnapshot);
    // The honest adapter path (FUT-680): the provider ANSWERED, and the answer
    // was no. Resolving must not read as "refunded" — only the snapshot may.
    h.refund.mockResolvedValue({ status: 'FAILED' });

    expect(await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD)).toEqual({
      ok: true,
      refunded: false,
    });
  });

  it('reports a refund still PENDING as not-yet-returned, not as done', async () => {
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'C' } as ChargeSnapshot);
    h.refund.mockResolvedValue({ status: 'PENDING' });

    expect(await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD)).toEqual({
      ok: true,
      refunded: false,
    });
  });

  it('refuses when the merchant has no connection at all', async () => {
    const adapter = activationAdapter('pagbank', { createCharge: h.createCharge as never });
    const ctx = activationContextFor({
      providers: activationRegistry({ pagbank: adapter }),
      config: null,
    });

    const result = await verifyProviderCharge(ctx, ACME, 'pagbank', CARD);

    expect(result.ok).toBe(false);
    expect(h.createCharge).not.toHaveBeenCalled();
  });

  /**
   * `ok: false` answers are about a REAL provider; a name outside the
   * registry is a caller bug and THROWS — the same contract the host code had
   * before the move (`providers.get` throws), so the move changed nothing an
   * admin route could observe.
   */
  it('throws UnknownProviderError for a name outside the registry', async () => {
    await expect(verifyProviderCharge(cardContext(), ACME, 'not-a-provider', CARD)).rejects.toThrow(
      UnknownProviderError,
    );
    expect(h.createCharge).not.toHaveBeenCalled();
  });
});

/**
 * The key the OWNER's browser encrypts with must be the MERCHANT's own,
 * resolved without the enabled gate. A checkout resolver reads credentials
 * through that gate, so on a provider still being verified it answers with a
 * platform fallback key (dev) or nothing (prod) — and a card encrypted with
 * another account's key is refused for a reason no one could read off the
 * screen.
 */
describe('verificationCardPublicKey', () => {
  it("uses the key already stored on the merchant's connection", async () => {
    const mint = vi.fn();
    const ctx = activationContextFor({
      providers: activationRegistry({ pagbank: activationAdapter('pagbank') }),
      config: connectedConfig({
        environments: { SANDBOX: {}, PRODUCTION: { token: 'live-token', publicKey: 'STORED_KEY' } },
      }),
      mintCardPublicKey: mint as never,
    });

    expect(await verificationCardPublicKey(ctx, ACME, 'pagbank')).toBe('STORED_KEY');
    expect(mint).not.toHaveBeenCalled();
  });

  /**
   * An OAuth-connected store never pastes a key and the connect flow copies
   * none in, so the first verification hands the HOST's mint hook the
   * merchant's own credentials to fetch one with.
   */
  it("mints one through the host hook, with the merchant's own credentials", async () => {
    const mint = vi.fn().mockResolvedValue('FETCHED_KEY');
    const ctx = activationContextFor({
      providers: activationRegistry({ pagbank: activationAdapter('pagbank') }),
      config: connectedConfig(),
      mintCardPublicKey: mint as never,
    });

    expect(await verificationCardPublicKey(ctx, ACME, 'pagbank')).toBe('FETCHED_KEY');

    const [merchant, provider, credentials] = mint.mock.calls[0] as [
      typeof ACME,
      string,
      { fields: Record<string, string> },
    ];
    expect(merchant).toEqual(ACME);
    expect(provider).toBe('pagbank');
    expect(credentials.fields['token']).toBe('live-token');
  });

  it('answers null when the merchant has no connection', async () => {
    const ctx = activationContextFor({
      providers: activationRegistry({ pagbank: activationAdapter('pagbank') }),
      config: null,
    });
    expect(await verificationCardPublicKey(ctx, ACME, 'pagbank')).toBeNull();
  });
});

/**
 * FUT-686 — a failure with no answer is TRANSPORT, and transport must never
 * read as "the provider refused". Callers act on this flag twice over: a
 * refusal REVOKES the owner's "Checkout Integrado is on" confirmation, while
 * transport keeps the finished step intact and asks them to retry.
 */
describe('failureFor transport classification', () => {
  it('a network failure with a transport cause is transport', () => {
    const outage = new TypeError('fetch failed');
    (outage as { cause?: unknown }).cause = { code: 'ECONNRESET' };
    expect(failureFor(outage).transport).toBe(true);
  });

  it('a status-less ProviderRequestError is transport (the response never parsed)', () => {
    const error = new ProviderRequestError('infinitepay', 'socket hang up', { retriable: true });
    expect(failureFor(error).transport).toBe(true);
  });

  it('a bug of ours is NOT transport — no outage without evidence', () => {
    expect(failureFor(new TypeError('reading undefined')).transport).toBeUndefined();
  });

  it('a real provider refusal (HTTP status) is NOT transport', () => {
    const refusal = new ProviderRequestError('infinitepay', 'unprocessable', {
      retriable: false,
      httpStatus: 422,
    });
    expect(failureFor(refusal).transport).toBeUndefined();
  });
});

/**
 * FUT-679 — every card-phase attempt gets its own reference. The adapters
 * fall back to the reference as the provider idempotency key and PagBank
 * dedupes on it server-side: under a constant reference the second attempt
 * was answered with the FIRST attempt's order, so an owner whose first card
 * declined got the same decline replayed on a good card, indefinitely.
 */
describe('verifyProviderCharge attempt reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'C' } as ChargeSnapshot);
    h.refund.mockResolvedValue({});
  });

  it('mints a fresh --attempt reference, never the bare base', async () => {
    const ctx = cardContext();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await verifyProviderCharge(ctx, ACME, 'pagbank', CARD);
    now.mockReturnValue(2_000_000);
    await verifyProviderCharge(ctx, ACME, 'pagbank', CARD);
    now.mockRestore();

    const refs = h.createCharge.mock.calls.map(
      (call) => (call[0] as unknown as { reference: string }).reference,
    );
    for (const ref of refs) {
      expect(ref).toMatch(/^verify-pagbank-client-1--/);
    }
    // The retry is a NEW charge at the provider, not a replay of the refusal.
    expect(refs[0]).not.toBe(refs[1]);
  });
});
