import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPlatformHomologacaoAnexo,
  type PlatformHomologacaoAnexoInput,
} from '../platform/homologacao-anexo';
import { PT_BR_HOMOLOGACAO_ANSWERS } from '../platform/pt-BR';

/**
 * The platform's anexo generator (FUT-483, packaged by FUT-573). Pinned:
 *
 *  - the token arrives per call and must be the platform's SANDBOX token; a
 *    missing one refuses before any network call;
 *  - the evidence pairs carry the real request/response with the bearer
 *    REDACTED, and the header names BOTH services plus the reviewer-visitable
 *    storefront;
 *  - each failure mode maps to its specific reason, not a throw.
 */

function input(over: Partial<PlatformHomologacaoAnexoInput> = {}): PlatformHomologacaoAnexoInput {
  return {
    sandboxToken: 'sandbox-token',
    brandName: 'Aurora',
    publicBaseUrl: 'https://app.example.com',
    demoStoreUrl: 'https://app.example.com/demo-balcao/menu',
    webhookUrl: 'https://app.example.com/api/webhooks/pagseguro/demo-balcao/notifications',
    integrationSummary: PT_BR_HOMOLOGACAO_ANSWERS.integrationSummary({
      demoStoreUrl: 'https://app.example.com/demo-balcao/menu',
      webhookUrl: 'https://app.example.com/api/webhooks/pagseguro/demo-balcao/notifications',
    }),
    ...over,
  };
}

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildPlatformHomologacaoAnexo', () => {
  it('fails with NO_SANDBOX_TOKEN before any network call', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await buildPlatformHomologacaoAnexo(input({ sandboxToken: null }));

    expect(result).toEqual({ ok: false, reason: 'NO_SANDBOX_TOKEN' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails with TOKEN_REJECTED when the sandbox refuses the token', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error_messages: ['unauthorized'] }, 401, 'Unauthorized')),
    );

    const result = await buildPlatformHomologacaoAnexo(input());

    expect(result).toEqual({ ok: false, reason: 'TOKEN_REJECTED' });
  });

  it('fails with SANDBOX_UNREACHABLE on a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );

    const result = await buildPlatformHomologacaoAnexo(input());

    expect(result).toEqual({ ok: false, reason: 'SANDBOX_UNREACHABLE' });
  });

  it('captures create + consult + public key, token-redacted, platform-framed', async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        seen.push({
          url,
          auth: (init?.headers as Record<string, string> | undefined)?.Authorization,
        });
        if (url.endsWith('/orders')) return jsonResponse({ id: 'ORDE_1', qr_codes: [{}] });
        if (url.includes('/orders/')) return jsonResponse({ id: 'ORDE_1', status: 'WAITING' });
        return jsonResponse({ public_key: 'PUB123' });
      }),
    );

    const result = await buildPlatformHomologacaoAnexo(input());

    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    expect(result.anexo.filename).toBe('pagbank-homologacao-anexo-plataforma.txt');
    const content = result.anexo.content;
    // The three evidence pairs, in integration order.
    expect(content).toContain('POST https://sandbox.api.pagseguro.com/orders');
    expect(content).toContain('GET https://sandbox.api.pagseguro.com/orders/ORDE_1');
    expect(content).toContain('POST https://sandbox.api.pagseguro.com/public-keys');
    // Platform-framed: BOTH services named, and the storefront is the host's.
    expect(content).toContain('API de Pedidos e Pagamentos (Order) e API Connect');
    expect(content).toContain('https://app.example.com/demo-balcao/menu');
    // The create carried the host's webhook URL for `notification_urls`.
    expect(content).toContain('api/webhooks/pagseguro/demo-balcao/notifications');
    // The real token went to PagBank but never into the file.
    expect(seen.every((call) => call.auth === 'Bearer sandbox-token')).toBe(true);
    expect(content).not.toContain('sandbox-token');
    expect(content).toContain('Bearer ***REDACTED***');
  });

  it('still produces the file when the create answers without an order id', async () => {
    // A sandbox validation failure is still evidence the reviewer can read;
    // only the consult pair (which needs the id) is skipped.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/orders')) {
          return jsonResponse({ error_messages: ['invalid'] }, 400, 'Bad Request');
        }
        return jsonResponse({ public_key: 'PUB123' });
      }),
    );

    const result = await buildPlatformHomologacaoAnexo(input());

    if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
    expect(result.anexo.content).toContain('HTTP 400 Bad Request');
    expect(result.anexo.content).not.toContain('GET https://sandbox.api.pagseguro.com/orders/');
    expect(result.anexo.content).toContain('POST https://sandbox.api.pagseguro.com/public-keys');
  });
});
