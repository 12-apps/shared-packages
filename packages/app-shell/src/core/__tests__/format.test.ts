/**
 * The two formatters, and the invisible character that made them worth extracting.
 *
 * `Intl` emits a NARROW NO-BREAK SPACE between the symbol and the number in pt-BR.
 * A backend label pre-formatted with an ordinary space and a browser label formatted
 * here then differ by a character nobody can see — which reaches a screenshot diff, a
 * string comparison in a spec, and nothing a reviewer would spot.
 */
import { describe, expect, it } from 'vitest';

import { formatBRL, formatMinutesLabel, formatMoney } from '../format';

describe('formatMoney', () => {
  it('formats minor units as pt-BR BRL by default', () => {
    expect(formatBRL(1990)).toBe('R$ 19,90');
    expect(formatBRL(0)).toBe('R$ 0,00');
    expect(formatBRL(123456)).toBe('R$ 1.234,56');
  });

  it('normalizes the narrow no-break space to an ordinary one', () => {
    const raw = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(19.9);
    // The premise: `Intl` really does emit something other than U+0020 here. If a
    // future ICU stops doing so this assertion fails and the replaceAll can go.
    expect(raw).toContain(' ');
    expect(formatBRL(1990)).not.toContain(' ');
  });

  /**
   * The genericization the extraction added: a currency is a host's fact, not this
   * package's. Asserted rather than assumed, because a `format` argument that was
   * accepted and then ignored would look identical for the default host.
   */
  it('takes the host locale and currency', () => {
    expect(formatMoney(1990, { locale: 'en-US', currency: 'USD' })).toBe('$19.90');
    expect(formatMoney(1990, { currency: 'EUR' })).toContain('€');
  });
});

describe('formatMinutesLabel', () => {
  it('rounds to the nearest minute', () => {
    expect(formatMinutesLabel(600)).toBe('10 min');
    expect(formatMinutesLabel(650)).toBe('11 min');
  });

  /**
   * Never "0 min": a 15-second duration is real, and a reader takes "0 min" for
   * "no delay" — the opposite of what the row is there to say.
   */
  it('never reads as no delay for a duration that exists', () => {
    expect(formatMinutesLabel(15)).toBe('1 min');
    expect(formatMinutesLabel(1)).toBe('1 min');
  });

  it('returns null for unset or zero, so the caller omits the row', () => {
    expect(formatMinutesLabel(0)).toBeNull();
    expect(formatMinutesLabel(null)).toBeNull();
    expect(formatMinutesLabel(undefined)).toBeNull();
  });
});
