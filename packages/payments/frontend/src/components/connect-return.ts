'use client';

import { useEffect, useState } from 'react';

/**
 * What the OAuth connect callback redirected back with — read once, then
 * erased from the address bar (FUT-763).
 *
 * The owner leaves for the provider's site to authorize us and comes back to a
 * URL carrying the verdict. That round trip is the package's: `OAuthPanel`
 * starts it, `PaymentProviderSettings` already reads `?connected=` as the raw
 * provider name to reopen the right panel, and the codes below are the ones a
 * connect can fail with. A host re-deriving any of it is re-deriving this
 * package's own contract from the outside.
 *
 * What is NOT here is the sentence. `errorCode` comes back as a CODE precisely
 * so the words stay the host's, which is the same rule the activation copy
 * follows — a fallback string compiled in here is how one product's voice
 * reaches every adopter.
 */

/**
 * How a connect can fail, as the callback spells it.
 *
 * A union rather than a loose string because these five are shared between a
 * host's callback ROUTE, which emits them, and its copy map, which renders
 * them — two files that today agree by luck. Typed, a host's
 * `Record<ConnectErrorCode, string>` is checked for exhaustiveness, and a
 * provider failure mode nobody wrote a sentence for stops compiling.
 */
export type ConnectErrorCode =
  /** The owner declined on the provider's site. Nothing changed. */
  | 'access_denied'
  /** The CSRF state did not match — expired, or started in another tab. */
  | 'state_mismatch'
  /** The provider came back without an authorization code. */
  | 'missing_code'
  /** The callback did not say which provider it was for. */
  | 'missing_provider'
  /** The code could not be exchanged for a grant. */
  | 'exchange_failed';

export interface ConnectReturn {
  /**
   * The provider that was just connected, as the callback spells it — which is
   * the RAW name, not the URL slug. `PaymentProviderSettings` resolves either.
   */
  connected: string | null;
  /**
   * Why it failed, as a code — `null` when nothing failed.
   *
   * Deliberately widened to `string`: a code outside {@link ConnectErrorCode}
   * is passed through rather than dropped, because a host that has taught its
   * own callback a new failure is not wrong — it just has a sentence this
   * package does not know about. The union is what its copy map is keyed by;
   * this is what its callback actually said.
   */
  errorCode: string | null;
}

const NOTHING: ConnectReturn = { connected: null, errorCode: null };

/**
 * The params the connect callback owns. Erased together, and ONLY these — a
 * host's own query string survives the scrub.
 */
const CONNECT_PARAMS = ['connected', 'connectError', 'provider'] as const;

/**
 * Take the callback's verdict out of the address bar.
 *
 * Erasing is the point, not tidiness: the query string is the only place this
 * state lives, so leaving it there means a reload re-announces a connection
 * that already happened — and, worse, re-announces a FAILURE the owner has
 * since fixed.
 *
 * Take-once by construction: the second call finds nothing, because the first
 * removed it. Callers hold the result.
 */
export function takeConnectReturn(): ConnectReturn {
  // Server-rendered, or a test with no DOM: there is no address bar to read.
  if (typeof window === 'undefined') return NOTHING;

  const params = new URLSearchParams(window.location.search);
  const connected = params.get('connected');
  const errorCode = params.get('connectError');
  if (!connected && !errorCode) return NOTHING;

  for (const key of CONNECT_PARAMS) params.delete(key);
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);

  return { connected, errorCode };
}

/**
 * {@link takeConnectReturn} for a screen: taken after mount, held across every
 * later render.
 *
 * Only ever SETS when something was found, which is what keeps it correct
 * under a StrictMode double-mount: the second run finds an already-scrubbed
 * URL, and must not overwrite the verdict the first one caught.
 */
export function useConnectReturn(): ConnectReturn {
  const [taken, setTaken] = useState<ConnectReturn>(NOTHING);

  useEffect(() => {
    const outcome = takeConnectReturn();
    if (outcome.connected || outcome.errorCode) setTaken(outcome);
  }, []);

  return taken;
}
