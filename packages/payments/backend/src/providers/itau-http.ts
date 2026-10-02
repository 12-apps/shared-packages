import { X509Certificate } from 'node:crypto';

import { CredentialsError, ProviderRequestError } from '../core/errors';
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
export type ItauSetupProblem =
  | 'MISSING'
  | 'CERTIFICATE_MISSING'
  | 'CERTIFICATE_INVALID'
  | 'CERTIFICATE_MISMATCH'
  | 'CERTIFICATE_EXPIRED'
  | 'CERTIFICATE_NOT_YET_VALID';

/** Far above any certificate chain; bounds the work a hostile paste can buy. */
const PEM_MAX_LENGTH = 64 * 1024;
const PEM_MAX_BLOCKS = 10;
const PEM_BEGIN = '-----BEGIN ';
const PEM_DASHES = '-----';
const PEM_LABEL = /^[A-Z0-9 ]{1,40}$/;

interface PemBlock {
  label: string;
  body: string;
  /** Index just past this block's END line. */
  next: number;
}

/**
 * The next complete `BEGIN … END` block at or after `from`, found by
 * `indexOf` rather than one regex over the whole paste: a lazy
 * `BEGIN (…)-----([\s\S]*?)-----END \1` backtracks polynomially on a
 * crafted string, and this text is whatever an owner (or an attacker with
 * their session) pastes. Linear in the input.
 */
function nextPemBlock(text: string, from: number): PemBlock | null {
  for (let cursor = from; ; ) {
    const begin = text.indexOf(PEM_BEGIN, cursor);
    if (begin < 0) return null;
    const labelEnd = text.indexOf(PEM_DASHES, begin + PEM_BEGIN.length);
    if (labelEnd < 0) return null;
    const label = text.slice(begin + PEM_BEGIN.length, labelEnd);
    const endLine = `-----END ${label}-----`;
    const end = PEM_LABEL.test(label) ? text.indexOf(endLine, labelEnd) : -1;
    if (end >= 0) return { label, body: text.slice(labelEnd + PEM_DASHES.length, end), next: end + endLine.length };
    cursor = labelEnd + PEM_DASHES.length;
  }
}

/**
 * A PEM as OpenSSL reads it, whatever a paste did to it. A single-line input,
 * a chat app or a spreadsheet cell folds the newlines into spaces or drops
 * them, and OpenSSL refuses both — so every block is rebuilt: armour lines on
 * their own, the base64 body stripped of whitespace and re-wrapped at 64.
 * Several blocks (a leaf and its chain) survive in order. Text with no block
 * at all is returned trimmed, for `identityProblem` to call unreadable.
 */
export function normalizePem(text: string): string {
  if (text.length > PEM_MAX_LENGTH) return text.trim();
  const blocks: string[] = [];
  for (let block = nextPemBlock(text, 0); block && blocks.length < PEM_MAX_BLOCKS; block = nextPemBlock(text, block.next)) {
    const lines = block.body.replace(/\s+/g, '').match(/.{1,64}/g) ?? [];
    blocks.push([`-----BEGIN ${block.label}-----`, ...lines, `-----END ${block.label}-----`].join('\n'));
  }
  return blocks.length > 0 ? `${blocks.join('\n')}\n` : text.trim();
}

function identityOf(credentials: ResolvedCredentials): ClientIdentity | null {
  const cert = credentials.fields['certificate']?.trim();
  const key = credentials.fields['privateKey']?.trim();
  return cert && key ? { cert: normalizePem(cert), key: normalizePem(key) } : null;
}

/**
 * When the pasted production certificate stops working, as an ISO instant —
 * what lets a screen warn the owner inside Itaú's 30-day renewal window
 * instead of the store finding out when PIX stops. Null when no certificate
 * is saved or it cannot be read; a garbled paste is `verifyCredentials`'s to
 * name, not a date to show.
 */
export function itauCertificateExpiry(fields: Readonly<Record<string, string>>): string | null {
  const pem = fields['certificate']?.trim();
  if (!pem) return null;
  try {
    const validTo = new Date(new X509Certificate(normalizePem(pem)).validTo);
    return Number.isNaN(validTo.getTime()) ? null : validTo.toISOString();
  } catch {
    return null;
  }
}

