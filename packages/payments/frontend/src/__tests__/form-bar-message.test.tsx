// @vitest-environment jsdom
import { cleanup, render, screen } from './settings-test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { ProviderForm } from '../components/ProviderCredentialForm';
import { EN_US_PAYMENTS_SETTINGS_COPY } from '../components/settings-en-US';
import { PaymentsSettingsCopyProvider } from '../components/settings-copy-context';
import { PT_BR_PAYMENTS_SETTINGS_COPY } from '../components/settings-pt-BR';

/**
 * The sentence beside a save that will not test yet (FUT-4144 UI review).
 *
 * "Guardamos o que você já preencheu" is a claim that something is on record.
 * On a form nothing has ever been saved from it is false, and it is the first
 * sentence an owner reads on the screen. With nothing stored for the
 * environment on screen the bar says only what is left to do.
 */

const DESCRIPTOR = {
  name: 'acme',
  displayName: 'Acme',
  authMode: 'credentials',
  credentialSchema: [
    { key: 'token', label: 'Token', secret: true, required: true },
    { key: 'account', label: 'Conta', secret: false, required: true },
  ],
} as unknown as ProviderDescriptor;

function configWith(sandbox: Record<string, { configured: boolean; hint: string }>): MaskedProviderConfig {
  return {
    provider: 'acme',
    status: 'UNVERIFIED',
    enabled: false,
    chargeVerifiedAt: null,
    environment: 'SANDBOX',
    environments: { SANDBOX: sandbox, PRODUCTION: {} },
  } as unknown as MaskedProviderConfig;
}

function barText(config: MaskedProviderConfig, copy = PT_BR_PAYMENTS_SETTINGS_COPY): string {
  render(
    <PaymentsSettingsCopyProvider copy={copy}>
      <ProviderForm
        descriptor={DESCRIPTOR}
        config={config}
        client={{ saveCredentials: vi.fn(), verify: vi.fn() } as unknown as PaymentsSettingsClient}
        environment="SANDBOX"
        editing={false}
        onEditingChange={() => undefined}
        onSaved={() => undefined}
      />
    </PaymentsSettingsCopyProvider>,
  );
  return screen.getByTestId('payments-form-bar').firstElementChild?.textContent ?? '';
}

afterEach(cleanup);

describe('the save bar on an incomplete form', () => {
  it('says only what is left to do when nothing is stored', () => {
    expect(barText(configWith({}))).toBe('Complete os campos para testar.');
  });

  it('says so in English too', () => {
    expect(barText(configWith({}), EN_US_PAYMENTS_SETTINGS_COPY)).toBe('Complete the fields to test.');
  });

  it("keeps the old sentence for a host's copy pack without the fresh one", () => {
    const credentials = { ...PT_BR_PAYMENTS_SETTINGS_COPY.credentials };
    delete credentials.probeIncompleteFreshNote;
    const pack = { ...PT_BR_PAYMENTS_SETTINGS_COPY, credentials };
    expect(barText(configWith({}), pack)).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.credentials.probeIncompleteNote);
  });

  it('still says what it kept once something is stored', () => {
    const partial = configWith({ token: { configured: true, hint: '••••42' } });
    expect(barText(partial)).toBe(PT_BR_PAYMENTS_SETTINGS_COPY.credentials.probeIncompleteNote);
  });
});
