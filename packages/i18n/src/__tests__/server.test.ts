import { describe, expect, it } from 'vitest';

import { localeFromRequest } from '../server/index';

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe('localeFromRequest', () => {
  it('takes an explicit choice off the URL first', () => {
    expect(
      localeFromRequest(
        request('https://example.test/?lang=en-US', {
          cookie: 'locale=pt-BR',
          'accept-language': 'pt-BR',
        }),
      ),
    ).toBe('en-US');
  });

  it('takes the remembered cookie over the browser guess', () => {
    expect(
      localeFromRequest(
        request('https://example.test/', {
          cookie: 'session=abc; locale=en-US; theme=dark',
          'accept-language': 'pt-BR',
        }),
      ),
    ).toBe('en-US');
  });

  it('falls back to Accept-Language', () => {
    expect(
      localeFromRequest(request('https://example.test/', { 'accept-language': 'en-GB,en;q=0.9' })),
    ).toBe('en-US');
  });

  it('answers null when the request names no language it speaks', () => {
    expect(localeFromRequest(request('https://example.test/'))).toBeNull();
    expect(
      localeFromRequest(request('https://example.test/', { 'accept-language': 'es-AR' })),
    ).toBeNull();
  });

  it('falls THROUGH an unrecognised explicit tag to the cookie', () => {
    expect(
      localeFromRequest(
        request('https://example.test/?lang=es-AR', { cookie: 'locale=en-US' }),
      ),
    ).toBe('en-US');
  });

  it('can be told to ignore the header entirely', () => {
    expect(
      localeFromRequest(request('https://example.test/', { 'accept-language': 'en-US' }), {
        acceptLanguage: false,
      }),
    ).toBeNull();
  });

  it('takes host-chosen names for the parameter and the cookie', () => {
    expect(
      localeFromRequest(request('https://example.test/?idioma=en-US'), { queryParam: 'idioma' }),
    ).toBe('en-US');
  });
});
