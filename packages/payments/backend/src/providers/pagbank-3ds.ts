import { ProviderRequestError } from '../core/errors';
import { recordedFetch } from '../core/traffic-recorder';
import type { PaymentEnvironment, ResolvedCredentials, ThreeDSecureSession } from '../core/types';

import { NAME } from './pagbank-http';

/**
 * PagBank's 3-D Secure session (FUT-3754) — what the browser's
 * `PagSeguro.setUp({ session, env })` takes before `authenticate3DS` can run.
 *
 * Per "Criar sessão de autenticação 3DS": `POST /checkout-sdk/sessions` on the
 * SDK host (not the Orders API host), `Authorization: Bearer <seller token>`,
 * no body; it answers `{ session, expires_at }`, valid for 30 minutes. A debit
 * charge cannot be raised without it: `DEBIT_CARD` requires
 * `authentication_method: { type: 'THREEDS', id }`, and that id only comes out
 * of the SDK the session sets up.
 *
 * Never retried on an HTTP answer. It moves no money, but a 4xx is the token's
 * verdict and asking again changes nothing.
 */

/** The SDK hosts — like {@link pagbankApiBase}, chosen by environment alone. */
export function pagbankSdkBase(environment: PaymentEnvironment): string {
  return environment === 'PRODUCTION'
    ? 'https://sdk.pagseguro.com'
    : 'https://sandbox.sdk.pagseguro.com';
}

/** A stub session lasts as long as a real one, so a stub checkout times out the same way. */
const SESSION_TTL_MS = 30 * 60 * 1000;

interface PagBankSessionResponse {
  session?: unknown;
  expires_at?: unknown;
}

export async function createPagbankThreeDSecureSession(
  credentials: ResolvedCredentials,
): Promise<ThreeDSecureSession> {
  const environment = credentials.environment;
  if (credentials.stub) {
    return { session: 'stub-3ds-session', expiresAt: Date.now() + SESSION_TTL_MS, environment };
  }
  const res = await recordedFetch(`${pagbankSdkBase(environment)}/checkout-sdk/sessions`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.fields['token'] ?? ''}`,
    },
  });
  const body = (await res.json().catch(() => null)) as PagBankSessionResponse | null;
  const session = typeof body?.session === 'string' ? body.session : '';
  if (!res.ok || session === '') {
    throw new ProviderRequestError(NAME, `3DS session refused (HTTP ${res.status})`, {
      httpStatus: res.status,
      body,
    });
  }
  const expiresAt = typeof body?.expires_at === 'number' ? body.expires_at : Date.now() + SESSION_TTL_MS;
  return { session, expiresAt, environment };
}
