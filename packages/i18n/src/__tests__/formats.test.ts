import { describe, expect, it } from 'vitest';

import { createFormats, EMPTY } from '../core/formats';

/**
 * Built per call, not once at module scope: `Intl` formatters are immutable, but
 * the flakiness lane forbids shared state in a suite on principle and a helper
 * costs nothing here.
 */
const ptBR = () => createFormats({ locale: 'pt-BR', currency: 'BRL' });
const enUS = () => createFormats({ locale: 'en-US', currency: 'BRL' });

/** `Intl` puts a non-breaking space after `R$`; assertions compare on it. */
const normalize = (value: string) => value.replaceAll(' ', ' ');

describe('money', () => {
  it('writes the same currency the way each reader expects', () => {
    expect(normalize(ptBR().money(123456))).toBe('R$ 1.234,56');
    expect(normalize(enUS().money(123456))).toBe('R$1,234.56');
  });

  it('keeps the currency independent of the language', () => {
    // An English-reading admin of a Brazilian store still sees BRL. If this
    // ever reads USD, the formatter has guessed a currency from a language.
    expect(normalize(enUS().money(100))).toContain('R$');
  });

  it('renders nothing as the shared dash', () => {
    expect(ptBR().money(null)).toBe(EMPTY);
    expect(ptBR().money(undefined)).toBe(EMPTY);
  });
});

describe('percent', () => {
  it('reads basis points', () => {
    expect(ptBR().percent(1250)).toBe('12,5%');
    expect(enUS().percent(1250)).toBe('12.5%');
  });
});

describe('date', () => {
  it('reads a calendar date in UTC, so no reader sees the day before', () => {
    // Midnight UTC. Formatted in a zone west of Greenwich this is the 9th.
    expect(ptBR().date('2026-03-10T00:00:00.000Z')).toBe('10/03/2026');
    expect(enUS().date('2026-03-10T00:00:00.000Z')).toBe('3/10/2026');
  });

  it('hands back an unparseable value rather than inventing one', () => {
    expect(ptBR().date('not-a-date')).toBe('not-a-date');
    expect(ptBR().date(null)).toBe(EMPTY);
  });
});

describe('dateTime', () => {
  it('renders an instant in the stated zone', () => {
    const utc = createFormats({ locale: 'pt-BR', currency: 'BRL', timeZone: 'UTC' });
    expect(utc.dateTime('2026-03-10T15:30:00.000Z')).toContain('15:30');
  });
});

describe('what the operator typed', () => {
  it('reads each locale own notation', () => {
    expect(ptBR().parseDecimal('1.234,56')).toBe(1234.56);
    expect(enUS().parseDecimal('1,234.56')).toBe(1234.56);
  });

  it('writes a number back the way they would type it', () => {
    expect(ptBR().toInput(12.5)).toBe('12,5');
    expect(enUS().toInput(12.5)).toBe('12.5');
  });

  it('answers null for blank or unreadable input', () => {
    expect(ptBR().parseDecimal('   ')).toBeNull();
    expect(ptBR().parseDecimal('abc')).toBeNull();
  });

  it('exposes the separator an input mask needs', () => {
    expect(ptBR().decimalSeparator).toBe(',');
    expect(enUS().decimalSeparator).toBe('.');
  });
});

describe('a malformed number', () => {
  it('is rejected rather than half-read', () => {
    // `replace` (first match only) would normalize "1,2,3" to "1.2,3" and read
    // it as 1.2 — accepting half of an input that means nothing.
    expect(ptBR().parseDecimal('1,2,3')).toBeNull();
    expect(enUS().parseDecimal('1.2.3')).toBeNull();
  });
});
