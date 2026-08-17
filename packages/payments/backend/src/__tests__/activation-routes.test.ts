import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ActivationRoutesContext } from '../activation/routes';
import { createActivationRouteExtensions } from '../activation/routes';
import type { PaymentsRouteExtensionArgs } from '../http/router';
import type { PaymentsRouteIntent } from '../http/route-table';
import type { MerchantRef } from '../core/types';

import { ACME } from './activation-fixtures';

/**
 * The route factory's own decisions (FUT-463/FUT-559) — phase dispatch, the
 * fresh-settlement rule, the both-ways card settle, the read's heal-means-
 * settled envelope, and the required copy. The primitives it strings together
 * (`verifyProviderCharge`, the redirect start/poll pair, the stranded heal)
 * each have their own suite; here they are stubbed so a case scripts exactly
 * one outcome and asserts what the ROUTE does with it.
 */
vi.mock('../activation/verify-charge', () => ({
  verificationCardPublicKey: vi.fn(),
  verifyProviderCharge: vi.fn(),
}));
vi.mock('../activation/verify-redirect', () => ({
  getPendingVerification: vi.fn(),
  discardPendingVerification: vi.fn(),
  startRedirectVerification: vi.fn(),
  pollRedirectVerification: vi.fn(),
}));
vi.mock('../activation/reconcile', () => ({
  healStrandedActivation: vi.fn(),
}));

import { verificationCardPublicKey, verifyProviderCharge } from '../activation/verify-charge';
import {
  discardPendingVerification,
  getPendingVerification,
  pollRedirectVerification,
  startRedirectVerification,
} from '../activation/verify-redirect';
import { healStrandedActivation } from '../activation/reconcile';

const applyChargeVerification = vi.fn();

/** Ports the stubs above never read — the factory only threads them through. */
function routesContext(): ActivationRoutesContext {
  return {
    activation: { providers: { has: () => false, get: () => null, names: () => ['pagbank'] } } as never,
    reconcile: {} as never,
    settings: { applyChargeVerification },
  };
}

const MISSING_CARD = 'missing card fields (host copy)';

function extensionsUnderTest() {
  return createActivationRouteExtensions<{ tenantId: string }>({
    context: routesContext,
    payer: async () => ({ name: 'Ana', email: 'ana@example.com' }),
    copy: { missingCardFields: MISSING_CARD },
  });
}

