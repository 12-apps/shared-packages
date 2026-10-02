import { afterEach, describe, expect, it, vi } from 'vitest';

import { itauProvider } from '../itau';
import { PT_BR_ITAU_COPY } from '../pt-BR';
import { jsonBody, SANDBOX_CREDS, stubItauFetch } from './itau-fetch';

/**
 * "Salvar e testar conexão" registers the store's webhook for its Pix key
 * (BACEN `PUT /webhook/{chave}`), so the owner never has to ask the bank. The
 * result is a check on the Pix key; the probe's own verdict stays the
 * credentials', because a store without a webhook still takes payments.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fresh adapter per test — nothing held across them. */
function adapter() {
  return itauProvider(PT_BR_ITAU_COPY);
}
const URL_OF_STORE = 'https://loja.example/api/webhooks/payments/loja/itau';
const WITH_URL = { ...SANDBOX_CREDS, fields: { ...SANDBOX_CREDS.fields, notificationUrl: URL_OF_STORE } };

describe('itau verifyCredentials registers the webhook', () => {
  it('PUTs the store URL for the Pix key once the token mint passed, and says so on the key', async () => {
    const calls = stubItauFetch((call) => (call.method === 'PUT' ? { body: { webhookUrl: URL_OF_STORE } } : undefined));

    const outcome = await adapter().verifyCredentials(WITH_URL);

    expect(calls.filter((call) => call.url.includes('/webhook/')).map((call) => call.method)).toEqual(['GET', 'PUT']);
    const put = calls.find((call) => call.method === 'PUT');
    expect(new URL(put?.url ?? '').pathname).toBe(
      `/sandboxapi/pix_recebimentos_ext_v2/v2/webhook/${encodeURIComponent('loja@example.com')}`,
    );
    expect(put?.headers['authorization']).toBe('Bearer token-1');
    expect(jsonBody(put)).toEqual({ webhookUrl: URL_OF_STORE });
    expect(outcome).toEqual({
      ok: true,
      checks: [{ key: 'pixKey', status: 'PASS', message: PT_BR_ITAU_COPY.webhook.registered }],
    });
  });

  it('keeps good credentials green when Itaú refuses the key, and names the refusal on it', async () => {
    stubItauFetch((call) => (call.method === 'PUT' ? { status: 400, body: { title: 'WebhookOperacaoInvalida' } } : undefined));

    const outcome = await adapter().verifyCredentials(WITH_URL);

    expect(outcome.ok).toBe(true);
    expect(outcome.fault).toBeUndefined();
    expect(outcome.checks).toEqual([{ key: 'pixKey', status: 'FAIL', message: PT_BR_ITAU_COPY.webhook.refused }]);
  });

  it('reads a 5xx or a 429 on the registration as Itaú being unreachable, not as a refused key', async () => {
    for (const status of [503, 429]) {
      stubItauFetch((call) => (call.method === 'PUT' ? { status, body: {} } : undefined));

      const outcome = await adapter().verifyCredentials(WITH_URL);

      expect(outcome.ok).toBe(true);
      // UNCHECKED, not FAIL: a red Pix key box would blame a key nothing refused.
      expect(outcome.checks).toEqual([{ key: 'pixKey', status: 'UNCHECKED', message: PT_BR_ITAU_COPY.webhook.unreachable }]);
      vi.unstubAllGlobals();
    }
  });

  it('leaves a key that already notifies ANOTHER address alone, and names that address', async () => {
    const elsewhere = 'https://erp.example/pix-webhook';
    const calls = stubItauFetch((call) => (call.method === 'GET' ? { body: { webhookUrl: elsewhere } } : undefined));

    const outcome = await adapter().verifyCredentials(WITH_URL);

    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    expect(outcome.ok).toBe(true);
    expect(outcome.checks).toEqual([
      { key: 'pixKey', status: 'UNCHECKED', message: `${PT_BR_ITAU_COPY.webhook.elsewhere} ${elsewhere}` },
    ]);
  });

  it('does not re-register a key already notifying this store', async () => {
    const calls = stubItauFetch((call) => (call.method === 'GET' ? { body: { webhookUrl: URL_OF_STORE } } : undefined));

    const outcome = await adapter().verifyCredentials(WITH_URL);

    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    expect(outcome.checks).toEqual([{ key: 'pixKey', status: 'PASS', message: PT_BR_ITAU_COPY.webhook.registered }]);
  });

  it('reads an outage on the lookup as unreachable, and writes nothing over a webhook it could not see', async () => {
    const calls = stubItauFetch((call) => (call.method === 'GET' ? { status: 503, body: {} } : undefined));

    const outcome = await adapter().verifyCredentials(WITH_URL);

    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    expect(outcome.checks).toEqual([{ key: 'pixKey', status: 'UNCHECKED', message: PT_BR_ITAU_COPY.webhook.unreachable }]);
  });

  it('never blames the key for a refused lookup or a scope refusal — those stay UNCHECKED', async () => {
    const cases: Array<{ on: 'GET' | 'PUT'; status: number }> = [
      { on: 'GET', status: 400 },
      { on: 'GET', status: 403 },
      { on: 'PUT', status: 401 },
      { on: 'PUT', status: 403 },
    ];
    for (const { on, status } of cases) {
      stubItauFetch((call) => (call.method === on ? { status, body: {} } : undefined));

      const outcome = await adapter().verifyCredentials(WITH_URL);

      expect(outcome.ok).toBe(true);
      expect(outcome.checks).toEqual([{ key: 'pixKey', status: 'UNCHECKED', message: PT_BR_ITAU_COPY.webhook.unreachable }]);
      vi.unstubAllGlobals();
    }
  });

  it('registers nothing, and says so, when no webhook URL reached the probe', async () => {
    const calls = stubItauFetch(() => undefined);

    const outcome = await adapter().verifyCredentials(SANDBOX_CREDS);

    expect(calls.some((call) => call.url.includes('/webhook/'))).toBe(false);
    expect(outcome.checks).toEqual([{ key: 'pixKey', status: 'UNCHECKED', message: PT_BR_ITAU_COPY.webhook.notRegistered }]);
  });

  it('never registers before the credentials are proven — a refused token mint makes no PUT', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push(`${String(init.method)} ${String(url)}`);
      return new Response('{}', { status: 401 });
    });

    const outcome = await adapter().verifyCredentials(WITH_URL);

    expect(outcome).toMatchObject({ ok: false, fault: 'REFUSED' });
    expect(calls.some((call) => call.includes('/webhook/'))).toBe(false);
  });

  it('answers the registered check in stub mode without calling Itaú', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const outcome = await adapter().verifyCredentials({ ...WITH_URL, stub: true });

    expect(outcome).toMatchObject({ ok: true, checks: [{ key: 'pixKey', status: 'PASS' }] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
