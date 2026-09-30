import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../../core/errors';
import { pixInput } from '../../__tests__/fixtures';
import { itauProvider, itauTxId } from '../itau';
import { EN_US_ITAU_COPY } from '../en-US';
import { PT_BR_ITAU_COPY } from '../pt-BR';
import { E2E, jsonBody, paidCob, SANDBOX_CREDS, stubItauFetch, TXID } from './itau-fetch';
import { selfSignedIdentity } from './pki';

/**
 * Live-mode Itaú: the requests the adapter builds and the snapshots it makes
 * of the answers. `fetch` is stubbed (see `itau-fetch.ts`), so these assert
 * the MAPPING — the part that silently pays or refunds the wrong amount.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('itau live createCharge', () => {
  it('mints a token, then PUTs the cob under the txid derived from the reference', async () => {
    const calls = stubItauFetch(() => ({ status: 201, body: { ...paidCob('12.50'), status: 'ATIVA', pix: undefined } }));
    const snapshot = await itauProvider(PT_BR_ITAU_COPY).createCharge(pixInput('order-77'), SANDBOX_CREDS);

    const [token, put] = calls;
    expect(token?.url).toBe('https://devportal.itau.com.br/api/jwt');
    expect(Object.fromEntries(new URLSearchParams(token?.body))).toEqual({
      grant_type: 'client_credentials',
      client_id: 'client-1',
      client_secret: 'secret-1',
    });
    expect(put?.method).toBe('PUT');
    const target = new URL(put?.url ?? '');
    expect(target.host).toBe('devportal.itau.com.br');
    expect(target.pathname.split('/cob/')).toEqual(['/sandboxapi/pix_recebimentos_ext_v2/v2', itauTxId('order-77')]);
    expect(put?.headers['authorization']).toBe('Bearer token-1');
    expect(jsonBody(put)).toEqual({
      calendario: { expiracao: 900 },
      devedor: { cpf: '12345678909', nome: 'Ana Buyer' },
      valor: { original: '12.50' },
      chave: 'loja@example.com',
      solicitacaoPagador: 'order-77',
    });
    expect(snapshot).toMatchObject({ provider: 'itau', providerChargeId: TXID, reference: 'order-77', status: 'PENDING', method: 'PIX' });
    expect(snapshot.pix?.qrText).toBe('00020101021226...6304ABCD');
    expect(snapshot.hostedCheckoutUrl).toBeUndefined();
  });

  it('sends the amount as an exact two-decimal string, never through float arithmetic', async () => {
    const calls = stubItauFetch(() => ({ body: { txid: TXID, status: 'ATIVA' } }));
    await itauProvider(PT_BR_ITAU_COPY).createCharge(
      { ...pixInput('order-78'), amount: { amountCents: 100_07, currency: 'BRL' } },
      SANDBOX_CREDS,
    );
    expect(jsonBody(calls[1])).toMatchObject({ valor: { original: '100.07' } });
  });
});

describe('itau live getCharge', () => {
  it('reports PAID with the amount that SETTLED', async () => {
    stubItauFetch(() => ({ body: paidCob('12.50') }));
    const snapshot = await itauProvider(PT_BR_ITAU_COPY).getCharge(TXID, SANDBOX_CREDS);
    expect(snapshot).toMatchObject({ status: 'PAID', amount: { amountCents: 12_50, currency: 'BRL' } });
  });

  it('reads a settled partial devolução as PARTIALLY_REFUNDED, and a full one as REFUNDED', async () => {
    const partial = paidCob('12.50', [{ id: 'D1', valor: '2.50', status: 'DEVOLVIDO' }]);
    stubItauFetch(() => ({ body: partial }));
    await expect(itauProvider(PT_BR_ITAU_COPY).getCharge(TXID, SANDBOX_CREDS)).resolves.toMatchObject({
      status: 'PARTIALLY_REFUNDED',
    });

    const full = paidCob('12.50', [{ id: 'D1', valor: '12.50', status: 'DEVOLVIDO' }]);
    stubItauFetch(() => ({ body: full }));
    await expect(itauProvider(PT_BR_ITAU_COPY).getCharge(TXID, SANDBOX_CREDS)).resolves.toMatchObject({ status: 'REFUNDED' });
  });

  it('keeps a devolução still in flight out of the charge status', async () => {
    stubItauFetch(() => ({ body: paidCob('12.50', [{ id: 'D1', valor: '12.50', status: 'EM_PROCESSAMENTO' }]) }));
    await expect(itauProvider(PT_BR_ITAU_COPY).getCharge(TXID, SANDBOX_CREDS)).resolves.toMatchObject({ status: 'PAID' });
  });

  it('finds a charge by reference through the re-derived txid, and answers null on 404', async () => {
    const calls = stubItauFetch((call) => (call.url.endsWith(`/cob/${itauTxId('order-9')}`) ? { body: paidCob('1.00') } : undefined));
    const adapter = itauProvider(PT_BR_ITAU_COPY);
    await expect(adapter.findChargeByReference?.('order-9', SANDBOX_CREDS)).resolves.toMatchObject({
      reference: 'order-9',
      status: 'PAID',
    });
    await expect(adapter.findChargeByReference?.('order-unknown', SANDBOX_CREDS)).resolves.toBeNull();
    expect(calls.filter((call) => call.method === 'GET')).toHaveLength(2);
  });
});

describe('itau live refund', () => {
  it('refunds what is still refundable under a BACEN-valid id, and reports Itau\'s own async status', async () => {
    const calls = stubItauFetch((call) =>
      call.method === 'GET'
        ? { body: paidCob('12.50', [{ id: 'Dearlier', valor: '2.50', status: 'DEVOLVIDO' }]) }
        : { status: 201, body: { rtrId: 'D60701190', valor: '10.00', status: 'EM_PROCESSAMENTO' } },
    );
    const refund = await itauProvider(PT_BR_ITAU_COPY).refund?.({ providerChargeId: TXID }, SANDBOX_CREDS);

    const put = calls.find((call) => call.method === 'PUT');
    const id = put?.url.split('/devolucao/')[1] ?? '';
    expect(put?.url).toContain(`/pix/${E2E}/devolucao/`);
    expect(id).toMatch(/^[a-zA-Z0-9]{1,35}$/);
    expect(jsonBody(put)).toEqual({ valor: '10.00' });
    expect(refund).toMatchObject({ providerRefundId: id, status: 'PENDING', amount: { amountCents: 10_00 } });
  });

  it('gives a second partial refund its own id instead of replaying the first', async () => {
    const ids: string[] = [];
    for (const earlier of [[], [{ id: 'D1', valor: '1.00', status: 'EM_PROCESSAMENTO' }]]) {
      const calls = stubItauFetch((call) =>
        call.method === 'GET' ? { body: paidCob('12.50', earlier) } : { body: { status: 'EM_PROCESSAMENTO', valor: '1.00' } },
      );
      await itauProvider(PT_BR_ITAU_COPY).refund?.({ providerChargeId: TXID, amount: { amountCents: 1_00, currency: 'BRL' } }, SANDBOX_CREDS);
      ids.push(calls.find((call) => call.method === 'PUT')?.url.split('/devolucao/')[1] ?? '');
    }
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('refuses, without calling Itau, a refund larger than what is left', async () => {
    const calls = stubItauFetch(() => ({ body: paidCob('12.50', [{ id: 'D1', valor: '12.00', status: 'DEVOLVIDO' }]) }));
    await expect(
      itauProvider(PT_BR_ITAU_COPY).refund?.({ providerChargeId: TXID, amount: { amountCents: 1_00, currency: 'BRL' } }, SANDBOX_CREDS),
    ).rejects.toBeInstanceOf(ProviderRequestError);
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('refuses a refund on a cob no Pix has paid yet', async () => {
    stubItauFetch(() => ({ body: { txid: TXID, status: 'ATIVA' } }));
    await expect(itauProvider(PT_BR_ITAU_COPY).refund?.({ providerChargeId: TXID }, SANDBOX_CREDS)).rejects.toBeInstanceOf(
      ProviderRequestError,
    );
  });
});

describe('itau verifyCredentials', () => {
  it('passes when the sandbox mints a token', async () => {
    stubItauFetch(() => undefined);
    await expect(itauProvider(PT_BR_ITAU_COPY).verifyCredentials(SANDBOX_CREDS)).resolves.toEqual({ ok: true });
  });

  it('refuses an incomplete credential set locally, naming what is missing', async () => {
    const calls = stubItauFetch(() => undefined);
    const outcome = await itauProvider(PT_BR_ITAU_COPY).verifyCredentials({ environment: 'SANDBOX', fields: { clientId: 'x' } });
    expect(outcome).toMatchObject({ ok: false, fault: 'REFUSED', message: PT_BR_ITAU_COPY.credentialsMissing });
    // Marked on the EMPTY boxes only — the filled Client ID is not the fault.
    expect(outcome.checks?.map((check) => [check.key, check.status])).toEqual([
      ['clientSecret', 'FAIL'],
      ['pixKey', 'FAIL'],
    ]);
    expect(calls).toHaveLength(0);
  });

  it('refuses a production store with no certificate before any network call', async () => {
    const calls = stubItauFetch(() => undefined);
    const outcome = await itauProvider(EN_US_ITAU_COPY).verifyCredentials({ ...SANDBOX_CREDS, environment: 'PRODUCTION' }, 'en-US');
    expect(outcome).toMatchObject({ ok: false, fault: 'REFUSED', message: EN_US_ITAU_COPY.certificateMissing });
    expect(calls).toHaveLength(0);
  });

  it('names a private key that belongs to another certificate', async () => {
    const own = selfSignedIdentity('merchant-a');
    const other = selfSignedIdentity('merchant-b');
    const outcome = await itauProvider(PT_BR_ITAU_COPY).verifyCredentials({
      environment: 'PRODUCTION',
      fields: { ...SANDBOX_CREDS.fields, certificate: own.cert, privateKey: other.key },
    });
    expect(outcome).toMatchObject({ ok: false, fault: 'REFUSED', message: PT_BR_ITAU_COPY.certificateMismatch });
    expect(outcome.checks?.map((check) => check.key)).toEqual(['certificate', 'privateKey']);
  });

  it('reads a 503 or a 429 from the token mint as an outage, not as refused credentials', async () => {
    for (const status of [503, 429]) {
      vi.stubGlobal('fetch', async () => new Response('{}', { status }));
      await expect(itauProvider(PT_BR_ITAU_COPY).verifyCredentials(SANDBOX_CREDS)).resolves.toMatchObject({
        ok: false,
        fault: 'UNREACHABLE',
      });
    }
  });

  it('reads a 401 from the token mint as REFUSED, not as an outage', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"invalid_client"}', { status: 401 }));
    await expect(itauProvider(PT_BR_ITAU_COPY).verifyCredentials(SANDBOX_CREDS)).resolves.toEqual({
      ok: false,
      fault: 'REFUSED',
      message: PT_BR_ITAU_COPY.refused,
    });
  });
});

describe('a token-service outage, outside the charge path', () => {
  it('reaches a refund as the retriable 5xx it is, not as "not connected"', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
    const failure = await itauProvider(PT_BR_ITAU_COPY)
      .refund?.({ providerChargeId: TXID }, SANDBOX_CREDS)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ProviderRequestError);
    expect((failure as ProviderRequestError).options.httpStatus).toBe(503);
  });

  it('never lets the reference probe answer an outage with "nothing found"', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 503 }));
    await expect(itauProvider(PT_BR_ITAU_COPY).findChargeByReference?.('order-1', SANDBOX_CREDS)).rejects.toBeInstanceOf(
      ProviderRequestError,
    );
  });
});

