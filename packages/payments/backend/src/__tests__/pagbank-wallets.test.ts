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

function mockFetch(response: unknown, status = 200) {
  const spy = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Bad Request',
    json: async () => response,
    text: async () => JSON.stringify(response),
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
