/**
 * The consent surface's WIRE — the one module both halves of this package import.
 *
 * Two paths and one response body. It is its own module, in the framework-free
 * core, because the browser gate and the backend descriptors are the two things
 * that must never disagree about them: the gate asking `/consent/state` while the
 * surface answers `/consent/status` is a prompt that never appears, and the
 * failure it is meant to prevent (a user blocked by a guard with nothing telling
 * them why) is exactly what comes back.
 *
 * Paths are relative to the host's mount, so a host that mounts the surface
 * somewhere other than `/api` moves both halves with one config value.
 */

/** `GET` — is this caller overdue to accept the current terms? */
export const CONSENT_STATUS_PATH = '/consent/status';

/** `POST` — record an acceptance of the current terms. Answers 204. */
export const CONSENT_ACCEPT_PATH = '/consent/terms';

/**
 * What `GET {CONSENT_STATUS_PATH}` answers.
 *
 * `stale` is the only thing the gate keys on. `version` is what the caller was
 * measured against, so a client can log or display which document it is being
 * asked about without a second endpoint.
 *
 * An ANONYMOUS caller is `stale: false`. A signed-out visitor is not overdue for
 * anything, they are simply signed out, and conflating the two is what made the
 * original `401` unreadable.
 */
export interface ConsentStatus {
  stale: boolean;
  version: string;
}
