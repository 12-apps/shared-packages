import { describe, expect, it } from 'vitest';

import { APPLE_PAY_GATEWAY_HOSTS, applePayValidationUrl } from '../gateway-hosts';
import { applePayDomain } from '../validate';

/**
 * The validation URL comes from the browser and the server presents the
 * merchant identity certificate to whatever host it names — so every way of
 * smuggling another host past an Apple-looking string must miss.
 */
describe('applePayValidationUrl', () => {
  it.each([...APPLE_PAY_GATEWAY_HOSTS])('accepts https on the published host %s', (host) => {
    expect(applePayValidationUrl(`https://${host}/paymentservices/startSession`)?.hostname).toBe(host);
  });

  it('normalizes case and the default port, so the checked URL is the dialled one', () => {
    const url = applePayValidationUrl('HTTPS://Apple-Pay-Gateway.APPLE.com:443/paymentservices/paymentSession');
    expect(url?.href).toBe('https://apple-pay-gateway.apple.com/paymentservices/paymentSession');
  });

  it.each([
    ['a suffix', 'https://apple-pay-gateway.apple.com.evil.com/paymentservices/startSession'],
    ['a prefix', 'https://evilapple-pay-gateway.apple.com/paymentservices/startSession'],
    ['a sibling Apple host', 'https://www.apple.com/paymentservices/startSession'],
    ['the per-pod hosts Apple no longer lists', 'https://apple-pay-gateway-nc-pod1.apple.com/paymentservices/startSession'],
    ['a trailing dot', 'https://apple-pay-gateway.apple.com./paymentservices/startSession'],
    ['the http scheme', 'http://apple-pay-gateway.apple.com/paymentservices/startSession'],
    ['another scheme', 'ftp://apple-pay-gateway.apple.com/paymentservices/startSession'],
    ['userinfo naming the Apple host', 'https://apple-pay-gateway.apple.com@evil.com/paymentservices/startSession'],
    ['userinfo on the Apple host', 'https://user:pass@apple-pay-gateway.apple.com/paymentservices/startSession'],
    ['a backslash authority trick', 'https://evil.com\\@apple-pay-gateway.apple.com/paymentservices/startSession'],
    ['a non-default port', 'https://apple-pay-gateway.apple.com:8443/paymentservices/startSession'],
    ['port 80 on https', 'https://apple-pay-gateway.apple.com:80/paymentservices/startSession'],
    ['an IP literal', 'https://17.171.78.7/paymentservices/startSession'],
    ['a relative path', '/paymentservices/startSession'],
    ['garbage', 'not a url'],
    ['an empty string', ''],
    ['an over-long string', `https://apple-pay-gateway.apple.com/${'a'.repeat(3000)}`],
  ])('refuses %s', (_case, raw) => {
    expect(applePayValidationUrl(raw)).toBeNull();
  });

  it.each([undefined, null, 42, { href: 'https://apple-pay-gateway.apple.com/' }])('refuses a non-string (%s)', (raw) => {
    expect(applePayValidationUrl(raw)).toBeNull();
  });
});

describe('applePayDomain', () => {
  it('accepts a bare FQDN, lower-cased', () => {
    expect(applePayDomain('Loja.Example.com.br')).toBe('loja.example.com.br');
  });

  it.each([
    'https://loja.example.com',
    'loja.example.com:443',
    'loja.example.com/path',
    'loja.example.com.',
    'localhost',
    '-bad.example.com',
    'a..example.com',
    '',
  ])('refuses %s', (raw) => {
    expect(applePayDomain(raw)).toBeNull();
  });
});
