import { describe, expect, it } from 'vitest';

import { UnsupportedOperationError } from '../../core/errors';
import type { WebhookDelivery } from '../../core/types';
import { PT_BR_ITAU_COPY } from '../pt-BR';
import { itauProvider, itauTxId, NAME } from '../itau';
import { cardInput, pixInput, STUB_CREDS } from '../../__tests__/fixtures';

const adapter = itauProvider(PT_BR_ITAU_COPY);

describe('itau (stub mode)', () => {
  it('creates a normalized PENDING PIX charge', async () => {
    const snapshot = await adapter.createCharge(pixInput(), STUB_CREDS);
    expect(snapshot).toMatchObject({ provider: NAME, status: 'PENDING', method: 'PIX' });
    expect(snapshot.pix?.qrText).toBeTruthy();
  });

  it('verifies stub credentials as ok with no network call', async () => {
    await expect(adapter.verifyCredentials(STUB_CREDS)).resolves.toMatchObject({ ok: true });
  });

  it('declares PIX-only capabilities — no card, on purpose', () => {
    expect(adapter.capabilities.methods).toEqual(['PIX']);
    expect(adapter.authMode).toBe('credentials');
  });

  it('refuses a CARD charge rather than silently accepting one this bank product cannot take', async () => {
    await expect(adapter.createCharge(cardInput(), STUB_CREDS)).rejects.toBeInstanceOf(UnsupportedOperationError);
  });

  describe('webhook', () => {
    const secretCreds = { environment: 'SANDBOX' as const, fields: { webhookSecret: 'whsec_itau_1' } };

    it('accepts a stub delivery with no secret configured', async () => {
      const delivery: WebhookDelivery = { provider: NAME, rawBody: '{}', headers: {} };
      await expect(adapter.webhook.verify(delivery, STUB_CREDS)).resolves.toBe(true);
    });

    it('rejects a live delivery when no secret is configured (fail closed)', async () => {
      const delivery: WebhookDelivery = { provider: NAME, rawBody: '{}', headers: {} };
      await expect(
        adapter.webhook.verify(delivery, { environment: 'PRODUCTION', fields: {} }),
      ).resolves.toBe(false);
    });

    it('accepts a live delivery whose header matches the configured secret', async () => {
      const delivery: WebhookDelivery = { provider: NAME, rawBody: '{}', headers: { 'x-webhook-secret': 'whsec_itau_1' } };
      await expect(adapter.webhook.verify(delivery, secretCreds)).resolves.toBe(true);
    });

    it('rejects a live delivery whose header does not match', async () => {
      const delivery: WebhookDelivery = { provider: NAME, rawBody: '{}', headers: { 'x-webhook-secret': 'wrong' } };
      await expect(adapter.webhook.verify(delivery, secretCreds)).resolves.toBe(false);
    });

    it('parses a real Itaú pix[] delivery into a normalized CHARGE_UPDATED/PAID event', async () => {
      const delivery: WebhookDelivery = {
        provider: NAME,
        rawBody: JSON.stringify({
          pix: [{ endToEndId: 'E1234', txid: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456', valor: '12.50', horario: '2026-09-22T12:00:00Z' }],
        }),
        headers: {},
      };
      const [event] = await adapter.webhook.parse(delivery, STUB_CREDS);
      expect(event).toMatchObject({
        provider: NAME,
        eventId: 'E1234',
        type: 'CHARGE_UPDATED',
        charge: { status: 'PAID', method: 'PIX', amount: { amountCents: 1250, currency: 'BRL' } },
      });
    });

    it('reads back the txid a delivery names, for reconciliation correlation', () => {
      expect(adapter.referenceOfDelivery?.(JSON.stringify({ pix: [{ txid: 'ABC123' }] }))).toBe('ABC123');
      expect(adapter.referenceOfDelivery?.('not json')).toBeNull();
    });

    it('answers UNKNOWN for a delivery with no pix entries, rather than throwing', async () => {
      const delivery: WebhookDelivery = { provider: NAME, rawBody: JSON.stringify({}), headers: {} };
      const [event] = await adapter.webhook.parse(delivery, STUB_CREDS);
      expect(event?.type).toBe('UNKNOWN');
    });

    it('declares that its own verified delivery IS proof of payment', () => {
      expect(adapter.verifyConfirmsPayment).toBe(true);
    });
  });
});

describe('itauTxId', () => {
  it('strips non-alphanumeric characters and uppercases nothing (case preserved, digits/letters only)', () => {
    expect(itauTxId('order-abc-123-456-789-012-345-678')).toMatch(/^[a-zA-Z0-9]{26,35}$/);
  });

  it('truncates a long alphanumeric reference to 35 chars', () => {
    const long = 'a'.repeat(50);
    expect(itauTxId(long)).toHaveLength(35);
  });

  it('pads a short reference to the 26-char floor, deterministically for the same input', () => {
    const a = itauTxId('order-1');
    const b = itauTxId('order-1');
    expect(a.length).toBeGreaterThanOrEqual(26);
    expect(a).toBe(b);
  });

  it('produces a DIFFERENT txid for two different short references (no collision from padding)', () => {
    expect(itauTxId('order-1')).not.toBe(itauTxId('order-2'));
  });
});
