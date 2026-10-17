// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type {
  ConnectApplicationReport,
  ConnectApplicationStatus,
} from '@12-apps/payments-backend';

import { ConnectApplicationPanel } from '../components/platform/ConnectApplicationPanel';
import { PT_BR_PLATFORM_HOMOLOGACAO_COPY } from '../components/platform/pt-BR';

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
    credentialPreview: { clientId: null, clientSecret: null, accountToken: null },
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
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
        report={report([
          status({ environment: 'SANDBOX' }),
          status({ environment: 'PRODUCTION' }),
        ])}
      />,
    );

    expect(screen.getByTestId('connect-expected-redirect').textContent).toContain(EXPECTED);
    expect(screen.getByTestId('connect-env-SANDBOX').textContent).toContain(
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.connect.noApplication,
    );
    expect(screen.getByTestId('connect-env-PRODUCTION').textContent).toContain(
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.connect.noApplication,
    );
  });

  it('flags a mismatch loudly, with the registered value on display', () => {
    render(
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
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
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.connect.redirectDiffers,
    );
    expect(screen.getByTestId('connect-env-SANDBOX').textContent).toContain(`${EXPECTED}/`);
    expect(screen.getByTestId('connect-env-SANDBOX').textContent).toContain(
      'client_id: app-123',
    );
  });

  it('confirms a byte-identical registration as matching', () => {
    render(
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
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

    expect(screen.getByTestId('connect-match-PRODUCTION').textContent).toContain(
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.connect.redirectMatches,
    );
  });

  it('renders the unknown verdict when the response named no redirect URI', async () => {
    render(
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
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
      PT_BR_PLATFORM_HOMOLOGACAO_COPY.connect.redirectUnreported,
    );
    await waitFor(() => {
      expect(screen.queryByTestId('connect-match-SANDBOX')).toBeNull();
    });
  });

  it('surfaces a consult failure on its own environment only', async () => {
    render(
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
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
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
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
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
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
    render(<ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY} report={report([status({ environment: 'SANDBOX' })])} />);

    await waitFor(() => {
      expect(screen.queryByTestId('connect-config-toggle-SANDBOX')).toBeNull();
    });
  });

  it('offers the refresh action only when the host wires one', async () => {
    const refreshed = { count: 0 };
    const { rerender } = render(
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
        report={report([status({ environment: 'SANDBOX' })])}
        onRefresh={() => {
          refreshed.count += 1;
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('connect-refresh'));
    expect(refreshed.count).toBe(1);

    rerender(<ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY} report={report([status({ environment: 'SANDBOX' })])} />);
    await waitFor(() => {
      expect(screen.queryByTestId('connect-refresh')).toBeNull();
    });
  });
});

describe('ConnectApplicationPanel — credential previews and the paste block', () => {
  const VARS = ['APP_CLIENT_ID', 'APP_CLIENT_SECRET', 'APP_TOKEN'];

  it("previews each value's first characters under the host's variable names", () => {
    render(
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
        configVarsFor={() => VARS}
        report={report([
          status({
            environment: 'PRODUCTION',
            credentialPreview: { clientId: 'app-p', clientSecret: null, accountToken: 'tok-1' },
          }),
        ])}
      />,
    );

    const preview = screen.getByTestId('connect-preview-PRODUCTION').textContent ?? '';
    expect(preview).toContain('APP_CLIENT_ID');
    expect(preview).toContain('app-p…');
    expect(preview).toContain(PT_BR_PLATFORM_HOMOLOGACAO_COPY.connect.previewUnset);
    expect(preview).toContain('tok-1…');
    expect(screen.getByTestId('connect-env-PRODUCTION').textContent).toContain('Produção');
  });

  it('renders no paste block unless the host wires one', () => {
    render(<ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY} report={report([])} />);

    const panel = screen.getByTestId('connect-application-panel');
    const rendered = Array.from(panel.querySelectorAll('[data-testid]'), (el) =>
      el.getAttribute('data-testid'),
    );
    expect(rendered).toContain('connect-expected-redirect');
    expect(rendered).not.toContain('connect-pasted');
  });

  it('consults the pasted values and renders the answer in its own card', async () => {
    const calls: unknown[] = [];
    render(
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
        report={report([status({ environment: 'SANDBOX' })])}
        onConsultPasted={async (pasted) => {
          calls.push(pasted);
          return status({
            environment: pasted.environment,
            configured: true,
            clientId: pasted.clientId,
            application: { ...APPLICATION, redirectUri: EXPECTED },
            redirectUriMismatch: false,
            credentialPreview: { clientId: 'app-n', clientSecret: 'paste', accountToken: 'token' },
          });
        }}
      />,
    );

    const submit = screen.getByTestId('connect-pasted-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('connect-pasted-environment'), {
      target: { value: 'PRODUCTION' },
    });
    fireEvent.change(screen.getByTestId('connect-pasted-clientId'), { target: { value: ' app-new ' } });
    fireEvent.change(screen.getByTestId('connect-pasted-clientSecret'), { target: { value: 'pasted-secret' } });
    fireEvent.change(screen.getByTestId('connect-pasted-accountToken'), { target: { value: 'token-xyz' } });
    fireEvent.click(submit);

    const answer = await screen.findByTestId('connect-env-PASTED');
    expect(answer.textContent).toContain('Produção');
    expect(screen.getByTestId('connect-match-PASTED')).toBeTruthy();
    expect(screen.getByTestId('connect-preview-PASTED').textContent).toContain('paste…');
    expect(calls).toEqual([
      {
        environment: 'PRODUCTION',
        clientId: 'app-new',
        clientSecret: 'pasted-secret',
        accountToken: 'token-xyz',
      },
    ]);
  });

  it('says so when the pasted consult fails, without a result card', async () => {
    render(
      <ConnectApplicationPanel copy={PT_BR_PLATFORM_HOMOLOGACAO_COPY}
        report={report([])}
        onConsultPasted={() => Promise.reject(new Error('boom'))}
      />,
    );

    for (const id of ['clientId', 'clientSecret', 'accountToken']) {
      fireEvent.change(screen.getByTestId(`connect-pasted-${id}`), { target: { value: 'x' } });
    }
    fireEvent.click(screen.getByTestId('connect-pasted-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('connect-pasted-failed')).toBeTruthy();
      expect(screen.queryByTestId('connect-env-PASTED')).toBeNull();
    });
  });
});
