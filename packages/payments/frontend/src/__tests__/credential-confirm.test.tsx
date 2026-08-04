// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaskedProviderConfig, ProviderDescriptor } from '@12-apps/payments-backend';

import type { PaymentsSettingsClient } from '../client';
import { ProviderForm } from '../components/ProviderCredentialForm';
import { statusBadge } from '../components/ProviderStatusBar';

// jest-dom is not a dependency here — assert DOM properties directly.

/**
 * The last look at the value that decides who gets paid, and the words the
 * screen uses for how far a store has actually got.
 *
 * Both exist because of the same mistake in two forms: a screen saying more
 * than it can back. `VERIFIED` was a claim about credentials authenticating,
 * read by owners as "my store can take money"; and Salvar wrote an InfiniteTag
 * — one unchecksummed string that routes every payment the store will ever
 * receive — with no more ceremony than a display name.
 */

const DESCRIPTOR = {
  name: 'infinitepay',
  displayName: 'InfinitePay',
  authMode: 'credentials',
  credentialSchema: [
    {
      key: 'handle',
      label: 'InfiniteTag ($usuario)',
      secret: false,
      required: true,
      mono: true,
      confirmOnSave: true,
    },
  ],
} as unknown as ProviderDescriptor;

function configWith(hint: string | null, status = 'UNVERIFIED'): MaskedProviderConfig {
  return {
    provider: 'infinitepay',
    status,
    enabled: false,
    chargeVerifiedAt: null,
    environment: 'SANDBOX',
    environments: {
      SANDBOX: hint ? { handle: { configured: true, hint } } : {},
      PRODUCTION: {},
    },
  } as unknown as MaskedProviderConfig;
}

function fakeClient(): PaymentsSettingsClient {
  return {
    baseUrl: '/api/admin/acme/payments',
    saveCredentials: vi.fn().mockResolvedValue(configWith('$loja')),
    verify: vi.fn(),
  } as unknown as PaymentsSettingsClient;
}

/**
 * `editing` is owned by the PANEL in the real screen — reopening a finished
 * step also has to take step 3 off the page — so the harness plays that part.
 */
function Harness({
  config,
  client,
}: {
  config: MaskedProviderConfig | null;
  client: PaymentsSettingsClient;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <ProviderForm
      descriptor={DESCRIPTOR}
      config={config}
      client={client}
      environment="SANDBOX"
      editing={editing}
      onEditingChange={setEditing}
      onSaved={() => undefined}
    />
  );
}

function renderForm(config: MaskedProviderConfig | null, client = fakeClient()) {
  render(<Harness config={config} client={client} />);
  return client;
}

afterEach(cleanup);

describe('saving a credential that decides where the money goes', () => {
  it('quotes the new value back before writing it', async () => {
    const client = renderForm(configWith(null));

    fireEvent.change(screen.getByLabelText(/^InfiniteTag/), { target: { value: '$loja-nova' } });
    fireEvent.click(screen.getByTestId('payments-save'));

    // Nothing is written while the question is open — the point is the reading,
    // and a dialog that appears after the write would be decoration.
    expect(screen.getByTestId('payments-confirm-credential-value').textContent).toBe('$loja-nova');
    expect(client.saveCredentials).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('payments-confirm-credential-confirm'));
    await waitFor(() => expect(client.saveCredentials).toHaveBeenCalled());
  });

  it('lets the owner back out without writing anything', async () => {
    const client = renderForm(configWith(null));

    fireEvent.change(screen.getByLabelText(/^InfiniteTag/), { target: { value: '$errada' } });
    fireEvent.click(screen.getByTestId('payments-save'));
    fireEvent.click(screen.getByTestId('payments-confirm-credential-cancel'));

    await waitFor(() =>
      expect(screen.queryByTestId('payments-confirm-credential-value')).toBeNull(),
    );
    expect(client.saveCredentials).not.toHaveBeenCalled();
  });

  /**
   * The exemption that keeps the dialog meaningful.
   *
   * Re-typing the value already stored cannot introduce a wrong one, so there
   * is nothing to re-read. Asking anyway would train the owner to click through
   * it, which is the one way to make a confirmation useless on the occasion it
   * matters.
   */
  it('does not ask when the value is not changing', async () => {
    const client = renderForm(configWith('$loja'));

    const field = screen.getByLabelText(/^InfiniteTag/);
    fireEvent.change(field, { target: { value: '$loj' } });
    fireEvent.change(field, { target: { value: '$loja' } });
    fireEvent.click(screen.getByTestId('payments-save'));

    await waitFor(() => expect(client.saveCredentials).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByTestId('payments-confirm-credential-value')).toBeNull(),
    );
  });

  /**
   * A finished step is a line, not a form. Leaving the field editable meant the
   * value that routes the store's money sat one stray keystroke from changing,
   * in front of an owner who had come back to check something else.
   */
  it('folds a proven-connection credential into a summary row', async () => {
    renderForm(configWith('$loja', 'VERIFIED'));

    const summary = await screen.findByTestId('payments-credential-summary');
    expect(summary.textContent).toContain('$loja');
    await waitFor(() => expect(screen.queryByLabelText(/^InfiniteTag/)).toBeNull());

    fireEvent.click(screen.getByTestId('payments-credential-summary-edit'));
    expect(await screen.findByLabelText(/^InfiniteTag/)).toBeTruthy();
  });
});

/**
 * Three different facts used to share one word, and the green one was the
 * least earned. `VERIFIED` comes from the credential probe: PagBank answers
 * yes to it while refusing every charge until homologação, and InfinitePay
 * answers yes with Checkout Integrado switched off, which mints no links at
 * all. Only `chargeVerifiedAt` is a payment that actually landed.
 */
describe('what the status chip is allowed to claim', () => {
  it('separates reaching the account from being able to charge', () => {
    expect(statusBadge(null).label).toBe('NÃO VERIFICADO');
    expect(statusBadge(configWith('$loja')).label).toBe('NÃO VERIFICADO');

    const probed = statusBadge(configWith('$loja', 'VERIFIED'));
    expect(probed.label).toBe('CONEXÃO OK');
    expect(probed.color).not.toBe('success');

    const paid = {
      ...configWith('$loja', 'VERIFIED'),
      chargeVerifiedAt: '2026-07-30T12:00:00.000Z',
    } as MaskedProviderConfig;
    expect(statusBadge(paid)).toEqual({ label: 'VERIFICADO', color: 'success' });
  });

  it('says RECONECTAR rather than a bare failure when a grant lapsed', () => {
    expect(statusBadge(configWith('$loja', 'RECONNECT_REQUIRED')).label).toBe('RECONECTAR');
    // A failed probe is NOT a third state: the store cannot take money yet,
    // which is what NÃO VERIFICADO already says. The probe's own sentence
    // beneath the chip is what names the tag and the fix.
    expect(statusBadge(configWith('$loja', 'FAILED')).label).toBe('NÃO VERIFICADO');
  });
});
