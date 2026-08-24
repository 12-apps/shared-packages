import { describe, expect, it } from 'vitest';

import { DEFAULT_LOCALE, isLocale, LOCALES, matchLocale } from '../core/locale';
import { negotiateLocale, parseAcceptLanguage, resolveLocale } from '../core/negotiate';

describe('the canonical list', () => {
  it('holds the default', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('keeps pt-BR the default while the second language is adopted', () => {
    expect(DEFAULT_LOCALE).toBe('pt-BR');
  });

  it('recognises only its own tags', () => {
    expect(isLocale('pt-BR')).toBe(true);
    expect(isLocale('en-US')).toBe(true);
    expect(isLocale('es-AR')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('matchLocale', () => {
  it('matches exactly, ignoring case', () => {
    expect(matchLocale('pt-br')).toBe('pt-BR');
    expect(matchLocale('EN-US')).toBe('en-US');
  });

  it('matches on language alone', () => {
    expect(matchLocale('pt')).toBe('pt-BR');
    expect(matchLocale('en')).toBe('en-US');
  });

  it('falls back within a language across regions', () => {
    expect(matchLocale('en-GB')).toBe('en-US');
    expect(matchLocale('pt-PT')).toBe('pt-BR');
  });

  it('answers null rather than the default for a language it does not speak', () => {
    expect(matchLocale('es-AR')).toBeNull();
    expect(matchLocale('')).toBeNull();
    expect(matchLocale(null)).toBeNull();
  });
});

describe('parseAcceptLanguage', () => {
  it('ranks by quality, best first', () => {
    expect(parseAcceptLanguage('en;q=0.4, pt-BR;q=0.9, de')).toEqual([
      { tag: 'de', quality: 1 },
      { tag: 'pt-BR', quality: 0.9 },
      { tag: 'en', quality: 0.4 },
    ]);
  });

  it('drops a tag the reader explicitly refused', () => {
    expect(negotiateLocale('de, en;q=0')).toBeNull();
  });

  it('reads an empty or absent header as no preference', () => {
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage('')).toEqual([]);
    expect(parseAcceptLanguage('*')).toEqual([]);
  });
});

describe('resolveLocale', () => {
  it('lets an explicit choice beat every stored preference', () => {
    expect(
      resolveLocale({ explicit: 'en-US', user: 'pt-BR', tenant: 'pt-BR', acceptLanguage: 'pt-BR' }),
    ).toBe('en-US');
  });

  it("lets the reader's own setting beat the tenant's", () => {
    expect(resolveLocale({ user: 'en-US', tenant: 'pt-BR' })).toBe('en-US');
  });

  it('lets the tenant beat the browser guess', () => {
    expect(resolveLocale({ tenant: 'en-US', acceptLanguage: 'pt-BR' })).toBe('en-US');
  });

  it('falls THROUGH an unrecognised candidate instead of stopping at it', () => {
    // The user row holds a stale tag this family does not speak. The tenant's
    // answer must still be reached — resolving to the default here would have
    // the effect of a preference nobody set.
    expect(resolveLocale({ user: 'es-AR', tenant: 'en-US' })).toBe('en-US');
  });

  it('ends at the default when nothing answers', () => {
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocale({ user: null, tenant: undefined, acceptLanguage: 'es-AR' })).toBe(
      DEFAULT_LOCALE,
    );
  });

  it('takes a caller-stated fallback over the package default', () => {
    expect(resolveLocale({}, 'en-US')).toBe('en-US');
  });
});
