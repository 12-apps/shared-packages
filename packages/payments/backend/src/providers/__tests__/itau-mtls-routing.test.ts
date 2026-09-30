import { afterEach, describe, expect, it, vi } from 'vitest';

import { pixInput } from '../../__tests__/fixtures';
import type { ProviderHttpInit } from '../http';
import { mtlsTransport, type ClientIdentity } from '../mtls';
import { itauProvider } from '../itau';
import { normalizePem } from '../itau-http';
import { EN_US_ITAU_COPY } from '../en-US';
import { PT_BR_ITAU_COPY } from '../pt-BR';
import { selfSignedIdentity } from './pki';

/**
 * PRODUCTION routes every Itaú call — the token mint first — through the
 * merchant's mTLS identity, and never through global `fetch`. The transport
 * is replaced by a recorder here (it is proven against a real TLS server in
 * `mtls.test.ts`); `identityProblem` stays real, so the PEMs are real too.
 */

interface Sent {
  identity: ClientIdentity;
  url: string;
  init: ProviderHttpInit;
}

vi.mock('../mtls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../mtls')>()),
  mtlsTransport: vi.fn(),
}));

/** Replace the mTLS transport with one that records what it was asked to send, in `sent`. */
function recordMtls(sent: Sent[]): void {
  vi.mocked(mtlsTransport).mockImplementation((identity: ClientIdentity) => async (url: string, init: ProviderHttpInit) => {
    sent.push({ identity, url, init });
    const body = url.includes('/oauth/token') ? { access_token: 'prod-token' } : { txid: 'T', status: 'ATIVA' };
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

afterEach(() => {
  vi.mocked(mtlsTransport).mockReset();
  vi.unstubAllGlobals();
});

const PROD_FIELDS = { clientId: 'client-1', clientSecret: 'secret-1', pixKey: 'loja@example.com' };

describe('itau production transport', () => {
  it('presents the pasted certificate on the token mint and the cob, at the production hosts', async () => {
    const merchant = selfSignedIdentity('merchant-a');
    const sent: Sent[] = [];
    recordMtls(sent);
    const plainFetch = vi.fn();
    vi.stubGlobal('fetch', plainFetch);

    await itauProvider(PT_BR_ITAU_COPY).createCharge(pixInput('order-prod'), {
      environment: 'PRODUCTION',
      fields: {
        clientId: 'client-1',
        clientSecret: 'secret-1',
        pixKey: 'loja@example.com',
        certificate: merchant.cert,
        privateKey: merchant.key,
      },
    });

    expect(sent.map((call) => call.url.split('?')[0]?.replace(/\/cob\/.*$/, '/cob/<txid>'))).toEqual([
      'https://sts.itau.com.br/api/oauth/token',
      'https://secure.gateway.api.itau/pix_recebimentos/v2/cob/<txid>',
    ]);
    expect(sent.every((call) => call.identity.cert === normalizePem(merchant.cert) && call.identity.key === normalizePem(merchant.key))).toBe(true);
    expect(sent[1]?.init.headers['authorization']).toBe('Bearer prod-token');
    expect(plainFetch).not.toHaveBeenCalled();
  });

  it('connects with a PEM whose newlines a single-line paste folded into spaces', async () => {
    const merchant = selfSignedIdentity('merchant-a');
    const sent: Sent[] = [];
    recordMtls(sent);
    const folded = (pem: string) => pem.replace(/\n/g, ' ');
    const outcome = await itauProvider(PT_BR_ITAU_COPY).verifyCredentials({
      environment: 'PRODUCTION',
      fields: { ...PROD_FIELDS, certificate: folded(merchant.cert), privateKey: folded(merchant.key) },
    });
    expect(outcome).toEqual({ ok: true });
    expect(sent[0]?.identity.cert).toBe(normalizePem(merchant.cert));
  });

  it('names the certificate when Itau resets the handshake on it, without persisting a refusal', async () => {
    const merchant = selfSignedIdentity('merchant-a');
    vi.mocked(mtlsTransport).mockImplementation(() => async () => {
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    });
    const outcome = await itauProvider(EN_US_ITAU_COPY).verifyCredentials(
      { environment: 'PRODUCTION', fields: { ...PROD_FIELDS, certificate: merchant.cert, privateKey: merchant.key } },
      'en-US',
    );
    // UNREACHABLE (not persisted as FAILED): one network blip looks the same.
    expect(outcome).toEqual({ ok: false, fault: 'UNREACHABLE', message: EN_US_ITAU_COPY.certificateRefused });
  });

  it('reads a refused connection as unreachable, not as a certificate problem', async () => {
    const merchant = selfSignedIdentity('merchant-a');
    vi.mocked(mtlsTransport).mockImplementation(() => async () => {
      throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    });
    const outcome = await itauProvider(PT_BR_ITAU_COPY).verifyCredentials({
      environment: 'PRODUCTION',
      fields: { ...PROD_FIELDS, certificate: merchant.cert, privateKey: merchant.key },
    });
    expect(outcome).toMatchObject({ ok: false, fault: 'UNREACHABLE' });
  });
});
