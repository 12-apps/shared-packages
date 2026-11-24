// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { authenticateRealDebit, REAL_DEBIT_THREEDS_TIMEOUT_MS } from '../components/platform/production-evidence-data';

/**
 * FUT-5519: a real debit's 3-D Secure waited on PagBank's SDK with no limit,
 * so an SDK that never answered held the production run on "Criptografando"
 * for as long as the page stayed open. The wait is now bounded: past it the
 * debit is recorded as not authenticated and the run goes on.
 */

afterEach(() => {
  vi.useRealTimers();
  delete (window as { PagSeguro?: unknown }).PagSeguro;
});

const CARD = { number: '5555666677778884', expMonth: '12', expYear: '2030', securityCode: '123' };
const SESSION = { session: 'sess-1', expiresAt: Date.UTC(2030, 0, 1), environment: 'PRODUCTION' as const };
const TEST = {
  amountCents: 100,
  customer: { name: 'Comprador Teste', email: 'comprador@example.com', phone: '+55 31 99999-0000' },
  billingAddress: { street: 'Rua Teste', number: '1', regionCode: 'MG', city: 'Belo Horizonte', postalCode: '31610-000' },
};

describe('a real debit card waits on 3-D Secure for a bounded time', () => {
  it('gives up once the limit passes, and records the debit as not authenticated', async () => {
    vi.useFakeTimers();
    (window as { PagSeguro?: unknown }).PagSeguro = {
      encryptCard: vi.fn(() => ({ hasErrors: false, encryptedCard: 'ENC' })),
      setUp: vi.fn(),
      // The bank never answers.
      authenticate3DS: vi.fn(() => new Promise(() => undefined)),
    };

    const pending = authenticateRealDebit(CARD, 'Comprador Teste', 'PUBKEY', SESSION, TEST as never);
    await vi.advanceTimersByTimeAsync(REAL_DEBIT_THREEDS_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({ scenario: 'debit', encrypted: 'ENC', failure: 'THREEDS_FAILED' });
  });
});
