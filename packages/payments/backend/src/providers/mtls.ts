import { createPrivateKey, X509Certificate } from 'node:crypto';
import { request } from 'node:https';

import type { ProviderHttpInit, ProviderTransport } from './http';

/**
 * A client-certificate (mutual TLS) transport for `providerFetch`.
 *
 * Global `fetch` cannot present a client certificate: undici takes one only
 * through a `dispatcher` built from its own `Agent`, and this package ships
 * with zero runtime dependencies. A bank API that authenticates the CALLER at
 * the TLS layer (Itaú's Pix API refuses the handshake without one) therefore
 * goes through `node:https`, which takes `cert`/`key` per request.
 *
 * Per request, never pooled: adapters are stateless and one instance serves
 * every merchant, so an agent keyed by one merchant's certificate must never
 * be reachable from another merchant's call.
 */

/** A merchant's own mTLS identity, as pasted into the credential form. */
export interface ClientIdentity {
  /** PEM certificate — a leaf alone, or a leaf followed by its chain. */
  cert: string;
  /** PEM private key matching the leaf in `cert`. */
  key: string;
}

/** Idle-socket ceiling. Past it the request may already have been sent, so it is reported as a lost response. */
const IDLE_TIMEOUT_MS = 30_000;

/** Statuses a `Response` must be built with a null body for. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Whether a pasted certificate and key are usable together, checked locally
 * before any network call — so a truncated paste or a key from another
 * certificate reads as the credential problem it is, not as "unreachable".
 */
export function identityProblem(identity: ClientIdentity): 'INVALID' | 'MISMATCH' | null {
  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(identity.cert);
    const key = createPrivateKey(identity.key);
    return certificate.checkPrivateKey(key) ? null : 'MISMATCH';
  } catch {
    return 'INVALID';
  }
}

/**
 * `providerFetch`'s transport over `node:https`, presenting `identity`.
 *
 * Socket errors reject with Node's own error, whose `code` (`ECONNREFUSED`,
 * `ENOTFOUND`, …) is exactly what `isPreSendNetworkError` classifies, so the
 * shared retry rule — retry only what provably never left — holds unchanged.
 */
export function mtlsTransport(identity: ClientIdentity, trust?: { ca: string }): ProviderTransport {
  return (url: string, init: ProviderHttpInit) =>
    new Promise<Response>((resolve, reject) => {
      const outgoing = request(
        url,
        {
          method: init.method,
          headers: init.headers,
          cert: identity.cert,
          key: identity.key,
          // Omitted in production: the server is checked against Node's own
          // root store. Set only to trust a private CA (a test server).
          ...(trust ? { ca: trust.ca } : {}),
          timeout: IDLE_TIMEOUT_MS,
        },
        (incoming) => {
          const chunks: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
          incoming.on('error', reject);
          incoming.on('end', () => {
            const status = incoming.statusCode ?? 502;
            const body = NULL_BODY_STATUSES.has(status) ? null : Buffer.concat(chunks).toString('utf8');
            resolve(new Response(body, { status, statusText: incoming.statusMessage ?? '' }));
          });
        },
      );
      outgoing.on('timeout', () => {
        outgoing.destroy(Object.assign(new Error('mTLS request idle timeout'), { code: 'ETIMEDOUT' }));
      });
      outgoing.on('error', reject);
      if (init.body !== undefined) outgoing.write(init.body);
      outgoing.end();
    });
}