function argsFor(body: unknown, merchant: MerchantRef = ACME): PaymentsRouteExtensionArgs<{ tenantId: string }> {
  const intent: PaymentsRouteIntent = {
    kind: 'runVerifyCharge',
    method: 'POST',
    provider: 'pagbank',
    segments: ['settings', 'providers', 'pagbank', 'verify-charge'],
    params: {},
  };
  return {
    request: new Request('https://host.example/api', {
      method: 'POST',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    intent,
    auth: { tenantId: ACME.id },
    merchant,
    http: {} as never,
  };
}

const post = () => extensionsUnderTest().find((extension) => extension.method === 'POST')!;
const get = () => extensionsUnderTest().find((extension) => extension.method === 'GET')!;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createActivationRouteExtensions — the POST card phase', () => {
  it('refuses a card body missing token or taxId with the HOST copy, as a 400', async () => {
    const response = await post().handler(argsFor({ token: 'tok_1' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: MISSING_CARD });
    expect(verifyProviderCharge).not.toHaveBeenCalled();
    expect(applyChargeVerification).not.toHaveBeenCalled();
  });

  it('settles BOTH ways: a pass activates', async () => {
    vi.mocked(verifyProviderCharge).mockResolvedValue({ ok: true, refunded: true });
    const response = await post().handler(argsFor({ token: 'tok_1', taxId: '12345678909' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, refunded: true });
    expect(applyChargeVerification).toHaveBeenCalledWith(ACME, 'pagbank', true);
  });

  it('settles BOTH ways: a refusal deactivates — and answers 200, not 4xx', async () => {
    vi.mocked(verifyProviderCharge).mockResolvedValue({
      ok: false,
      reason: 'declined',
      providerMessage: 'no',
    });
    const response = await post().handler(argsFor({ token: 'tok_1', taxId: '12345678909' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, reason: 'declined', providerMessage: 'no' });
    expect(applyChargeVerification).toHaveBeenCalledWith(ACME, 'pagbank', false);
  });
});

describe('createActivationRouteExtensions — the POST redirect phases', () => {
  it('discard clears the attempt and settles NOTHING', async () => {
    const response = await post().handler(argsFor({ action: 'discard' }));
    expect(await response.json()).toEqual({ ok: true });
    expect(discardPendingVerification).toHaveBeenCalledTimes(1);
    expect(applyChargeVerification).not.toHaveBeenCalled();
  });

  it('start mints the link with the payer the host resolved', async () => {
    vi.mocked(startRedirectVerification).mockResolvedValue({
      ok: true,
      checkoutUrl: 'https://provider.example/pay',
    });
    const response = await post().handler(argsFor({ action: 'start' }));
    expect(await response.json()).toEqual({ ok: true, checkoutUrl: 'https://provider.example/pay' });
    expect(startRedirectVerification).toHaveBeenCalledWith(expect.anything(), ACME, 'pagbank', {
      name: 'Ana',
      email: 'ana@example.com',
    });
    expect(applyChargeVerification).not.toHaveBeenCalled();
  });

  it('poll passes the returned settlement halves through and applies a FRESH settlement', async () => {
    vi.mocked(pollRedirectVerification).mockResolvedValue({ ok: true } as never);
    const response = await post().handler(
      argsFor({ action: 'poll', transactionNsu: 'nsu-1', slug: 'ref-1' }),
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(pollRedirectVerification).toHaveBeenCalledWith(expect.anything(), ACME, 'pagbank', {
      transactionNsu: 'nsu-1',
      slug: 'ref-1',
    });
    expect(applyChargeVerification).toHaveBeenCalledWith(ACME, 'pagbank', true);
  });

  it.each([
    ['pending', { ok: false, reason: 'waiting', pending: true }],
    ['alreadyProven', { ok: true, alreadyProven: true }],
    ['retryable', { ok: false, reason: 'still payable', retryable: true }],
  ])('poll NEVER settles a %s answer', async (_flag, polled) => {
    vi.mocked(pollRedirectVerification).mockResolvedValue(polled as never);
    await post().handler(argsFor({ action: 'poll' }));
    expect(applyChargeVerification).not.toHaveBeenCalled();
  });

  it('an unparseable body falls through to the card refusal, never a throw', async () => {
    const response = await post().handler(argsFor(undefined));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: MISSING_CARD });
  });
});

describe('createActivationRouteExtensions — the GET read', () => {
  it('assembles key, amount and the outstanding attempt', async () => {
    const pending = { reference: 'ref--a1', kind: 'REDIRECT' };
    vi.mocked(verificationCardPublicKey).mockResolvedValue('PUB_KEY');
    vi.mocked(getPendingVerification).mockResolvedValue(pending as never);
    vi.mocked(healStrandedActivation).mockResolvedValue(false);

    const response = await get().handler(argsFor(undefined));
    const body = (await response.json()) as { publicKey: string; pending: unknown; proven: boolean };
    expect(body.publicKey).toBe('PUB_KEY');
    expect(body.pending).toEqual(pending);
    expect(body.proven).toBe(false);
    expect(healStrandedActivation).toHaveBeenCalledWith(expect.anything(), ACME, 'pagbank', 'ref--a1');
  });

  it('a HEALED attempt is settled: pending answers null so the screen cannot re-charge', async () => {
    vi.mocked(verificationCardPublicKey).mockResolvedValue(null);
    vi.mocked(getPendingVerification).mockResolvedValue({ reference: 'ref--a1' } as never);
    vi.mocked(healStrandedActivation).mockResolvedValue(true);

    const body = (await (await get().handler(argsFor(undefined))).json()) as {
      pending: unknown;
      proven: boolean;
    };
    expect(body.pending).toBeNull();
    expect(body.proven).toBe(true);
  });

  it('no outstanding attempt means no heal at all', async () => {
    vi.mocked(verificationCardPublicKey).mockResolvedValue(null);
    vi.mocked(getPendingVerification).mockResolvedValue(null);
    await get().handler(argsFor(undefined));
    expect(healStrandedActivation).not.toHaveBeenCalled();
  });
});
