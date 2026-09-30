import { execFileSync } from 'node:child_process';

/**
 * Throwaway X.509 identities for the mTLS tests, minted by `openssl` at
 * import time and never written to disk: Node can parse and check a
 * certificate but cannot issue one, and a committed private key — even a
 * test one — is exactly what secret scanners exist to flag.
 */
interface TestIdentity {
  cert: string;
  key: string;
}

export function selfSignedIdentity(commonName: string): TestIdentity {
  const pem = execFileSync(
    'openssl',
    [
      'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
      '-keyout', '-', '-subj', `/CN=${commonName}`, '-addext', `subjectAltName=DNS:${commonName}`, '-days', '1',
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const key = /-----BEGIN PRIVATE KEY-----[\s\S]+?-----END PRIVATE KEY-----\n/.exec(pem)?.[0];
  const cert = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----\n/.exec(pem)?.[0];
  if (!key || !cert) throw new Error('openssl produced no certificate/key pair');
  return { cert, key };
}
