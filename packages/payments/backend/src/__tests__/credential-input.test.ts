import { describe, expect, it } from 'vitest';

import { InvalidCredentialsInputError } from '../core/errors';

import { TENANT, setupCredentialsHttpWorld, setupSettingsWorld } from './fixtures';

/**
 * What `PUT .../providers/[provider]` is allowed to say (FUT-694).
 *
 * The ticket's acceptance criteria are five Gherkin scenarios; none of them is
 * a browser story — every one is about what the SERVER does with a body the
 * form would never send — so they land here, one test each, under the names
 * the scenarios carry:
 *
 *   Cenário: corpo sem fields responde 400, não 500
 *   Cenário: environment inventado responde 400
 *   Cenário: handle que falha o pattern responde 400 nomeando o campo
 *   Cenário: chave fora do schema é recusada
 *   Cenário: salvar credenciais legítimas segue funcionando para cada provedor
 *
 * Run against the real adapters, because the contract being tested is each
 * adapter's own `credentialSchema` — see `setupCredentialsHttpWorld`.
 */

const ctx = { merchant: TENANT };

function put(body: unknown): Request {
  return new Request('http://payments.test/', { method: 'PUT', body: JSON.stringify(body) });
}

/** A body that is not JSON at all — what a truncated request looks like. */
function putRaw(body: string): Request {
  return new Request('http://payments.test/', { method: 'PUT', body });
}

async function messageOf(response: Response): Promise<string> {
  const { message } = (await response.json()) as { message: string };
  return message;
}

