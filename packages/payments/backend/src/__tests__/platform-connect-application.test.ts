import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  consultConnectApplications,
  type ConsultConnectApplicationsDeps,
} from '../platform/connect-application';
import type { PaymentEnvironment, ResolvedCredentials } from '../core/types';

/**
 * The Connect-application consult (FUT-479, packaged by FUT-573). Pinned:
 *
 *  - the two environments are consulted SEPARATELY (separate applications,
 *    separate id/secret pairs) and fail independently — a broken production
 *    consult must not blank the sandbox column;
 *  - the redirect-URI mismatch is computed byte-for-byte, because that is how
 *    PagBank re-validates it on the token exchange;
 *  - the undocumented response is parsed defensively, and nothing that smells
 *    like a credential ever reaches the payload.
 */

const EXPECTED = 'https://app.example.com/api/payments/oauth/callback/pagbank';

/** Deps whose resolver configures ONLY `environment`; the other stays null. */
function depsFor(
  environment: PaymentEnvironment | 'both',
  fields: Record<string, string>,
  over: Partial<ConsultConnectApplicationsDeps> = {},
): ConsultConnectApplicationsDeps {
  return {
    appCredentials: (_provider, env): ResolvedCredentials | null =>
      environment === 'both' || env === environment ? { environment: env, fields } : null,
    expectedRedirectUri: EXPECTED,
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubFetch(response: Response | (() => Response)): ReturnType<typeof vi.fn> {
  const mock = vi.fn(async () => (typeof response === 'function' ? response() : response));
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('consultConnectApplications', () => {
  it('reports an unconfigured environment as such, without calling PagBank', async () => {
    const fetchMock = stubFetch(jsonResponse({}));

    const report = await consultConnectApplications({
      appCredentials: () => null,
      expectedRedirectUri: EXPECTED,
    });

    expect(report.expectedRedirectUri).toBe(EXPECTED);
    expect(report.environments.map((e) => e.environment)).toEqual(['SANDBOX', 'PRODUCTION']);
    for (const env of report.environments) {
      expect(env.configured).toBe(false);
      expect(env.application).toBeNull();
      expect(env.redirectUriMismatch).toBeNull();
      expect(env.error).toBeNull();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('consults with the account-token bearer and flags a byte-level mismatch', async () => {
    // Same path, trailing slash — the exact class of difference that silently
    // breaks the OAuth exchange while looking identical to a human.
    const fetchMock = stubFetch(jsonResponse({ name: 'Aurora', redirect_uri: `${EXPECTED}/` }));

    const report = await consultConnectApplications(
      depsFor('SANDBOX', { clientId: 'app-123', clientSecret: 's3cret', accountToken: 'acct' }),
    );
    const sandbox = report.environments[0];

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sandbox.api.pagseguro.com/oauth2/application/app-123',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer acct' }),
      }),
    );
    expect(sandbox?.configured).toBe(true);
    expect(sandbox?.clientId).toBe('app-123');
    expect(sandbox?.application?.name).toBe('Aurora');
    expect(sandbox?.application?.redirectUri).toBe(`${EXPECTED}/`);
    expect(sandbox?.redirectUriMismatch).toBe(true);
  });

  it('reports a byte-identical redirect URI as matching', async () => {
    stubFetch(jsonResponse({ redirect_uri: EXPECTED }));

    const report = await consultConnectApplications(
      depsFor('PRODUCTION', { clientId: 'app-prod', accountToken: 'acct' }),
    );
    const production = report.environments[1];

    expect(production?.redirectUriMismatch).toBe(false);
    expect(production?.error).toBeNull();
  });

  it('keeps the mismatch UNKNOWN when the response names no redirect URI', async () => {
    // The schema is undocumented; absence must not read as "matches".
    stubFetch(jsonResponse({ name: 'Aurora' }));

    const report = await consultConnectApplications(
      depsFor('SANDBOX', { clientId: 'app-123', accountToken: 'acct' }),
    );

    expect(report.environments[0]?.redirectUriMismatch).toBeNull();
  });

  it('carries unknown fields in extra, but never a credential-looking key', async () => {
    stubFetch(
      jsonResponse({
        redirect_uri: EXPECTED,
        created_at: '2026-01-01',
        client_secret: 'MUST-NOT-LEAK',
        access_token: 'MUST-NOT-LEAK',
        scope: 'payments.read',
      }),
    );

    const report = await consultConnectApplications(
      depsFor('SANDBOX', { clientId: 'app-123', accountToken: 'acct' }),
    );
    const extra = report.environments[0]?.application?.extra ?? {};

    expect(extra.created_at).toBe('2026-01-01');
    expect(extra.scope).toBe('payments.read');
    expect(JSON.stringify(report)).not.toContain('MUST-NOT-LEAK');
  });

  it('names a missing account token instead of letting PagBank answer 401 invalid_token', async () => {
    const fetchMock = stubFetch(jsonResponse({}));

    const report = await consultConnectApplications(
      depsFor('SANDBOX', { clientId: 'app-123', clientSecret: 's3cret' }),
    );
    const sandbox = report.environments[0];

    expect(sandbox?.configured).toBe(true);
    expect(sandbox?.error).toContain('accountToken');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets a host name its own configuration surface in that reason', async () => {
    stubFetch(jsonResponse({}));

    const report = await consultConnectApplications(
      depsFor(
        'SANDBOX',
        { clientId: 'app-123' },
        { missingAccountTokenMessage: 'Configure HOST_VAR para consultar.' },
      ),
    );

    expect(report.environments[0]?.error).toBe('Configure HOST_VAR para consultar.');
  });

  it('summarizes a non-2xx consult without failing the other environment', async () => {
    const responses: Record<string, Response> = {
      'https://sandbox.api.pagseguro.com/oauth2/application/app-123': jsonResponse(
        { error_messages: [{ code: '40002' }] },
        403,
      ),
      'https://api.pagseguro.com/oauth2/application/app-123': jsonResponse({
        redirect_uri: EXPECTED,
      }),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => responses[url] ?? jsonResponse({}, 404)),
    );

    const report = await consultConnectApplications(
      depsFor('both', { clientId: 'app-123', accountToken: 'acct' }),
    );
    const [sandbox, production] = report.environments;

    expect(sandbox?.error).toContain('403');
    expect(sandbox?.application).toBeNull();
    expect(production?.error).toBeNull();
    expect(production?.redirectUriMismatch).toBe(false);
  });

  it('answers a network failure with a retryable pt-BR message, not a throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const report = await consultConnectApplications(
      depsFor('SANDBOX', { clientId: 'app-123', accountToken: 'acct' }),
    );

    expect(report.environments[0]?.error).toContain('Não foi possível falar com o PagBank');
  });

  it('consults through a host-supplied API base when one is given', async () => {
    const fetchMock = stubFetch(jsonResponse({ redirect_uri: EXPECTED }));

    await consultConnectApplications(
      depsFor(
        'SANDBOX',
        { clientId: 'app-123', accountToken: 'acct' },
        { apiBaseFor: () => 'https://proxy.example.com' },
      ),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example.com/oauth2/application/app-123',
      expect.anything(),
    );
  });
});
