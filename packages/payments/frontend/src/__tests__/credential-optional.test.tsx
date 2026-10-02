// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { CredentialFieldSpec, ProviderDescriptor } from '@12-apps/payments-backend';

import { CredentialField } from '../components/CredentialFields';
import { credentialsComplete } from '../components/credential-rules';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';
import { cleanup, render, screen } from './settings-test-utils';

/**
 * An `optional` field has a working default the store may leave blank — Pix
 * manual's window to confirm in (blank is 30 minutes). It must not hold the
 * store back from testing, the way every other blank box does, or the probe
 * that would tell the owner the setup works can never run.
 */

const WINDOW: CredentialFieldSpec = {
  key: 'confirmWithinMinutes',
  label: 'Prazo para confirmar (minutos)',
  secret: false,
  required: false,
  optional: true,
};

const DESCRIPTOR = {
  name: 'manualpix',
  displayName: 'Manual Pix',
  credentialSchema: [{ key: 'pixKey', label: 'Chave Pix', secret: false, required: true }, WINDOW],
} as unknown as ProviderDescriptor;

describe('an optional credential field', () => {
  it('does not hold the store back from testing when left blank', () => {
    expect(credentialsComplete(DESCRIPTOR, null, 'SANDBOX', { pixKey: 'loja@example.com' })).toBe(true);
  });

  it('still leaves the other fields owed', () => {
    expect(credentialsComplete(DESCRIPTOR, null, 'SANDBOX', {})).toBe(false);
  });
});

describe('the optional field on the form', () => {
  afterEach(() => cleanup());

  it('says "opcional", never the platform-only suffix an advanced field carries', () => {
    render(<CredentialField spec={WINDOW} state={undefined} value="" onChange={() => undefined} />);

    const label = screen.getByText(WINDOW.label).closest('label');
    expect(label?.textContent).toContain(PT_BR_PAYMENTS_SETTINGS_COPY.credentials.optionalSuffix.trim());
    expect(label?.textContent).not.toContain(PT_BR_PAYMENTS_SETTINGS_COPY.credentials.advancedSuffix.trim());
  });
});
