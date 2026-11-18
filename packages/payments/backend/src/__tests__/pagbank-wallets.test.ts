import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProviderRequestError } from '../core/errors';
import { pagbankProvider } from '../providers/pagbank';
import { cardInput } from './fixtures';
import { PT_BR_PAGBANK_COPY } from '../providers/pt-BR';

/**
 * FUT-472 — Apple Pay through the PagBank adapter: the wallet branch of the
 * card charge, and the certificate round-trip that enrols a merchant account
 * (`POST /wallets/apple-pay/csr` → Apple portal → `POST /wallets/apple-pay/cer`).
 *
 * PagBank publishes NO response schema for either endpoint, so the round-trip
 * tests pin the DEFENSIVE half: the CSR is recognized by its PEM armour
 * wherever the response buries it, and an unrecognizable answer degrades to
 * `csr: null` with the raw body retained — never a throw, never a guess.
 */

const LIVE = { environment: 'SANDBOX' as const, fields: { token: 'tok_live' } };
const STUB = { environment: 'SANDBOX' as const, fields: {}, stub: true };

const PEM =
  '-----BEGIN CERTIFICATE REQUEST-----\nMIIBdz…\n-----END CERTIFICATE REQUEST-----';

function responseOf(body: string, status: number, contentType: string) {
  const bytes = new TextEncoder().encode(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 406 ? 'Not Acceptable' : status < 300 ? 'OK' : 'Bad Request',
    headers: new Headers({ 'content-type': contentType }),
    json: async () => JSON.parse(body) as unknown,
    text: async () => body,
    arrayBuffer: async () => bytes.buffer,
  };
}

function mockFetch(response: unknown, status = 200) {
  const body = typeof response === 'string' ? response : JSON.stringify(response);
  const spy = vi.fn().mockImplementation(async () => responseOf(body, status, 'application/json'));
  vi.stubGlobal('fetch', spy);
  return spy;
}

/**
 * PagBank as production answered it on 2026-11-17 (FUT-5196), and as the
 * sandbox still does: the CSR is a FILE (`application/pkcs10`), and a request
 * that will only take JSON is refused with 406 before anything is minted.
 */
function mockPagBankFile(body: string | Uint8Array, contentType = 'application/pkcs10;charset=UTF-8') {
  const spy = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
    const accept = (init.headers as Record<string, string>)['Accept'];
    if (accept === 'application/json') {
      return responseOf(
        JSON.stringify({ path: '/public/wallets/apple-pay/csr', status: 406, error: 'Not Acceptable' }),
        406,
        'application/json',
      );
    }
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
    return { ...responseOf('', 201, contentType), arrayBuffer: async () => bytes.buffer };
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pagbank adapter — Apple Pay charges (FUT-472)', () => {
  it('declares the Apple Pay wallet in its capability table', () => {
    expect(pagbankProvider(PT_BR_PAGBANK_COPY).capabilities.wallets).toContain('APPLE_PAY');
  });

  it('sends an Apple Pay charge as payment_method.card.wallet', async () => {
    // `key` is Apple's `token.paymentData`, serialized by the browser and
    // forwarded VERBATIM — the adapter neither parses nor re-encodes it.
    const spy = mockFetch({ id: 'ORDE_A', charges: [{ id: 'CHAR_A', status: 'PAID' }] });
    const paymentData = JSON.stringify({ data: 'opaque', header: {}, signature: 'sig' });
    await pagbankProvider(PT_BR_PAGBANK_COPY).createCharge(
      { ...cardInput('order-a'), card: { wallet: { type: 'APPLE_PAY', key: paymentData } } },
      LIVE,
    );

    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      charges: Array<{ payment_method: { card: Record<string, unknown> } }>;
    };
    expect(body.charges[0]?.payment_method.card).toEqual({
      wallet: { type: 'APPLE_PAY', key: paymentData },
    });
  });
});

