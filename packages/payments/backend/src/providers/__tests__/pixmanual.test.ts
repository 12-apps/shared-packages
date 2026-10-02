import { describe, expect, it } from 'vitest';

import { CredentialsError, UnsupportedOperationError } from '../../core/errors';
import type { ResolvedCredentials } from '../../core/types';
import { allProviderAdapters } from '../catalog';
import { crc16Ccitt } from '../pix-manual/br-code';
import { normalizePixKey, confirmWindowMinutes } from '../pix-manual/fields';
import { EN_US_PIX_MANUAL_COPY } from '../pix-manual/en-US';
import { PT_BR_PIX_MANUAL_COPY } from '../pix-manual/pt-BR';
import { PT_BR_PROVIDER_COPY } from '../pt-BR';
import { pixManualProvider } from '../pixmanual';

/**
 * Pix manual: the store's own key, a static code for the exact amount, and a
 * person who confirms. Nothing here touches a network — stub and live run the
 * same code — so these tests are the adapter's whole behaviour.
 */

const NOW = Date.parse('2026-10-02T12:00:00Z');

function adapter() {
  return pixManualProvider(PT_BR_PIX_MANUAL_COPY, { now: () => NOW });
}

function live(fields: Record<string, string>): ResolvedCredentials {
  return { environment: 'PRODUCTION', fields };
}

const CONFIGURED = { pixKey: 'loja@example.com', merchantName: 'Padaria Boa', merchantCity: 'Recife' };

function pixCharge(reference: string, amountCents = 4250) {
  return {
    reference,
    amount: { amountCents, currency: 'BRL' },
    method: 'PIX' as const,
    customer: {},
  };
}

describe('pixmanual capabilities', () => {
  it('is PIX only, confirmed by hand, with nothing to refund or listen to', () => {
    expect(adapter().capabilities).toMatchObject({
      methods: ['PIX'],
      tokenization: 'NONE',
      confirmation: 'MANUAL',
      refunds: false,
      webhooks: false,
    });
  });

  it('is the only shipped adapter that declares manual confirmation', () => {
    const manual = allProviderAdapters(PT_BR_PROVIDER_COPY).filter((a) => a.capabilities.confirmation !== undefined);
    expect(manual.map((a) => a.name)).toEqual(['pixmanual']);
  });
});

describe('pixmanual createCharge', () => {
  it('builds a static code for the exact amount, with the per-attempt txid, expiring after 30 minutes by default', async () => {
    const snapshot = await adapter().createCharge(pixCharge('order-123--2'), live(CONFIGURED));

    expect(snapshot.status).toBe('PENDING');
    expect(snapshot.providerChargeId).toMatch(/^pixmanual_[a-zA-Z0-9]{1,25}$/);
    expect(snapshot.providerChargeId).not.toBe(snapshot.reference);
    expect(snapshot.pix?.qrText).toContain('0116loja@example.com');
    expect(snapshot.pix?.qrText).toContain('540542.50');
    expect(snapshot.pix?.expiresAt).toBe('2026-10-02T12:30:00.000Z');
    const code = snapshot.pix?.qrText ?? '';
    expect(code.slice(-4)).toBe(crc16Ccitt(code.slice(0, -4)));
  });

  it('honours the store window over the host one', async () => {
    const snapshot = await adapter().createCharge(
      { ...pixCharge('order-1'), pix: { expiresInSeconds: 60 } },
      live({ ...CONFIGURED, confirmWithinMinutes: '120' }),
    );

    expect(snapshot.pix?.expiresAt).toBe('2026-10-02T14:00:00.000Z');
  });

  it('gives two attempts of one order different charge ids', async () => {
    const first = await adapter().createCharge(pixCharge('order-with-a-long-reference-1--1'), live(CONFIGURED));
    const second = await adapter().createCharge(pixCharge('order-with-a-long-reference-1--2'), live(CONFIGURED));

    expect(first.providerChargeId).not.toBe(second.providerChargeId);
  });

  it('never mints a stub_ id, even under stub — a host auto-settles those', async () => {
    const snapshot = await adapter().createCharge(pixCharge('order-1'), { environment: 'SANDBOX', fields: {}, stub: true });

    expect(snapshot.providerChargeId.startsWith('stub_')).toBe(false);
    expect(snapshot.pix?.qrText).toContain('pix-manual@stub.example');
  });

  it('refuses a broken configuration as a credentials problem, so the walk moves on', async () => {
    await expect(adapter().createCharge(pixCharge('order-1'), live({ ...CONFIGURED, pixKey: 'not a key' }))).rejects.toBeInstanceOf(
      CredentialsError,
    );
  });

  it('refuses any method but PIX', async () => {
    await expect(
      adapter().createCharge({ ...pixCharge('order-1'), method: 'CARD' }, live(CONFIGURED)),
    ).rejects.toBeInstanceOf(UnsupportedOperationError);
  });
});

