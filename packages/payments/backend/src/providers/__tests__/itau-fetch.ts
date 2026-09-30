import { vi } from 'vitest';

import type { ResolvedCredentials } from '../../core/types';
import type { ItauCob } from '../itau-pix';

/**
 * Itaú's outermost HTTP boundary, stubbed. The SANDBOX environment presents
 * no client certificate, so its calls go through global `fetch` — which is
 * what lets these tests assert every request the adapter builds and every
 * mapping of what comes back, without a network. (The PRODUCTION mTLS route
 * is `itau-mtls-routing.test.ts`; the transport itself is `mtls.test.ts`.)
 */

export const SANDBOX_CREDS: ResolvedCredentials = {
  environment: 'SANDBOX',
  fields: { clientId: 'client-1', clientSecret: 'secret-1', pixKey: 'loja@example.com' },
};

export const TXID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456';
export const E2E = 'E60701190202609301200abcdefghijk';

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface StubAnswer {
  status?: number;
  body: unknown;
}

/**
 * Stub `fetch`: every token mint succeeds, everything else goes to `route`
 * (unrouted calls answer 404). Returns the calls, in order, token mints
 * included, for the test to assert on.
 */
export function stubItauFetch(route: (call: RecordedCall) => StubAnswer | undefined): RecordedCall[] {
  const calls: RecordedCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call: RecordedCall = {
      url: String(url),
      method: String(init.method),
      headers: init.headers as Record<string, string>,
      body: init.body as string | undefined,
    };
    calls.push(call);
    const isTokenMint = call.url.endsWith('/api/jwt') || call.url.endsWith('/api/oauth/token');
    const answer = isTokenMint ? { body: { access_token: 'token-1' } } : (route(call) ?? { status: 404, body: {} });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  });
  return calls;
}

/** A cob that has received one Pix of `valor`, carrying `devolucoes`. */
export function paidCob(valor: string, devolucoes: NonNullable<NonNullable<ItauCob['pix']>[number]['devolucoes']> = []): ItauCob {
  return {
    txid: TXID,
    status: 'CONCLUIDA',
    valor: { original: valor },
    pixCopiaECola: '00020101021226...6304ABCD',
    pix: [{ endToEndId: E2E, txid: TXID, valor, horario: '2026-09-30T12:00:00Z', devolucoes }],
  };
}

export function jsonBody(call: RecordedCall | undefined): Record<string, unknown> {
  return JSON.parse(call?.body ?? '{}') as Record<string, unknown>;
}
