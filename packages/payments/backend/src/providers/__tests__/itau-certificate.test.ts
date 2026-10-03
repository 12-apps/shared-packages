import { X509Certificate } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { itauCertificateExpiry } from '../itau-http';
import { selfSignedIdentity } from './pki';

/**
 * The production certificate's `validTo`, read for the expiry warning: what
 * the screen counts the 30-day renewal window down from.
 */

describe('itauCertificateExpiry', () => {
  it('answers the certificate’s own validTo as an ISO instant', () => {
    const { cert } = selfSignedIdentity('expiry');

    expect(itauCertificateExpiry({ certificate: cert })).toBe(new Date(new X509Certificate(cert).validTo).toISOString());
  });

  it('reads a paste whose newlines were folded into spaces', () => {
    const { cert } = selfSignedIdentity('expiry');

    expect(itauCertificateExpiry({ certificate: cert.replace(/\n/g, ' ') })).toBe(
      new Date(new X509Certificate(cert).validTo).toISOString(),
    );
  });

  it('answers null when no certificate is saved — the sandbox has none', () => {
    expect(itauCertificateExpiry({ clientId: 'c', clientSecret: 's', pixKey: 'k' })).toBeNull();
    expect(itauCertificateExpiry({ certificate: '   ' })).toBeNull();
  });

  it('answers null for a paste it cannot read, leaving that to verifyCredentials to name', () => {
    expect(itauCertificateExpiry({ certificate: '-----BEGIN CERTIFICATE-----\nnot a cert\n-----END CERTIFICATE-----' })).toBeNull();
  });
});
