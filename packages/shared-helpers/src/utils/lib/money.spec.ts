import { describe, expect, it } from 'vitest';

import { formatBRL, fromCents, parseBRL, toCents } from './money';
import * as utilsBarrel from '../index';

describe('money utilities', () => {
  describe('formatBRL', () => {
    it('formats 1990 cents into a pt-BR BRL string', () => {
      expect(formatBRL(1990)).toBe('R$ 19,90');
    });

    it('formats zero as R$ 0,00', () => {
      expect(formatBRL(0)).toBe('R$ 0,00');
    });

    it('formats 199 cents as R$ 1,99', () => {
      expect(formatBRL(199)).toBe('R$ 1,99');
    });

    it('formats large values with thousands separators', () => {
      expect(formatBRL(123456789)).toBe('R$ 1.234.567,89');
    });

    it('uses an ASCII space (U+0020), not a non-breaking space (U+00A0)', () => {
      const result = formatBRL(1990);
      expect(result.charCodeAt(2)).toBe(0x20);
      expect(result).not.toContain(String.fromCharCode(0x00a0));
      expect(result).not.toContain(' ');
    });
  });

  describe('toCents / fromCents', () => {
    it('toCents(19.9) returns 1990', () => {
      expect(toCents(19.9)).toBe(1990);
    });

    it('fromCents(1990) returns 19.9', () => {
      expect(fromCents(1990)).toBe(19.9);
    });

    it('round-trips a number to cents and back without floating-point drift', () => {
      expect(fromCents(toCents(19.9))).toBe(19.9);
    });
  });

  describe('parseBRL', () => {
    it("parseBRL('R$ 19,90') returns 1990 cents", () => {
      expect(parseBRL('R$ 19,90')).toBe(1990);
    });
  });

  describe('utils barrel re-export', () => {
    it('exposes formatBRL through the utils barrel', () => {
      expect(utilsBarrel.formatBRL).toBe(formatBRL);
      expect(utilsBarrel.formatBRL(1990)).toBe('R$ 19,90');
    });
  });
});
