// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ConnectApplicationReport,
  ConnectApplicationStatus,
} from '@12-apps/payments-backend';

import { ConnectApplicationPanel } from '../components/platform/ConnectApplicationPanel';

/**
 * The Connect-application panel (FUT-479, packaged by FUT-573). What the
 * pixels must get right: each environment stands on its own card, the
 * mismatch verdict has THREE honest states (mismatch / match / unknown — the
 * consult schema is undocumented, so absence must never render as "confere"),
 * and the host's config help appears only when the host supplies it.
 *
 * jest-dom is not a dependency here, so DOM properties are asserted directly.
 */

const EXPECTED = 'https://app.example.com/api/payments/oauth/callback/pagbank';

function status(over: Partial<ConnectApplicationStatus>): ConnectApplicationStatus {
  return {
    environment: 'SANDBOX',
    configured: false,
    clientId: null,
    application: null,
    redirectUriMismatch: null,
    error: null,
    ...over,
  };
}

function report(environments: ConnectApplicationStatus[]): ConnectApplicationReport {
  return { provider: 'pagbank', expectedRedirectUri: EXPECTED, environments };
}

const APPLICATION = {
  name: 'Aurora Plataforma',
  description: null,
  site: 'https://app.example.com',
  redirectUri: `${EXPECTED}/`,
  logo: null,
  extra: {},
};

afterEach(cleanup);

describe('ConnectApplicationPanel', () => {
  it('shows the expected callback and one card per environment', () => {
    render(
      <ConnectApplicationPanel
        report={report([
          status({ environment: 'SANDBOX' }),
          status({ environment: 'PRODUCTION' }),
        ])}
      />,
    );

    expect(screen.getByTestId('connect-expected-redirect').textContent).toContain(EXPECTED);
    expect(screen.getByTestId('connect-env-SANDBOX').textContent).toContain(
      'No application configured in this environment.',
    );
    expect(screen.getByTestId('connect-env-PRODUCTION').textContent).toContain(
      'No application configured in this environment.',
    );
  });

  it('flags a mismatch loudly, with the registered value on display', () => {
    render(
      <ConnectApplicationPanel
        report={report([
          status({
            environment: 'SANDBOX',
            configured: true,
            clientId: 'app-123',
            application: APPLICATION,
            redirectUriMismatch: true,
          }),
        ])}
      />,
    );

    expect(screen.getByTestId('connect-mismatch-SANDBOX').textContent).toContain(
      'differs from the callback this deployment uses',
    );
    expect(screen.getByTestId('connect-env-SANDBOX').textContent).toContain(`${EXPECTED}/`);
    expect(screen.getByTestId('connect-env-SANDBOX').textContent).toContain(
      'client_id: app-123',
    );
  });

  it('confirms a byte-identical registration as matching', () => {
    render(
      <ConnectApplicationPanel
        report={report([
          status({
            environment: 'PRODUCTION',
            configured: true,
            application: { ...APPLICATION, redirectUri: EXPECTED },
            redirectUriMismatch: false,
          }),
        ])}
      />,
    );

    expect(screen.getByTestId('connect-match-PRODUCTION').textContent).toContain('matches');
  });

  it('renders the unknown verdict when the response named no redirect URI', async () => {
    render(
      <ConnectApplicationPanel
        report={report([
          status({
            environment: 'SANDBOX',
            configured: true,
            application: { ...APPLICATION, redirectUri: null },
            redirectUriMismatch: null,
          }),
        ])}
      />,
    );

    // Never "confere": the schema is undocumented, absence is not a match.
    expect(screen.getByTestId('connect-unknown-SANDBOX').textContent).toContain(
      'carried no redirect_uri',
    );
    await waitFor(() => {
      expect(screen.queryByTestId('connect-match-SANDBOX')).toBeNull();
    });
  });

  it('surfaces a consult failure on its own environment only', async () => {
    render(
      <ConnectApplicationPanel
        report={report([
          status({
            environment: 'SANDBOX',
            configured: true,
            error: 'O PagBank respondeu 403 ao consultar a aplicação',
          }),
          status({
            environment: 'PRODUCTION',
            configured: true,
            application: { ...APPLICATION, redirectUri: EXPECTED },
            redirectUriMismatch: false,
          }),
        ])}
      />,
    );

    expect(screen.getByTestId('connect-error-SANDBOX').textContent).toContain('403');
    await waitFor(() => {
      expect(screen.queryByTestId('connect-error-PRODUCTION')).toBeNull();
    });
    expect(screen.queryByTestId('connect-match-PRODUCTION')).not.toBeNull();
  });

  it('shows the undocumented extra fields, when any came back', () => {
    render(
      <ConnectApplicationPanel
        report={report([
          status({
            environment: 'SANDBOX',
            configured: true,
            application: { ...APPLICATION, extra: { created_at: '2026-01-01' } },
            redirectUriMismatch: true,
          }),
        ])}
      />,
    );

    expect(screen.getByTestId('connect-extra-SANDBOX').textContent).toContain('created_at');
  });

  it('renders the host config help behind a toggle, only when supplied', async () => {
    render(
      <ConnectApplicationPanel
        report={report([
          status({ environment: 'SANDBOX' }),
          status({ environment: 'PRODUCTION' }),
        ])}
        configVarsFor={(environment) =>
          environment === 'SANDBOX' ? ['HOST_CLIENT_ID', 'HOST_TOKEN'] : []
        }
      />,
    );

    // PRODUCTION got an empty list, so it renders no toggle at all.
    await waitFor(() => {
      expect(screen.queryByTestId('connect-config-toggle-PRODUCTION')).toBeNull();
    });

    fireEvent.click(screen.getByTestId('connect-config-toggle-SANDBOX'));
    expect(screen.getByTestId('connect-config-details-SANDBOX').textContent).toContain(
      'HOST_CLIENT_ID',
    );

    fireEvent.click(screen.getByTestId('connect-config-toggle-SANDBOX'));
    await waitFor(() => {
      expect(screen.queryByTestId('connect-config-details-SANDBOX')).toBeNull();
    });
  });

  it('omits the toggle entirely when the host supplies no config help', async () => {
    render(<ConnectApplicationPanel report={report([status({ environment: 'SANDBOX' })])} />);

    await waitFor(() => {
      expect(screen.queryByTestId('connect-config-toggle-SANDBOX')).toBeNull();
    });
  });

  it('offers the refresh action only when the host wires one', async () => {
    const refreshed = { count: 0 };
    const { rerender } = render(
      <ConnectApplicationPanel
        report={report([status({ environment: 'SANDBOX' })])}
        onRefresh={() => {
          refreshed.count += 1;
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('connect-refresh'));
    expect(refreshed.count).toBe(1);

    rerender(<ConnectApplicationPanel report={report([status({ environment: 'SANDBOX' })])} />);
    await waitFor(() => {
      expect(screen.queryByTestId('connect-refresh')).toBeNull();
    });
  });
});
