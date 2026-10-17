import { PaymentsError } from '../core/errors';
import type { MerchantRef } from '../core/types';
import type { ProviderTransport } from '../providers/http';
import { identityProblem, mtlsTransport, type ClientIdentity } from '../providers/mtls';

import { applePayValidationUrl } from './gateway-hosts';
import type {
  ApplePayIdentityPort,
  ApplePayMerchantIdentity,
  ApplePayMerchantSession,
  ApplePayValidationFailureCode,
  ApplePayValidationResult,
} from './types';

/**
 * Apple Pay merchant validation (FUT-3686) — the server step between the tap
 * and the sheet.
 *
 * Safari hands the page a `validationURL`; the page sends it here; this calls
 * it over MUTUAL TLS with the merchant identity certificate and answers the
 * opaque merchant session the page passes to `completeMerchantValidation`.
 * Apple, "Requesting an Apple Pay payment session":
 * https://developer.apple.com/documentation/applepayontheweb/requesting-an-apple-pay-payment-session
 *
 * Server-only (`node:https`, through `providers/mtls.ts`), which is why it
 * ships at the `./apple-pay` subpath and never on the root entry.
 */

/**
 * A validation that failed, with a stable {@link ApplePayValidationFailureCode}.
 *
 * The message is for an operator's log and never names secret material: no
 * certificate, no key, no session. `httpStatus` is Apple's, for
 * `UPSTREAM_REFUSED` only.
 */
export class ApplePayValidationError extends PaymentsError {
  constructor(
    readonly code: ApplePayValidationFailureCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super('ApplePayValidationError', message);
  }
}

export interface ApplePayValidationInput {
  /** The URL Safari handed the page — UNTRUSTED until it matches Apple's list. */
  validationURL: string;
  /** The page's domain, as registered with Apple (`initiativeContext`). */
  domain: string;
  /** Whose merchant identity to present. */
  merchant: MerchantRef;
}

export interface ApplePayValidationDeps {
  identity: ApplePayIdentityPort;
  /**
   * The whole call's deadline. Defaults to 10 s: Apple expects the page to
   * complete validation within the sheet's own 30 s, and a buyer staring at a
   * spinner for longer than this has already given up.
   */
  timeoutMs?: number;
  /** The wire, for tests. Defaults to `mtlsTransport` — a real client-certificate handshake. */
  transport?: (identity: ClientIdentity) => ProviderTransport;
}

const DEFAULT_TIMEOUT_MS = 10_000;

/** A fully qualified domain name: dot-separated LDH labels, 253 characters at most. */
const FQDN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The domain, lower-cased, when it is a bare FQDN — no scheme, port, path or trailing dot. */
export function applePayDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const domain = raw.toLowerCase();
  return FQDN.test(domain) ? domain : null;
}

/**
 * The parsed hostname of a refused URL, for the operator's log — never the
 * whole URL: its path and query are the caller's, and nothing of them is
 * worth writing down.
 */
function hostOf(raw: unknown): string {
  if (typeof raw !== 'string') return 'not a string';
  try {
    return new URL(raw).hostname.slice(0, 253) || 'no host';
  } catch {
    return 'unparseable';
  }
}

/**
 * The identity, with the port's own failure TYPED — fail closed, as the
 * declaration gate does. The port's error is not chained: it is the host's,
 * and may say anything about where its keys live.
 */
async function identityFor(port: ApplePayIdentityPort, merchant: MerchantRef): Promise<ApplePayMerchantIdentity | null> {
  try {
    return await port.merchantIdentity(merchant);
  } catch {
    return fail('IDENTITY_UNAVAILABLE', 'The merchant identity could not be read');
  }
}

function fail(code: ApplePayValidationFailureCode, message: string, httpStatus?: number): never {
  throw new ApplePayValidationError(code, message, httpStatus);
}

