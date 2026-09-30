import { ProviderRequestError } from '../core/errors';
import type { PaymentEnvironment, ResolvedCredentials } from '../core/types';
import { providerFetch, type ProviderHttpInit, type ProviderTransport } from './http';
import type { ItauCob } from './itau-pix';
import { identityProblem, mtlsTransport, type ClientIdentity } from './mtls';

/**
 * The Itaú transport half — hosts, the token mint, and the four Pix calls the
 * adapter makes. Split from `itau.ts` so the adapter reads as mapping only
 * (the seam `stone-http.ts` / `infinitepay-http.ts` established).
 */

export const NAME = 'itau';

interface ItauHosts {
  token: string;
  api: string;
}

/**
 * Fixed per environment, never tenant-supplied — the same SSRF argument
 * `stone-http.ts` makes. Production moved from `secure.api.itau` to
 * `secure.gateway.api.itau` when the old host's certificate lapsed on
 * 2026-09-15 (Itaú for Developers, "vencimento de certificados"); the token
 * service kept its host. The sandbox is the developer portal's own gateway.
 */
function itauHosts(environment: PaymentEnvironment): ItauHosts {
  return environment === 'PRODUCTION'
    ? {
        token: 'https://sts.itau.com.br/api/oauth/token',
        api: 'https://secure.gateway.api.itau/pix_recebimentos/v2',
      }
    : {
        token: 'https://devportal.itau.com.br/api/jwt',
        api: 'https://devportal.itau.com.br/sandboxapi/pix_recebimentos_ext_v2/v2',
      };
}

/** Why a credential set cannot even be tried — answered locally, before any network call. */
export type ItauSetupProblem = 'MISSING' | 'CERTIFICATE_MISSING' | 'CERTIFICATE_INVALID' | 'CERTIFICATE_MISMATCH';

function identityOf(credentials: ResolvedCredentials): ClientIdentity | null {
  const cert = credentials.fields['certificate']?.trim();
  const key = credentials.fields['privateKey']?.trim();
  return cert && key ? { cert, key } : null;
}

/**
 * Production REQUIRES the merchant's mTLS identity on every call, the token
 * mint included — Itaú refuses the handshake without it. The sandbox does
 * not use one, so there it is optional (and presented when given).
 */
export function itauSetupProblem(credentials: ResolvedCredentials): ItauSetupProblem | null {
  if (!credentials.fields['clientId'] || !credentials.fields['clientSecret'] || !credentials.fields['pixKey']) {
    return 'MISSING';
  }
  const identity = identityOf(credentials);
  if (!identity) return credentials.environment === 'PRODUCTION' ? 'CERTIFICATE_MISSING' : null;
  const problem = identityProblem(identity);
  if (problem === 'INVALID') return 'CERTIFICATE_INVALID';
  if (problem === 'MISMATCH') return 'CERTIFICATE_MISMATCH';
  return null;
}

/** One call, authenticated: path relative to the Pix API base. */
type ItauCall = <T>(label: string, path: string, init: Omit<ProviderHttpInit, 'headers'> & { json?: unknown }) => Promise<T>;

interface AccessToken {
  access_token?: string;
}

/**
 * Mint a token and hand back a caller bound to it. Itaú's tokens live five
 * minutes, so one is minted per OPERATION and shared only by that
 * operation's own calls (a refund's read-then-write) — never cached across
 * operations, which would make this stateless adapter hold merchant state.
 */
export async function itauSession(credentials: ResolvedCredentials): Promise<ItauCall> {
  const setup = itauSetupProblem(credentials);
  if (setup) {
    throw new ProviderRequestError(NAME, `Itau credentials unusable: ${setup}.`, { retriable: false, providerCode: setup });
  }
  const identity = identityOf(credentials);
  const transport: ProviderTransport | undefined = identity ? mtlsTransport(identity) : undefined;
  const hosts = itauHosts(credentials.environment);
  const clientId = credentials.fields['clientId'] ?? '';
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: credentials.fields['clientSecret'] ?? '',
  });
  const token = await providerFetch<AccessToken>(
    NAME,
    'oauth/token',
    hosts.token,
    { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() },
    transport,
  );
  if (!token.access_token) {
    throw new ProviderRequestError(NAME, 'Itau token response carried no access_token.', { retriable: false });
  }
  const headers: Record<string, string> = { authorization: `Bearer ${token.access_token}` };
  return <T>(label: string, path: string, init: Omit<ProviderHttpInit, 'headers'> & { json?: unknown }) =>
    providerFetch<T>(
      NAME,
      label,
      `${hosts.api}${path}`,
      init.json === undefined
        ? { method: init.method, headers }
        : { method: init.method, headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(init.json) },
      transport,
    );
}

/** `GET /cob/{txid}` — the one read every path here (status, refund, webhook) confirms against. */
export function readCob(call: ItauCall, txid: string): Promise<ItauCob> {
  return call<ItauCob>('pix/cob', `/cob/${encodeURIComponent(txid)}`, { method: 'GET' });
}
