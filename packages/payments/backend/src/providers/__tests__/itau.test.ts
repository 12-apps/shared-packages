import { describe, expect, it } from 'vitest';

import { UnsupportedOperationError } from '../../core/errors';
import { cardInput, pixInput, STUB_CREDS } from '../../__tests__/fixtures';
import { itauProvider, itauTxId, NAME } from '../itau';
import { centsFrom, decimalFrom, devedorOf, devolucaoId } from '../itau-pix';
import { PT_BR_ITAU_COPY } from '../pt-BR';

describe('itau (stub mode)', () => {
  it('creates a normalized PENDING PIX charge', async () => {
    const adapter = itauProvider(PT_BR_ITAU_COPY);
    const snapshot = await adapter.createCharge(pixInput(), STUB_CREDS);
    expect(snapshot).toMatchObject({ provider: NAME, status: 'PENDING', method: 'PIX' });
    expect(snapshot.pix?.qrText).toBeTruthy();
  });

  it('verifies stub credentials as ok with no network call', async () => {
    const adapter = itauProvider(PT_BR_ITAU_COPY);
    await expect(adapter.verifyCredentials(STUB_CREDS)).resolves.toMatchObject({ ok: true });
  });

  it('declares PIX-only capabilities — no card, on purpose', () => {
    const adapter = itauProvider(PT_BR_ITAU_COPY);
    expect(adapter.capabilities.methods).toEqual(['PIX']);
    expect(adapter.authMode).toBe('credentials');
  });

  it('refuses a CARD charge rather than silently accepting one this bank product cannot take', async () => {
    const adapter = itauProvider(PT_BR_ITAU_COPY);
    await expect(adapter.createCharge(cardInput(), STUB_CREDS)).rejects.toBeInstanceOf(UnsupportedOperationError);
  });
});

describe('itau contract', () => {
  it('asks for the mTLS certificate AND its private key, and for no webhook secret Itau could never send', () => {
    const schema = itauProvider(PT_BR_ITAU_COPY).credentialSchema;
    const fields = typeof schema === 'function' ? schema({ locale: 'pt-BR' }) : schema;
    expect(fields.map((field) => field.key)).toEqual(['clientId', 'clientSecret', 'certificate', 'privateKey', 'pixKey']);
    expect(fields.filter((field) => field.key === 'certificate' || field.key === 'privateKey').every((field) => field.secret)).toBe(true);
  });

  it('does not claim a delivery proves which reference was paid — the txid is a one-way digest of it', () => {
    const adapter = itauProvider(PT_BR_ITAU_COPY);
    expect(adapter.verifyConfirmsPayment).toBeFalsy();
    expect(adapter.referenceOfDelivery).toBeUndefined();
  });
});

describe('itauTxId', () => {
  it('keeps only letters and digits, within the 26-35 char window', () => {
    expect(itauTxId('order-abc-123-456-789-012-345-678')).toMatch(/^[a-zA-Z0-9]{26,35}$/);
  });

  it('truncates a long alphanumeric reference to 35 chars', () => {
    expect(itauTxId('a'.repeat(50))).toHaveLength(35);
  });

  it('pads a short reference to the 26-char floor, deterministically for the same input', () => {
    const a = itauTxId('order-1');
    expect(a.length).toBeGreaterThanOrEqual(26);
    expect(a).toBe(itauTxId('order-1'));
  });

  it('produces a DIFFERENT txid for two different short references (no collision from padding)', () => {
    expect(itauTxId('order-1')).not.toBe(itauTxId('order-2'));
  });
});

describe('itau Pix money and ids', () => {
  it('parses BACEN decimals into cents exactly, and refuses malformed ones', () => {
    expect(centsFrom('12.50')).toBe(12_50);
    expect(centsFrom('0.07')).toBe(7);
    expect(centsFrom('100.1')).toBe(100_10);
    expect(centsFrom('12,50')).toBeUndefined();
    expect(centsFrom(undefined)).toBeUndefined();
  });

  it('writes cents back as the two-decimal string BACEN takes', () => {
    expect(decimalFrom(1)).toBe('0.01');
    expect(decimalFrom(100_07)).toBe('100.07');
  });

  it('mints devolução ids that are BACEN-valid and distinct per refund on one Pix', () => {
    const first = devolucaoId('E60701190202609301200abcdefghijk', 0);
    expect(first).toMatch(/^[a-zA-Z0-9]{1,35}$/);
    expect(devolucaoId('E60701190202609301200abcdefghijk', 1)).not.toBe(first);
  });

  it('sends a payer only when both halves BACEN requires are present', () => {
    expect(devedorOf(pixInput())).toEqual({ cpf: '12345678909', nome: 'Ana Buyer' });
    expect(devedorOf({ ...pixInput(), customer: { name: 'Ana Buyer' } })).toBeUndefined();
    expect(devedorOf({ ...pixInput(), customer: { name: 'Loja', taxId: '12.345.678/0001-95' } })).toEqual({
      cnpj: '12345678000195',
      nome: 'Loja',
    });
  });
});