describe('pagbank adapter — the Apple Pay certificate round-trip (FUT-472)', () => {
  it('POSTs the CSR request with bearer auth and finds the PEM in a schema-less body', async () => {
    const spy = mockFetch({ data: { certificate_request: PEM } });
    const answer = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.requestCsr(LIVE);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.api.pagseguro.com/wallets/apple-pay/csr');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer tok_live');
    expect(answer.csr).toBe(PEM);
  });

  it('finds a CSR answered as a bare PEM string too', async () => {
    mockFetch(PEM);
    const answer = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.requestCsr(LIVE);
    expect(answer.csr).toBe(PEM);
  });

  it('degrades an unrecognizable response to csr null with the raw body retained', async () => {
    // The operator finishes the enrolment by hand from `raw` — a guess at a
    // field name here would answer confidently and wrongly forever.
    mockFetch({ unexpected: 'shape' });
    const answer = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.requestCsr(LIVE);
    expect(answer.csr).toBeNull();
    expect(answer.raw).toEqual({ unexpected: 'shape' });
  });

  it('FUT-5196: reads the CSR PagBank answers as application/pkcs10, never asking for JSON', async () => {
    const spy = mockPagBankFile(`${PEM}\n`);
    const answer = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.requestCsr(LIVE);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Accept']).toBe('*/*');
    expect(answer.csr).toBe(PEM);
  });

  it('FUT-5196: armours a CSR answered as DER bytes', async () => {
    const der = Uint8Array.from([0x30, 0x82, 0x01, 0x17, 0x30, 0x81]);
    mockPagBankFile(der, 'application/octet-stream');
    const answer = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.requestCsr(LIVE);
    expect(answer.csr).toBe(
      ['-----BEGIN CERTIFICATE REQUEST-----', btoa(String.fromCharCode(...der)), '-----END CERTIFICATE REQUEST-----'].join('\n'),
    );
  });

  it('FUT-5196: armours a CSR answered as bare base64', async () => {
    mockPagBankFile('MIIBFzCBvgIBADBc\n', 'text/plain');
    const answer = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.requestCsr(LIVE);
    expect(answer.csr).toBe('-----BEGIN CERTIFICATE REQUEST-----\nMIIBFzCBvgIBADBc\n-----END CERTIFICATE REQUEST-----');
  });

  it('FUT-5196: a refused CSR still throws the typed provider error', async () => {
    mockFetch({ error_messages: ['unauthorized'] }, 401);
    await expect(pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.requestCsr(LIVE)).rejects.toThrow(ProviderRequestError);
  });

  it('FUT-5196: uploads the .cer without demanding a JSON answer', async () => {
    const spy = mockPagBankFile('', 'application/json');
    const answer = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.activateCertificate('-----BEGIN CERTIFICATE-----\nA\n-----END CERTIFICATE-----', LIVE);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Accept']).toBe('*/*');
    expect(answer.activated).toBe(true);
  });

  /**
   * FUT-3757: PagBank's guide uploads the FILE as the form field `cer`
   * (`--form 'cer=@"arquivo.cer"'`). The JSON `{ certificate }` body this sent
   * before was a guess the docs contradict, made before any `.cer` existed.
   */
  it('activates by uploading the .cer as the form field cer, and reads activation off the HTTP outcome', async () => {
    const spy = mockFetch({});
    const der = btoa(String.fromCharCode(0x30, 0x82, 0x01));
    const answer = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.activateCertificate(der, LIVE);

    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://sandbox.api.pagseguro.com/wallets/apple-pay/cer');
    expect(init.body).toBeInstanceOf(FormData);
    const file = (init.body as FormData).get('cer') as Blob;
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([0x30, 0x82, 0x01]);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(answer.activated).toBe(true);
  });

  it('uploads a PEM certificate as the text it already is', async () => {
    const spy = mockFetch({});
    const pem = '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----';
    await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.activateCertificate(pem, LIVE);
    const file = ((spy.mock.calls[0] as [string, RequestInit])[1].body as FormData).get('cer') as Blob;
    expect(await file.text()).toBe(pem);
  });

  it('a refused activation throws the typed provider error, never a silent false', async () => {
    mockFetch({ error_messages: ['invalid certificate'] }, 400);
    await expect(
      pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.activateCertificate('BAD', LIVE),
    ).rejects.toThrow(ProviderRequestError);
  });

  it('stub credentials answer deterministically with no network call', async () => {
    const spy = mockFetch({});
    const csr = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.requestCsr(STUB);
    const activation = await pagbankProvider(PT_BR_PAGBANK_COPY).applePay!.activateCertificate('CER', STUB);
    expect(csr.csr).toContain('BEGIN CERTIFICATE REQUEST');
    expect(activation.activated).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});
