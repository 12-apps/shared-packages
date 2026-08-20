import { describe, expect, it } from 'vitest';

import { DEFAULT_OAUTH_APP_EXTRAS, envOAuthAppCredentials } from '../config/oauth-env';

/**
 * READING THE PLATFORM'S OAUTH APPLICATION CREDENTIALS FROM THE ENVIRONMENT.
 *
 * Two rules, and they point in OPPOSITE directions on purpose — which is
 * exactly why they are worth pinning rather than re-deriving per host.
 *
 * The id/secret pair is STRICT. If production could fall back to the sandbox
 * names, one missing `_PROD` variable would authorize a real merchant against
 * a TEST application and store the result as a live grant: a connection that
 * looks real, belongs to the wrong application, and fails only once money
 * moves. Answering null instead is what makes the settings page offer the
 * credential form rather than a dead connect button.
 *
 * The extras FALL BACK. A scope list is usually identical across environments
 * while a webhook secret is not, so a deployment sets one shared value and
 * overrides only what differs.
 */

const SANDBOX_ONLY = {
  PAGBANK_OAUTH_CLIENT_ID: 'sandbox-id',
  PAGBANK_OAUTH_CLIENT_SECRET: 'sandbox-secret',
};

describe('the id/secret pair is strict', () => {
  it('reads the unsuffixed names for SANDBOX', () => {
    const resolve = envOAuthAppCredentials(SANDBOX_ONLY);

    expect(resolve('pagbank', 'SANDBOX')).toEqual({
      environment: 'SANDBOX',
      fields: { clientId: 'sandbox-id', clientSecret: 'sandbox-secret' },
    });
  });

  it('reads the _PROD names for PRODUCTION', () => {
    const resolve = envOAuthAppCredentials({
      ...SANDBOX_ONLY,
      PAGBANK_OAUTH_CLIENT_ID_PROD: 'live-id',
      PAGBANK_OAUTH_CLIENT_SECRET_PROD: 'live-secret',
    });

    expect(resolve('pagbank', 'PRODUCTION')).toEqual({
      environment: 'PRODUCTION',
      fields: { clientId: 'live-id', clientSecret: 'live-secret' },
    });
  });

  /** The case the strictness exists for. */
  it('answers null for PRODUCTION rather than falling back to the sandbox application', () => {
    const resolve = envOAuthAppCredentials(SANDBOX_ONLY);

    expect(resolve('pagbank', 'PRODUCTION')).toBeNull();
  });

  it('answers null when only one half of the pair is set', () => {
    const idOnly = envOAuthAppCredentials({ PAGBANK_OAUTH_CLIENT_ID: 'id' });
    const secretOnly = envOAuthAppCredentials({ PAGBANK_OAUTH_CLIENT_SECRET: 'secret' });

    expect(idOnly('pagbank', 'SANDBOX')).toBeNull();
    expect(secretOnly('pagbank', 'SANDBOX')).toBeNull();
  });

  it('answers null for a provider this deployment registered no application for', () => {
    const resolve = envOAuthAppCredentials(SANDBOX_ONLY);

    expect(resolve('stone', 'SANDBOX')).toBeNull();
  });

  it('uppercases the provider name to reach its variables', () => {
    const resolve = envOAuthAppCredentials(SANDBOX_ONLY);

    expect(resolve('PagBank', 'SANDBOX')?.fields['clientId']).toBe('sandbox-id');
  });
});

describe('the extras fall back', () => {
  it('takes the environment-specific value when one is set', () => {
    const resolve = envOAuthAppCredentials({
      PAGBANK_OAUTH_CLIENT_ID_PROD: 'live-id',
      PAGBANK_OAUTH_CLIENT_SECRET_PROD: 'live-secret',
      PAGBANK_WEBHOOK_SECRET: 'shared-hook',
      PAGBANK_WEBHOOK_SECRET_PROD: 'live-hook',
    });

    expect(resolve('pagbank', 'PRODUCTION')?.fields['webhookSecret']).toBe('live-hook');
  });

  it('falls back to the unsuffixed value when the environment sets none', () => {
    // A scope list is usually identical across environments; making a
    // deployment restate it under `_PROD` is friction with no safety payoff.
    const resolve = envOAuthAppCredentials({
      PAGBANK_OAUTH_CLIENT_ID_PROD: 'live-id',
      PAGBANK_OAUTH_CLIENT_SECRET_PROD: 'live-secret',
      PAGBANK_OAUTH_SCOPE: 'payments.read payments.write',
    });

    expect(resolve('pagbank', 'PRODUCTION')?.fields['scope']).toBe('payments.read payments.write');
  });

  it('omits an extra nobody set, rather than carrying an empty string', () => {
    // A falsy placeholder answers "yes, configured" to every `if (fields.x)`
    // downstream — the same trap a blank vault token sets.
    const resolve = envOAuthAppCredentials({ ...SANDBOX_ONLY, PAGBANK_WEBHOOK_TOKEN: '' });
    const fields = resolve('pagbank', 'SANDBOX')?.fields ?? {};

    expect(fields).toEqual({ clientId: 'sandbox-id', clientSecret: 'sandbox-secret' });
    expect('webhookToken' in fields).toBe(false);
  });

  it('maps every default extra onto its credential field name', () => {
    const resolve = envOAuthAppCredentials({
      ...SANDBOX_ONLY,
      PAGBANK_OAUTH_SCOPE: 'a',
      PAGBANK_WEBHOOK_SECRET: 'b',
      PAGBANK_WEBHOOK_TOKEN: 'c',
      PAGBANK_TOKEN: 'd',
    });

    expect(resolve('pagbank', 'SANDBOX')?.fields).toEqual({
      clientId: 'sandbox-id',
      clientSecret: 'sandbox-secret',
      scope: 'a',
      webhookSecret: 'b',
      webhookToken: 'c',
      accountToken: 'd',
    });
    expect(Object.keys(DEFAULT_OAUTH_APP_EXTRAS)).toHaveLength(4);
  });

  it('takes an override, so a deployment can read id and secret alone', () => {
    const resolve = envOAuthAppCredentials(
      { ...SANDBOX_ONLY, PAGBANK_OAUTH_SCOPE: 'ignored' },
      { extras: {} },
    );

    expect(resolve('pagbank', 'SANDBOX')?.fields).toEqual({
      clientId: 'sandbox-id',
      clientSecret: 'sandbox-secret',
    });
  });
});
