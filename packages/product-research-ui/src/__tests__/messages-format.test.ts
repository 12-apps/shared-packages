import { describe, expect, it } from 'vitest';

import { formatCentsBRL, redactQueryStrings } from '../format';
import { DEFAULT_MESSAGES, resolveMessages } from '../messages';

describe('resolveMessages', () => {
  it('returns the pt-BR defaults untouched with no overrides', () => {
    expect(resolveMessages()).toBe(DEFAULT_MESSAGES);
  });

  it('folds overrides over the defaults without losing the rest', () => {
    const merged = resolveMessages({ formSubmit: 'Search prices' });
    expect(merged.formSubmit).toBe('Search prices');
    expect(merged.formTitle).toBe(DEFAULT_MESSAGES.formTitle);
    expect(merged.statusOk(3)).toBe('3 oferta(s)');
  });
});

describe('formatCentsBRL', () => {
  it('formats cents as pt-BR currency with a plain space', () => {
    expect(formatCentsBRL(4290)).toBe('R$ 42,90');
    expect(formatCentsBRL(123456)).toBe('R$ 1.234,56');
  });
});

/**
 * The render-time pass over a stored reason. Its whole reason for existing is
 * LEGACY text — runs recorded before the engine started stripping — so it has to
 * be at least as strong as the engine's `diagnosticUrl`, which rebuilds from
 * origin + pathname and therefore drops userinfo as well as the query.
 */
describe('redactQueryStrings', () => {
  it('strips a query string but keeps the endpoint, which is the diagnostic part', () => {
    expect(
      redactQueryStrings(
        'VTEX catalog search unreachable: ' +
          'https://www.atacadao.com.br/api/catalog_system/pub/products/search?ft=coca%20cola',
      ),
    ).toBe(
      'VTEX catalog search unreachable: ' +
        'https://www.atacadao.com.br/api/catalog_system/pub/products/search',
    );
  });

  it('strips URL credentials, which a source URL is allowed to carry', () => {
    // `publicUrlViolation` only vets scheme/hostname/address, so a tenant CAN
    // save `https://user:token@store/`. Cutting at `?` alone left the token on
    // screen in the reason line, the tooltip and the a11y description.
    expect(
      redactQueryStrings(
        'VTEX catalog search unreachable: ' +
          'https://user:tok3n@www.loja.com.br/api/catalog_system/pub/products/search?ft=coca',
      ),
    ).toBe(
      'VTEX catalog search unreachable: ' +
        'https://www.loja.com.br/api/catalog_system/pub/products/search',
    );
  });

  it('strips a fragment, and leaves text with nothing to redact byte-for-byte', () => {
    expect(redactQueryStrings('foi em https://loja.com.br/a#tok=1 agora')).toBe(
      'foi em https://loja.com.br/a agora',
    );
    const clean = 'a loja recusou nosso acesso. Endereço: https://www.loja.com.br/api/x';
    expect(redactQueryStrings(clean)).toBe(clean);
  });

  it('never leaves credentials behind when the URL will not parse', () => {
    // No host at all — `new URL` throws, so the textual fallback has to strip
    // both halves rather than cutting at `?` and stopping.
    const redacted = redactQueryStrings('falhou: https://user:tok3n@?k=1');
    expect(redacted).not.toContain('tok3n');
    expect(redacted).not.toContain('k=1');
  });
});