describe('saveCredentials — the body is checked against the adapter schema', () => {
  it('answers 400, not 500, when the body carries no fields', async () => {
    const { http } = setupCredentialsHttpWorld();
    const res = await http.saveCredentials(put({ environment: 'SANDBOX' }), ctx, 'infinitepay');
    // It used to reach `Object.entries(undefined)` inside `applyFieldUpdates`
    // and come back as a server error about our own code.
    expect(res.status).toBe(400);
    expect(await messageOf(res)).toContain('fields');
  });

  it('answers 400 for an invented environment instead of storing a third one', async () => {
    const { http, store } = setupCredentialsHttpWorld();
    const res = await http.saveCredentials(
      put({ environment: 'STAGING', fields: { handle: '$loja-de-teste' } }),
      ctx,
      'infinitepay',
    );
    expect(res.status).toBe(400);
    expect(await messageOf(res)).toContain('environment');
    // The write went straight into the encrypted blob as a key beside
    // SANDBOX/PRODUCTION, which nothing downstream can read or clear.
    expect(await store.get(TENANT, 'infinitepay')).toBeNull();
  });

  it('answers 400 naming the field when a handle fails the pattern', async () => {
    const { http, store } = setupCredentialsHttpWorld();
    const res = await http.saveCredentials(
      put({ environment: 'SANDBOX', fields: { handle: 'loja-sem-cifrao' } }),
      ctx,
      'infinitepay',
    );
    expect(res.status).toBe(400);
    expect(await messageOf(res)).toContain('handle');
    expect(await store.get(TENANT, 'infinitepay')).toBeNull();
  });

  /**
   * A handle pasted out of WhatsApp arrives padded. The browser validates
   * `value.trim()` and submits the raw string, so judging the untrimmed copy
   * here 400s an input the form's own validator just approved, on a screen
   * where the padding is invisible and no field can be highlighted.
   *
   * So the server normalizes, and the value it validated is the value it
   * stores — which is what the row should have held all along: the InfinitePay
   * adapter already trims the handle before every call, so the padding never
   * reached the provider, it only sat in the field deciding who gets paid.
   */
  it('trims a pasted value, and stores the one it validated', async () => {
    const { http, store } = setupCredentialsHttpWorld();
    const res = await http.saveCredentials(
      put({ environment: 'SANDBOX', fields: { handle: ' $loja-de-teste ' } }),
      ctx,
      'infinitepay',
    );
    expect(res.status).toBe(200);
    expect((await store.get(TENANT, 'infinitepay'))?.environments.SANDBOX).toEqual({
      handle: '$loja-de-teste',
    });
  });

  /** Trimmed to nothing is nothing: whitespace is not a credential. */
  it('reads an all-whitespace value as a CLEAR, not as a value', async () => {
    const { http, store } = setupCredentialsHttpWorld();
    await http.saveCredentials(
      put({ environment: 'SANDBOX', fields: { handle: '$loja-de-teste' } }),
      ctx,
      'infinitepay',
    );
    const res = await http.saveCredentials(
      put({ environment: 'SANDBOX', fields: { handle: '   ' } }),
      ctx,
      'infinitepay',
    );
    expect(res.status).toBe(200);
    expect((await store.get(TENANT, 'infinitepay'))?.environments.SANDBOX).toEqual({});
  });

  it('still lets an empty string CLEAR a patterned field — that is a disconnect', async () => {
    const { http, store } = setupCredentialsHttpWorld();
    await http.saveCredentials(
      put({ environment: 'SANDBOX', fields: { handle: '$loja-de-teste' } }),
      ctx,
      'infinitepay',
    );
    const cleared = await http.saveCredentials(
      put({ environment: 'SANDBOX', fields: { handle: '' } }),
      ctx,
      'infinitepay',
    );
    expect(cleared.status).toBe(200);
    expect((await store.get(TENANT, 'infinitepay'))?.environments.SANDBOX).toEqual({});
  });

  /**
   * The one with teeth. `redirectUrl` and `notificationUrl` are read straight
   * off the credential fields when a charge is minted — InfinitePay sends
   * `webhook_url: fields['notificationUrl']`, Stripe returns the buyer to
   * `fields['redirectUrl']` — so a tenant admin naming them here pointed a
   * store's callbacks and its post-payment redirect at a host of their
   * choosing. Neither is in any `credentialSchema`; both are stamped by the
   * host at read time. `stubOutcome` scripts the provider's answers, and
   * `__proto__` is assigned onto an object literal one function later.
   */
  it.each(['notificationUrl', 'redirectUrl', 'stubOutcome', '__proto__'])(
    'refuses `%s` — a key outside the schema is not a credential',
    async (key) => {
      const { http, store } = setupCredentialsHttpWorld();
      const res = await http.saveCredentials(
        put({ environment: 'SANDBOX', fields: { handle: '$loja-de-teste', [key]: 'https://collector.test/hook' } }),
        ctx,
        'infinitepay',
      );
      expect(res.status).toBe(400);
      expect(await messageOf(res)).toContain(key);
      // Refused whole: the legitimate `handle` beside it is not written either.
      expect(await store.get(TENANT, 'infinitepay')).toBeNull();
    },
  );

  it('answers 400 rather than throwing when the body is not JSON', async () => {
    const { http } = setupCredentialsHttpWorld();
    // A bare `SyntaxError` is not a `PaymentsError`, so it escaped `guarded`
    // altogether and surfaced as an unhandled rejection in the host.
    const res = await http.saveCredentials(putRaw('not json'), ctx, 'infinitepay');
    expect(res.status).toBe(400);
  });

  it.each([
    ['infinitepay', { handle: '$loja-de-teste' }],
    ['pagbank', { token: 'tok_1', publicKey: 'pk_1', webhookToken: 'wht_1' }],
    ['stone', { secretKey: 'sk_1', publicKey: 'pk_1', webhookUser: 'u', webhookPassword: 'p' }],
    ['stripe', { secretKey: 'sk_1', publishableKey: 'pk_1', webhookSecret: 'whsec_1' }],
  ])('saves %s credentials that name only its own schema keys', async (provider, fields) => {
    const { http, store } = setupCredentialsHttpWorld();
    const res = await http.saveCredentials(put({ environment: 'SANDBOX', fields }), ctx, provider);
    expect(res.status).toBe(200);
    expect((await store.get(TENANT, provider))?.environments.SANDBOX).toEqual(fields);
  });

  /**
   * The HTTP surface is one door, not the door. A host that mounts its own
   * route — several do — reaches the service directly, and the schema contract
   * has to hold there or the fix is one route deep.
   */
  it('refuses an undeclared key when the service is called directly', async () => {
    const { settings } = setupSettingsWorld();
    await expect(
      settings.saveCredentials(TENANT, 'stone', {
        environment: 'SANDBOX',
        fields: { stubOutcome: 'PAID' },
      }),
    ).rejects.toBeInstanceOf(InvalidCredentialsInputError);
  });

  /**
   * The one key the service is WIDER on than the request body, and it has to
   * be: the host stamps the platform's own billing callback on every platform
   * save (`savePlatformCredentials`) because the read-time resolver answers
   * null for a merchant with no tenant-addressed route, so a stored value is
   * the only address that connection will ever carry. Refusing it here does not
   * close a hole — the browser's door is shut one function up — it deletes the
   * platform subscription webhook path and 500s every save on the superadmin
   * billing screen.
   */
  it('accepts the host-stamped notificationUrl the platform save carries', async () => {
    const { settings, store } = setupSettingsWorld();

    await settings.saveCredentials(TENANT, 'stone', {
      environment: 'SANDBOX',
      fields: {
        secretKey: 'sk_1',
        publicKey: 'pk_1',
        webhookUser: 'u',
        webhookPassword: 'p',
        notificationUrl: 'https://host/api/webhooks/platform-billing/stone',
      },
    });

    expect((await store.get(TENANT, 'stone'))?.environments.SANDBOX['notificationUrl']).toBe(
      'https://host/api/webhooks/platform-billing/stone',
    );
  });

  /** Still a destination, so it still has to be one. */
  it.each(['javascript:alert(1)', 'not-a-url'])(
    'refuses `%s` as a host-stamped address',
    async (value) => {
      const { settings } = setupSettingsWorld();
      await expect(
        settings.saveCredentials(TENANT, 'stone', {
          environment: 'SANDBOX',
          fields: { notificationUrl: value },
        }),
      ).rejects.toBeInstanceOf(InvalidCredentialsInputError);
    },
  );

  /**
   * The rows that came through the hole BEFORE it was closed.
   *
   * A check that refuses a key before it reaches the clear short-circuit blocks
   * new writes and makes the existing ones PERMANENT: `{ notificationUrl: '' }`
   * would 400, `maskEnvironment` renders only schema keys so nothing on screen
   * says the value is there, and the remaining remediation is SQL against the
   * table. Clearing therefore comes first and applies to any key at all,
   * host-owned ones included — an erase cannot introduce a destination.
   */
  it.each(['notificationUrl', 'stubOutcome'])(
    'lets `%s`, already on the row, be cleared through the same door',
    async (key) => {
      const { http, store } = setupCredentialsHttpWorld();
      await http.saveCredentials(
        put({ environment: 'SANDBOX', fields: { handle: '$loja-de-teste' } }),
        ctx,
        'infinitepay',
      );
      // The pre-FUT-694 write, planted the way it used to land: straight into
      // the stored field set, under a key no schema has ever heard of.
      const poisoned = await store.get(TENANT, 'infinitepay');
      if (!poisoned) throw new Error('the connection under test was not stored');
      poisoned.environments.SANDBOX[key] = 'https://collector.attacker/hook';
      await store.save(TENANT, poisoned);

      const res = await http.saveCredentials(
        put({ environment: 'SANDBOX', fields: { [key]: '' } }),
        ctx,
        'infinitepay',
      );

      expect(res.status).toBe(200);
      expect((await store.get(TENANT, 'infinitepay'))?.environments.SANDBOX).toEqual({
        handle: '$loja-de-teste',
      });
    },
  );

  /**
   * Still true after the rewrite: the payload type carries no `stub`, and an
   * extra top-level key is dropped rather than refused — a refusal would tell
   * the caller the key exists.
   */
  it('drops a smuggled top-level key instead of honouring or announcing it', async () => {
    const { http, store } = setupCredentialsHttpWorld();
    const res = await http.saveCredentials(
      put({ environment: 'SANDBOX', fields: { handle: '$loja-de-teste' }, stub: true, enabled: true }),
      ctx,
      'infinitepay',
    );
    expect(res.status).toBe(200);
    expect((await store.get(TENANT, 'infinitepay'))?.enabled).toBe(false);
  });
});
