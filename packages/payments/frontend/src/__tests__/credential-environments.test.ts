import { describe, expect, it } from 'vitest';

import type { ProviderDescriptor } from '@12-apps/payments-backend';

import { appliesIn, credentialsComplete } from '../components/credential-rules';

/**
 * A field that exists in one environment only. A bank's mTLS certificate is a
 * PRODUCTION credential — its sandbox has no mTLS — and the form used to count
 * it everywhere, so a sandbox store with every real field filled was told to
 * "complete the fields to test" and could never run the probe.
 */

const DESCRIPTOR = {
  name: 'pixbank',
  displayName: 'Pix Bank',
  credentialSchema: [
    { key: 'clientId', label: 'Client ID', secret: false, required: true },
    { key: 'certificate', label: 'Certificate', secret: true, required: false, multiline: true, environments: ['PRODUCTION'] },
  ],
} as unknown as ProviderDescriptor;

const CERTIFICATE = DESCRIPTOR.credentialSchema[1]!;

describe('a production-only credential field', () => {
  it('exists in production and not in the sandbox', () => {
    expect(appliesIn(CERTIFICATE, 'PRODUCTION')).toBe(true);
    expect(appliesIn(CERTIFICATE, 'SANDBOX')).toBe(false);
  });

  it('does not hold a sandbox store back from testing', () => {
    expect(credentialsComplete(DESCRIPTOR, null, 'SANDBOX', { clientId: 'c' })).toBe(true);
  });

  it('is still owed in production', () => {
    expect(credentialsComplete(DESCRIPTOR, null, 'PRODUCTION', { clientId: 'c' })).toBe(false);
    expect(credentialsComplete(DESCRIPTOR, null, 'PRODUCTION', { clientId: 'c', certificate: 'PEM' })).toBe(true);
  });
});
