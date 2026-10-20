import { describe, expect, it, vi } from 'vitest';

import type { PaymentProviderAdapter } from '../../core/provider';
import { defineProviders } from '../../core/registry';
import type { ResolvedCredentials } from '../../core/types';
import { applePayEnrolmentFor } from '../enrolment';

/** FUT-3757 — the `.csr`/`.cer` round trip runs on the merchant's own credentials. */

const SELLER = { kind: 'TENANT', id: 'seller-1' } as const;
const CREDENTIALS = { provider: 'stubpay', accessToken: 'seller-token' } as unknown as ResolvedCredentials;

type ApplePayRoundTrip = PaymentProviderAdapter['applePay'];

function adapterWith(applePay?: ApplePayRoundTrip): PaymentProviderAdapter {
  return { capabilities: {}, ...(applePay ? { applePay } : {}) } as unknown as PaymentProviderAdapter;
}

function deps(adapter: PaymentProviderAdapter, connected = true) {
  return {
    providers: defineProviders({ stubpay: adapter }),
    credentials: { getCredentials: vi.fn(async () => (connected ? CREDENTIALS : null)) },
  };
}

describe('applePayEnrolmentFor', () => {
  it("runs both steps with the merchant's credentials", async () => {
    const requestCsr = vi.fn(async () => ({ csr: 'CSR' }));
    const activateCertificate = vi.fn(async () => ({ status: 'ACTIVE' }));
    const applePay = { requestCsr, activateCertificate } as unknown as ApplePayRoundTrip;
    const enrolment = await applePayEnrolmentFor(deps(adapterWith(applePay)), SELLER, 'stubpay');

    expect(await enrolment?.requestCsr()).toEqual({ csr: 'CSR' });
    expect(await enrolment?.activateCertificate('CER')).toEqual({ status: 'ACTIVE' });
    expect(requestCsr).toHaveBeenCalledWith(CREDENTIALS);
    expect(activateCertificate).toHaveBeenCalledWith('CER', CREDENTIALS);
  });

  it('answers null for a provider with no round trip, an unknown provider, or a merchant not connected', async () => {
    const applePay = { requestCsr: vi.fn(), activateCertificate: vi.fn() } as unknown as ApplePayRoundTrip;
    expect(await applePayEnrolmentFor(deps(adapterWith()), SELLER, 'stubpay')).toBeNull();
    expect(await applePayEnrolmentFor(deps(adapterWith(applePay)), SELLER, 'other')).toBeNull();
    expect(await applePayEnrolmentFor(deps(adapterWith(applePay), false), SELLER, 'stubpay')).toBeNull();
  });
});