const IDENTITY_SETUP: Record<NonNullable<ReturnType<typeof identityProblem>>, ItauSetupProblem> = {
  INVALID: 'CERTIFICATE_INVALID',
  MISMATCH: 'CERTIFICATE_MISMATCH',
  EXPIRED: 'CERTIFICATE_EXPIRED',
  NOT_YET_VALID: 'CERTIFICATE_NOT_YET_VALID',
};

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
  return problem ? IDENTITY_SETUP[problem] : null;
}

/**
 * A credential set that cannot be tried at all. A `CredentialsError`, so the
 * charge walk reads it as the gateway refusal it is (DEFINITELY_NOT_CHARGED)
 * and fails over — a misconfigured Itaú must never stop a buyer from paying
 * through the next provider in the chain.
 */
class ItauSetupError extends CredentialsError {
  constructor(readonly problem: ItauSetupProblem) {
    super(NAME, `Itau credentials unusable: ${problem}.`);
  }
}

/**
 * The token mint failed. Also a `CredentialsError`, for the same reason and
 * one more: the mint is its own endpoint, so whatever happened to it, no cob
 * was requested and nothing can have been charged. `httpStatus` is present
 * when Itaú answered; `mtls` says a client certificate was presented, so a
 * reset handshake there means the certificate was refused, not an outage.
 */
export class ItauTokenError extends CredentialsError {
  constructor(
    message: string,
    readonly detail: { httpStatus?: number; mtls: boolean; cause?: unknown },
  ) {
    super(NAME, message);
    this.cause = detail.cause;
  }
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
/**
 * How a failed token mint is reported.
 *
 *   'typed' — as an {@link ItauTokenError}. For raising a charge (the walk
 *             reads it as not charged and fails over) and for the credential
 *             probe (which reads its detail).
 *   'raw'   — as the failure itself. For everything that asks about money
 *             already in flight — reading a charge, the walk's reference
 *             probe, a refund, a webhook. A retriable 5xx must stay
 *             retriable there, and the probe in particular must never answer
 *             a mint outage with an error the walk could mistake for "nothing
 *             was charged".
 */
type MintFailureMode = 'typed' | 'raw';

export async function itauSession(credentials: ResolvedCredentials, mode: MintFailureMode = 'raw'): Promise<ItauCall> {
  const setup = itauSetupProblem(credentials);
  if (setup) throw new ItauSetupError(setup);
  const identity = identityOf(credentials);
  const transport: ProviderTransport | undefined = identity ? mtlsTransport(identity) : undefined;
  const hosts = itauHosts(credentials.environment);
  const token = await mintToken(credentials, hosts.token, transport).catch((error: unknown) => {
    throw mode === 'raw' && error instanceof ItauTokenError ? rawMintFailure(error) : error;
  });
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
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

function rawMintFailure(error: ItauTokenError): unknown {
  return error.detail.cause ?? new ProviderRequestError(NAME, error.message, { retriable: true });
}

async function mintToken(credentials: ResolvedCredentials, url: string, transport: ProviderTransport | undefined): Promise<string> {
  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.fields['clientId'] ?? '',
    client_secret: credentials.fields['clientSecret'] ?? '',
  });
  let token: AccessToken;
  try {
    token = await providerFetch<AccessToken>(
      NAME,
      'oauth/token',
      url,
      { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() },
      transport,
    );
  } catch (cause) {
    const httpStatus = cause instanceof ProviderRequestError ? cause.options.httpStatus : undefined;
    throw new ItauTokenError('Itau token mint failed.', { httpStatus, mtls: transport !== undefined, cause });
  }
  if (!token.access_token) {
    throw new ItauTokenError('Itau token response carried no access_token.', { httpStatus: 200, mtls: transport !== undefined });
  }
  return token.access_token;
}

/** `GET /cob/{txid}` — the one read every path here (status, refund, webhook) confirms against. */
export function readCob(call: ItauCall, txid: string): Promise<ItauCob> {
  return call<ItauCob>('pix/cob', `/cob/${encodeURIComponent(txid)}`, { method: 'GET' });
}