/** Refuse a domain the identity says it is not registered for. */
function assertRegistered(identity: ApplePayMerchantIdentity, domain: string): void {
  if (!identity.domains) return;
  const registered = identity.domains.some((entry) => entry.toLowerCase() === domain);
  if (!registered) fail('INVALID_DOMAIN', `Domain ${domain} is not registered for this merchant identity`);
}

/** Apple's documented request body: who the merchant is, and which web page asks. */
function sessionRequestBody(identity: ApplePayMerchantIdentity, domain: string): string {
  return JSON.stringify({
    merchantIdentifier: identity.merchantIdentifier,
    displayName: identity.displayName,
    initiative: 'web',
    initiativeContext: domain,
  });
}

/** Whether a transport rejection is a timeout (the mTLS transport's own idle timer included). */
function isTimeout(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'ETIMEDOUT';
}

/**
 * Send, under one deadline. On the deadline the request is ABORTED — the
 * transport destroys the socket — rather than merely abandoned, so a slow
 * Apple cannot pin one connection per tap for the transport's idle timeout.
 * The race stays as the backstop for a transport that ignores the signal.
 * Every rejection becomes a typed error; nothing of the identity rides on it.
 */
async function send(
  transport: ProviderTransport,
  url: URL,
  body: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApplePayValidationError('TIMEOUT', `No answer from ${url.hostname} in ${timeoutMs} ms`));
    }, timeoutMs);
  });
  const init = { method: 'POST' as const, headers: { 'content-type': 'application/json' }, body, signal: controller.signal };
  try {
    return await Promise.race([transport(url.href, init), deadline]);
  } catch (error) {
    if (error instanceof ApplePayValidationError) throw error;
    if (isTimeout(error) || controller.signal.aborted) fail('TIMEOUT', `No answer from ${url.hostname} in time`);
    return fail('UNREACHABLE', `Merchant validation could not reach ${url.hostname}`);
  } finally {
    clearTimeout(timer);
  }
}

/** The session, when Apple answered 2xx with a JSON object. The body is never echoed into an error. */
async function sessionOf(response: Response, host: string): Promise<ApplePayMerchantSession> {
  if (!response.ok) {
    fail('UPSTREAM_REFUSED', `${host} refused merchant validation with HTTP ${response.status}`, response.status);
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return fail('INVALID_RESPONSE', `${host} answered merchant validation with a body that is not JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('INVALID_RESPONSE', `${host} answered merchant validation with something other than a session object`);
  }
  return parsed as ApplePayMerchantSession;
}

/**
 * Validate the merchant for one Apple Pay session.
 *
 * Checks run cheapest-and-most-hostile first, and the URL check runs BEFORE
 * the identity is even loaded: a forged URL costs nothing and touches no key.
 *
 * Resolves `{ status: 'NOT_CONFIGURED' }` when the port has no merchant
 * identity — a store state the page answers by not offering Apple Pay, not a
 * failure. Throws {@link ApplePayValidationError} for everything else that
 * goes wrong.
 */
export async function validateApplePayMerchant(
  input: ApplePayValidationInput,
  deps: ApplePayValidationDeps,
): Promise<ApplePayValidationResult> {
  const url = applePayValidationUrl(input.validationURL);
  if (!url) fail('INVALID_VALIDATION_URL', `The validation URL's host (${hostOf(input.validationURL)}) is not an Apple Pay gateway host`);
  const domain = applePayDomain(input.domain);
  if (!domain) fail('INVALID_DOMAIN', 'The domain is not a fully qualified domain name');

  const identity = await identityFor(deps.identity, input.merchant);
  if (!identity) return { status: 'NOT_CONFIGURED' };
  assertRegistered(identity, domain);

  const client: ClientIdentity = { cert: identity.certificate, key: identity.privateKey };
  const problem = identityProblem(client);
  if (problem) fail('IDENTITY_UNUSABLE', `The merchant identity certificate is unusable (${problem})`);

  const transport = (deps.transport ?? mtlsTransport)(client);
  const response = await send(transport, url, sessionRequestBody(identity, domain), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  return { status: 'VALIDATED', session: await sessionOf(response, url.hostname) };
}
