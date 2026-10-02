import { describe, expect, it } from 'vitest';

import { crc16Ccitt, sanitizeTxId, staticBrCode } from '../pix-manual/br-code';

/**
 * The static BR Code is what the payer's bank app reads, so a byte out of
 * place is a code no app accepts. Pinned against the Banco Central's own
 * published example and the standard CRC vector, not against itself.
 */

describe('crc16Ccitt', () => {
  it('matches the CRC-16/CCITT-FALSE check value for "123456789"', () => {
    expect(crc16Ccitt('123456789')).toBe('29B1');
  });

  it('pads to four uppercase hex digits', () => {
    expect(crc16Ccitt('')).toBe('FFFF');
  });
});

describe('staticBrCode', () => {
  it('reproduces the Banco Central manual example byte for byte', () => {
    const code = staticBrCode({
      pixKey: '123e4567-e12b-12d1-a456-426655440000',
      merchantName: 'Fulano de Tal',
      merchantCity: 'BRASILIA',
    });

    expect(code).toBe(
      '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D',
    );
  });

  it('carries the amount with two decimal places, and a CRC over everything before it', () => {
    const code = staticBrCode({
      pixKey: 'loja@example.com',
      merchantName: 'Loja',
      merchantCity: 'Recife',
      amountCents: 1205,
      txid: 'pedido123',
    });

    expect(code).toContain('540512.05');
    expect(code).toContain('62130509pedido123');
    expect(code.slice(-4)).toBe(crc16Ccitt(code.slice(0, -4)));
  });

  it('writes cents under a real as 0.xx', () => {
    const code = staticBrCode({ pixKey: 'k@x.com', merchantName: 'L', merchantCity: 'C', amountCents: 7 });

    expect(code).toContain('54040.07');
  });

  it('normalises name and city to unaccented ASCII and clips them to 25 and 15', () => {
    const code = staticBrCode({
      pixKey: 'k@x.com',
      merchantName: 'Padaria São João das Árvores Ltda',
      merchantCity: 'São José dos Campos',
    });

    expect(code).toContain('5925Padaria Sao Joao das Arv');
    expect(code).toContain('6015Sao Jose dos Ca');
  });

  it('refuses a code without key, name or city, and a non-positive or fractional amount', () => {
    const base = { pixKey: 'k@x.com', merchantName: 'L', merchantCity: 'C' };

    expect(() => staticBrCode({ ...base, pixKey: '  ' })).toThrow(RangeError);
    expect(() => staticBrCode({ ...base, merchantName: '\u{1F600}' })).toThrow(RangeError);
    expect(() => staticBrCode({ ...base, merchantCity: '' })).toThrow(RangeError);
    expect(() => staticBrCode({ ...base, amountCents: 0 })).toThrow(RangeError);
    expect(() => staticBrCode({ ...base, amountCents: 12.5 })).toThrow(RangeError);
  });
});

describe('sanitizeTxId', () => {
  it('keeps a reference that is already 1–25 alphanumeric characters', () => {
    expect(sanitizeTxId('ABC123')).toBe('ABC123');
  });

  it('hashes anything else into 25 alphanumeric characters with a readable prefix', () => {
    const txid = sanitizeTxId('order-abc--2');

    expect(txid).toMatch(/^[a-zA-Z0-9]{25}$/);
    expect(txid.startsWith('orderabc2')).toBe(true);
  });

  it('never gives two attempts of one order the same identifier', () => {
    const reference = 'a-very-long-order-reference-that-overflows';

    expect(sanitizeTxId(`${reference}--1`)).not.toBe(sanitizeTxId(`${reference}--2`));
  });

  it('is deterministic', () => {
    expect(sanitizeTxId('order--3')).toBe(sanitizeTxId('order--3'));
  });
});
