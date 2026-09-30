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

  it('needs no activation charge — it takes no card, the only proof the activation flow can run', () => {
    expect(itauProvider(PT_BR_ITAU_COPY).capabilities.activationCharge).toBeFalsy();
  });

  it('finds nothing in stub mode, like every sibling adapter, so a scripted failover moves on', async () => {
    await expect(itauProvider(PT_BR_ITAU_COPY).findChargeByReference?.('order-1', STUB_CREDS)).resolves.toBeNull();
  });

  it('renders the certificate and private key as multi-line fields', () => {
    const schema = itauProvider(PT_BR_ITAU_COPY).credentialSchema;
    const fields = typeof schema === 'function' ? schema({ locale: 'pt-BR' }) : schema;
    expect(fields.filter((field) => field.multiline).map((field) => field.key)).toEqual(['certificate', 'privateKey']);
  });

  it('does not claim a delivery proves which reference was paid — the txid is a hash of it', () => {
    const adapter = itauProvider(PT_BR_ITAU_COPY);
    expect(adapter.verifyConfirmsPayment).toBeFalsy();
    expect(adapter.referenceOfDelivery).toBeUndefined();
  });
});

describe('itauTxId', () => {
  it('is 26-35 letters and digits, whatever the reference looks like', () => {
    for (const reference of ['o', 'order-abc-123', 'a'.repeat(80), 'verify-itau-cmabc123def456ghi789jkl01--lk3j9']) {
      expect(itauTxId(reference)).toMatch(/^[a-zA-Z0-9]{26,35}$/);
    }
  });

  it('is deterministic, so a reference finds the cob it raised', () => {
    expect(itauTxId('order-1')).toBe(itauTxId('order-1'));
  });

  it('keeps two attempts of one long reference apart (the --<attempt> suffix is not cut off)', () => {
    const base = 'verify-itau-cmabc123def456ghi789jkl01';
    expect(itauTxId(`${base}--lk3j9`)).not.toBe(itauTxId(`${base}--lk3ja`));
    expect(itauTxId(base)).not.toBe(itauTxId(`${base}--lk3j9`));
  });

  it('keeps references that differ only in punctuation apart', () => {
    expect(itauTxId('order-12')).not.toBe(itauTxId('order_12'));
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
    expect(() => decimalFrom(10.5)).toThrow(RangeError);
  });

  it('mints devolução ids that are BACEN-valid and distinct per refund on one Pix', () => {
    const first = devolucaoId('E60701190202609301200abcdefghijk', 0);
    expect(first).toMatch(/^[a-zA-Z0-9]{1,35}$/);
    expect(devolucaoId('E60701190202609301200abcdefghijk', 1)).not.toBe(first);
  });

  it('sends a payer only when both halves BACEN requires are present', () => {
    expect(devedorOf(pixInput())).toEqual({ cpf: '12345678909', nome: 'Ana Buyer' });
    expect(devedorOf({ ...pixInput(), customer: { name: 'Ana Buyer' } })).toBeUndefined();
    // A CPF that fails its check digits would make Itau refuse the whole cob.
    expect(devedorOf({ ...pixInput(), customer: { name: 'Ana Buyer', taxId: '12345678900' } })).toBeUndefined();
    expect(devedorOf({ ...pixInput(), customer: { name: 'Loja', taxId: '12.345.678/0001-95' } })).toEqual({
      cnpj: '12345678000195',
      nome: 'Loja',
    });
  });
});
