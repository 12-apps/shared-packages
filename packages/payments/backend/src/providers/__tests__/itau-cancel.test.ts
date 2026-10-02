import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../../core/errors';
import { itauProvider } from '../itau';
import { PT_BR_ITAU_COPY } from '../pt-BR';
import { jsonBody, paidCob, SANDBOX_CREDS, stubItauFetch, TXID } from './itau-fetch';

/**
 * `cancelCharge` voids a superseded cob at Itaú, so the QR the buyer was shown
 * before a reprice stops being payable now rather than at its `expiracao`.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fresh adapter per test — nothing held across them. */
function adapter() {
  return itauProvider(PT_BR_ITAU_COPY);
}

describe('itau cancelCharge', () => {
  it('PATCHes the cob to REMOVIDA_PELO_USUARIO_RECEBEDOR and reports it CANCELED', async () => {
    const calls = stubItauFetch((call) =>
      call.method === 'PATCH'
        ? { body: { ...paidCob('12.50'), status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR', pix: undefined } }
        : undefined,
    );

    const snapshot = await adapter().cancelCharge!(TXID, SANDBOX_CREDS);

    const patch = calls.find((call) => call.method === 'PATCH');
    expect(new URL(patch?.url ?? '').pathname).toBe(`/sandboxapi/pix_recebimentos_ext_v2/v2/cob/${TXID}`);
    expect(patch?.headers['authorization']).toBe('Bearer token-1');
    expect(jsonBody(patch)).toEqual({ status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR' });
    expect(snapshot).toMatchObject({ provider: 'itau', providerChargeId: TXID, status: 'CANCELED', method: 'PIX' });
  });

  it('keeps the txid it was asked about when the answer omits it', async () => {
    stubItauFetch(() => ({ body: { status: 'REMOVIDA_PELO_USUARIO_RECEBEDOR', valor: { original: '12.50' } } }));

    const snapshot = await adapter().cancelCharge!(TXID, SANDBOX_CREDS);

    expect(snapshot.providerChargeId).toBe(TXID);
    expect(snapshot.status).toBe('CANCELED');
  });

  it('answers a refusal over a cob the buyer already paid with the cob read back, so PAID is recorded', async () => {
    const calls = stubItauFetch((call) =>
      call.method === 'PATCH' ? { status: 400, body: { title: 'Cobrança já concluída' } } : { body: paidCob('12.50') },
    );

    const snapshot = await adapter().cancelCharge!(TXID, SANDBOX_CREDS);

    expect(calls.map((call) => call.method).filter((method) => method !== 'POST')).toEqual(['PATCH', 'GET']);
    expect(snapshot).toMatchObject({ providerChargeId: TXID, status: 'PAID' });
  });

  it('throws a refusal over a cob still open as the non-retriable error it is, never as a void', async () => {
    stubItauFetch((call) =>
      call.method === 'PATCH'
        ? { status: 400, body: { title: 'Requisição inválida' } }
        : { body: { ...paidCob('12.50'), status: 'ATIVA', pix: undefined } },
    );

    const failure = await adapter().cancelCharge!(TXID, SANDBOX_CREDS).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderRequestError);
    expect((failure as ProviderRequestError).options.retriable).toBe(false);
    expect((failure as ProviderRequestError).options.httpStatus).toBe(400);
  });

  it('throws a 5xx as it came — retriable, and no read-back of a cob Itaú did not answer for', async () => {
    const calls = stubItauFetch((call) => (call.method === 'PATCH' ? { status: 503, body: {} } : { body: paidCob('12.50') }));

    const failure = await adapter().cancelCharge!(TXID, SANDBOX_CREDS).catch((error: unknown) => error);

    expect((failure as ProviderRequestError).options.retriable).toBe(true);
    expect(calls.some((call) => call.method === 'GET')).toBe(false);
  });

  it('answers a pending snapshot in stub mode without calling Itaú', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const snapshot = await adapter().cancelCharge!('stub_itau_1', { ...SANDBOX_CREDS, stub: true });

    expect(snapshot).toMatchObject({ provider: 'itau', providerChargeId: 'stub_itau_1', status: 'PENDING' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