describe('pixmanual reads and voids', () => {
  it('answers PENDING to a read — only the store can say otherwise', async () => {
    await expect(adapter().getCharge('pixmanual_x', live(CONFIGURED))).resolves.toMatchObject({ status: 'PENDING' });
  });

  it('answers CANCELED to a void', async () => {
    await expect(adapter().cancelCharge!('pixmanual_x', live(CONFIGURED))).resolves.toMatchObject({ status: 'CANCELED' });
  });

  it('refuses every inbound webhook, so nobody can forge a confirmation', async () => {
    const delivery = { provider: 'pixmanual', rawBody: '{"status":"PAID"}', headers: {} };
    await expect(adapter().webhook.verify(delivery, live(CONFIGURED))).resolves.toBe(false);
  });
});

describe('pixmanual probe', () => {
  it('passes a complete configuration with one PASS line per field', async () => {
    const outcome = await adapter().verifyCredentials(live(CONFIGURED));

    expect(outcome.ok).toBe(true);
    expect(outcome.checks?.map((c) => [c.key, c.status])).toEqual([
      ['pixKey', 'PASS'],
      ['merchantName', 'PASS'],
      ['merchantCity', 'PASS'],
      ['confirmWithinMinutes', 'PASS'],
    ]);
  });

  it('fails each wrong field by name, without a network call', async () => {
    const outcome = await adapter().verifyCredentials(
      live({ pixKey: '123', merchantName: '', merchantCity: 'A city name too long', confirmWithinMinutes: '2' }),
    );

    expect(outcome).toMatchObject({ ok: false, fault: 'REFUSED', message: PT_BR_PIX_MANUAL_COPY.invalid });
    expect(outcome.checks?.filter((c) => c.status === 'FAIL').map((c) => c.key)).toEqual([
      'pixKey',
      'merchantName',
      'merchantCity',
      'confirmWithinMinutes',
    ]);
  });

  it('speaks the buyer locale it is asked in', async () => {
    const english = pixManualProvider(({ locale }) => (locale === 'en-US' ? EN_US_PIX_MANUAL_COPY : PT_BR_PIX_MANUAL_COPY));
    const outcome = await english.verifyCredentials(live(CONFIGURED), 'en-US');

    expect(outcome.message).toBe(EN_US_PIX_MANUAL_COPY.ready);
  });
});

describe('normalizePixKey', () => {
  it.each([
    ['123.456.789-09', '12345678909'],
    ['12.345.678/0001-95', '12345678000195'],
    ['Loja@Example.com', 'loja@example.com'],
    ['+5581988887777', '+5581988887777'],
    ['123E4567-E12B-12D1-A456-426655440000', '123e4567-e12b-12d1-a456-426655440000'],
  ])('accepts %s as %s', (raw, normalized) => {
    expect(normalizePixKey(raw)).toBe(normalized);
  });

  // An 11-digit number without +55 reads as a CPF — the DICT cannot tell either, so it is accepted as one.
  it.each(['', '123', '8198888777', 'not a key', '+1 555 0100'])('refuses %j', (raw) => {
    expect(normalizePixKey(raw)).toBeNull();
  });
});

describe('confirmWindowMinutes', () => {
  it('defaults a blank to 30 and keeps 5–1440', () => {
    expect(confirmWindowMinutes('')).toBe(30);
    expect(confirmWindowMinutes('5')).toBe(5);
    expect(confirmWindowMinutes('1440')).toBe(1440);
  });

  it('refuses anything outside the range or not a whole number', () => {
    expect(confirmWindowMinutes('4')).toBeNull();
    expect(confirmWindowMinutes('1441')).toBeNull();
    expect(confirmWindowMinutes('30.5')).toBeNull();
  });
});
