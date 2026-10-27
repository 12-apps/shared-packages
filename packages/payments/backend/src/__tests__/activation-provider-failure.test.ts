import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pollRedirectVerification, startRedirectVerification } from '../activation/verify-redirect';
import { verifyProviderCharge } from '../activation/verify-charge';
import { ProviderRequestError } from '../core/errors';
import type { ProviderFailureReport } from '../core/provider-failure';
import type { ChargeSnapshot } from '../core/types';
import { call, setupCheckoutWorld } from '../checkout/__tests__/harness';
import {
  ACME,
  activationAdapter,
  activationContextFor,
  activationRegistry,
  connectedConfig,
} from './activation-fixtures';

/**
 * FUT-4074 — the activation flow and the checkout's own provider call report
 * their failures too. The owner is often on the screen when a verification
 * charge fails, but a refund that silently did not happen, a poll that cannot
 * reach the provider and a browser key the provider will not mint have no
 * screen at all — and those are exactly the failures nobody heard.
 */

const CARD = { token: 'tok_1', taxId: '12345678909', holderName: 'Ana', email: 'a@x.com' };

const h = {
  createCharge: vi.fn(),
  refund: vi.fn(),
  findChargeByReference: vi.fn(),
  reports: [] as ProviderFailureReport[],
};

function cardContext(reporter?: (report: ProviderFailureReport) => void) {
  const adapter = activationAdapter('pagbank', {
    createCharge: h.createCharge as never,
    refund: h.refund as never,
  });
  return {
    ...activationContextFor({ providers: activationRegistry({ pagbank: adapter }), config: connectedConfig() }),
    onProviderFailure: reporter ?? ((report: ProviderFailureReport) => void h.reports.push(report)),
  };
}

function redirectContext() {
  const adapter = activationAdapter('linkpay', {
    displayName: 'LinkPay',
    createCharge: h.createCharge as never,
    findChargeByReference: h.findChargeByReference as never,
  });
  return {
    ...activationContextFor({
      providers: activationRegistry({ linkpay: adapter }),
      config: connectedConfig({ provider: 'linkpay' }),
    }),
    onProviderFailure: (report: ProviderFailureReport) => void h.reports.push(report),
  };
}

const rejection = () =>
  new ProviderRequestError('pagbank', 'PagBank 403 Forbidden: ACCESS_DENIED', {
    httpStatus: 403,
    providerCode: 'ACCESS_DENIED',
  });

beforeEach(() => {
  vi.clearAllMocks();
  h.reports.length = 0;
});

describe('activation card verification', () => {
  it('reports a create the provider refused, with its status, code and environment', async () => {
    h.createCharge.mockRejectedValue(rejection());

    const result = await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    expect(result.ok).toBe(false);
    expect(h.reports).toHaveLength(1);
    expect(h.reports[0]).toMatchObject({
      path: 'ACTIVATION',
      severity: 'error',
      merchant: ACME,
      provider: 'pagbank',
      httpStatus: 403,
      providerCodes: ['ACCESS_DENIED'],
      environment: 'PRODUCTION',
    });
    expect(h.reports[0]?.reference).toMatch(/^verify-pagbank-/);
  });

  it('reports a cent whose refund threw — money the owner must reconcile', async () => {
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'CHAR_1' } as ChargeSnapshot);
    h.refund.mockRejectedValue(new ProviderRequestError('pagbank', 'PagBank 500', { httpStatus: 500 }));

    const result = await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    expect(result).toEqual({ ok: true, refunded: false });
    expect(h.reports.map((r) => [r.path, r.httpStatus])).toEqual([['ACTIVATION_REFUND', 500]]);
  });

  it('reports a refund the provider answered FAILED', async () => {
    h.createCharge.mockResolvedValue({ status: 'PAID', providerChargeId: 'CHAR_1' } as ChargeSnapshot);
    h.refund.mockResolvedValue({ status: 'FAILED' });

    await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    expect(h.reports.map((r) => [r.path, r.message])).toEqual([
      ['ACTIVATION_REFUND', 'pagbank answered the verification refund FAILED'],
    ]);
  });

  it('does not report a refund still PENDING, a clean pass, or the owner\'s own card declined', async () => {
    h.createCharge.mockResolvedValueOnce({ status: 'PAID', providerChargeId: 'C1' } as ChargeSnapshot);
    h.refund.mockResolvedValueOnce({ status: 'PENDING' });
    await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    h.createCharge.mockResolvedValueOnce({ status: 'PAID', providerChargeId: 'C2' } as ChargeSnapshot);
    h.refund.mockResolvedValueOnce({ status: 'REFUNDED' });
    await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    h.createCharge.mockResolvedValueOnce({
      status: 'DECLINED',
      providerChargeId: 'C3',
      declineReason: 'INSUFFICIENT_FUNDS',
    } as ChargeSnapshot);
    const declined = await verifyProviderCharge(cardContext(), ACME, 'pagbank', CARD);

    expect(declined.ok).toBe(false);
    expect(h.reports).toEqual([]);
  });

  it('a reporter that throws does not change the answer the owner gets', async () => {
    h.createCharge.mockRejectedValue(rejection());
    const quiet = await verifyProviderCharge(cardContext(() => undefined), ACME, 'pagbank', CARD);
    const broken = await verifyProviderCharge(
      cardContext(() => {
        throw new Error('tracker exploded');
      }),
      ACME,
      'pagbank',
      CARD,
    );
    expect(broken).toEqual(quiet);
  });
});

describe('activation redirect verification', () => {
  it('reports a link the provider refused to mint', async () => {
    h.createCharge.mockRejectedValue(new ProviderRequestError('linkpay', 'LinkPay 422', { httpStatus: 422 }));

    const result = await startRedirectVerification(redirectContext(), ACME, 'linkpay');

    expect(result.ok).toBe(false);
    expect(h.reports.map((r) => [r.path, r.provider, r.httpStatus, r.severity])).toEqual([
      ['ACTIVATION', 'linkpay', 422, 'error'],
    ]);
  });

  it('reports a poll that could not reach the provider as a warning', async () => {
    h.findChargeByReference.mockRejectedValue(
      Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }),
    );

    const result = await pollRedirectVerification(redirectContext(), ACME, 'linkpay');

    expect(result).toMatchObject({ ok: false, pending: true });
    expect(h.reports.map((r) => [r.path, r.severity, r.errorName])).toEqual([
      ['ACTIVATION_POLL', 'warning', 'TypeError'],
    ]);
    expect(h.reports[0]?.reference).toMatch(/^verify-linkpay-/);
  });
});

describe('checkout browser key', () => {
  it('reports a key the provider would not mint, and still answers the buyer 502', async () => {
    const reports: ProviderFailureReport[] = [];
    const { routes } = setupCheckoutWorld({
      config: {
        browserKey: async () => {
          throw new ProviderRequestError('alpha', 'alpha 401 Unauthorized', { httpStatus: 401 });
        },
        onProviderFailure: (report) => void reports.push(report),
      },
    });

    const response = await call(routes, 'POST', '/refresh-key', { orderId: 'inv_2024_0043' });

    expect(response.status).toBe(502);
    expect(reports.map((r) => [r.path, r.provider, r.reference, r.httpStatus, r.environment])).toEqual([
      ['BROWSER_KEY', 'alpha', 'inv_2024_0043', 401, 'SANDBOX'],
    ]);
  });
});
