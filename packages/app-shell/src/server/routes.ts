/**
 * The consent surface's route DESCRIPTORS (12-18) — the package half of a
 * host's `consent/{status,terms}` endpoints.
 *
 * Framework-neutral: a descriptor takes a normalized request and answers a status
 * + body, so `./hono` is an adapter rather than the contract.
 *
 * ## Why this surface exists at all
 *
 * `POST /consent/terms` could always FIX a signed-in caller whose acceptance had
 * gone stale. Nothing could TELL them they were stale, so nobody ever called it: a
 * version bump turned every previously-consented user into a pending one
 * silently — still signed in, avatar and cart intact — and the first thing they
 * heard was a bare `401 {"error":"Unauthorized"}` at the payment step, with a
 * retry that could never succeed. `GET /consent/status` is the missing half, and
 * the browser gate in `./react` is what renders it.
 *
 * Deliberately NOT folded onto the session payload: a session callback is
 * edge-safe and makes no database call by design, so asking there would either
 * break that guarantee or answer from a token minted before the bump.
 *
 * `config.termsVersion` is read when a request is HANDLED, not when the routes are
 * built. That is a property and not an accident: a host may hold the version behind a
 * getter and move it without rebuilding its router, which is the only way anything can
 * reproduce a bump without a restart. Keep it that way — hoisting it into a `const`
 * here would silently pin every answer to the version present at boot.
 */
import { CONSENT_ACCEPT_PATH, CONSENT_STATUS_PATH } from '../core/consent-wire';
import type { ConsentStatus } from '../core/consent-wire';

import {
  foldApiError,
  messagesOf,
  noContent,
  ok,
  type AppShellCookie,
  type AppShellRequest,
  type AppShellResponse,
  type AppShellRoute,
  type AppShellServerConfig,
} from './config';

/** Default lifetime of the signed handoff cookie: one OAuth round trip. */
const DEFAULT_COOKIE_TTL_MS = 10 * 60 * 1000;

function statusRoute(config: AppShellServerConfig): AppShellRoute {
  return {
    method: 'GET',
    path: CONSENT_STATUS_PATH,
    async handle(request: AppShellRequest): Promise<AppShellResponse> {
      try {
        const actor = await config.consent.resolveActor(request);
        const version = config.termsVersion;
        // Anonymous is not overdue for anything — see `ConsentStatus`.
        if (!actor) return ok({ stale: false, version } satisfies ConsentStatus);
        const current = await config.consent.isCurrent(actor, version);
        return ok({ stale: !current, version } satisfies ConsentStatus);
      } catch (error) {
        return foldApiError(error, messagesOf(config));
      }
    },
  };
}

/**
 * The signed handoff cookie, when the host configured one.
 *
 * Planted for EVERY acceptance, including an anonymous one: its whole job is to
 * carry consent from a sign-up form through the OAuth round trip, which is the
 * one flow where there is no account to stamp yet.
 */
function handoffCookie(config: AppShellServerConfig): AppShellCookie[] {
  const { cookie } = config.consent;
  if (!cookie) return [];
  const ttlMs = cookie.ttlMs ?? DEFAULT_COOKIE_TTL_MS;
  return [
    {
      name: cookie.name,
      value: cookie.sign(config.termsVersion, Date.now() + ttlMs),
      maxAge: Math.floor(ttlMs / 1000),
      path: '/',
      // httpOnly so it cannot be forged through `document.cookie`, which is what
      // keeps the sign-in gate's consent check trustworthy.
      httpOnly: true,
      sameSite: 'lax',
      // Secure by DEFAULT. A package cannot read a host's `NODE_ENV`, so the only
      // question is which way silence points, and a security flag defaulting off means
      // an adopter who omits it ships a plaintext consent token to production. The
      // opposite mistake is loud and local: on a plain-HTTP dev box the browser simply
      // refuses to store it, the sign-up handoff visibly breaks on the first try, and
      // `secure: false` is the one-word opt-out.
      secure: cookie.secure ?? true,
    },
  ];
}

function acceptRoute(config: AppShellServerConfig): AppShellRoute {
  return {
    method: 'POST',
    path: CONSENT_ACCEPT_PATH,
    async handle(request: AppShellRequest): Promise<AppShellResponse> {
      try {
        const actor = await config.consent.resolveActor(request);
        if (actor) {
          // Not wrapped in a try: a stamping failure must reach the caller as a
          // 500. Answering 204 over it would report "accepted" while leaving them
          // stale and refused by every guard, with no signal to retry — the exact
          // dead end this surface replaces, one level deeper.
          await config.consent.record(actor, config.termsVersion);
          // After the write, never before: a woken tab re-ASKS, so publishing
          // first would race the write and re-block the tab it just freed.
          config.consent.onAccepted?.(actor);
        }
        return noContent(handoffCookie(config));
      } catch (error) {
        return foldApiError(error, messagesOf(config));
      }
    },
  };
}

/**
 * The surface, in mount order.
 *
 * `/consent/status` first, though nothing here matches greedily — the two paths
 * differ in their last segment and in their method. Order is still part of the
 * surface: an adapter mounts the array verbatim, so a later route added under
 * `/consent/:something` would have to come after both.
 */
export function appShellRoutes(config: AppShellServerConfig): AppShellRoute[] {
  return [statusRoute(config), acceptRoute(config)];
}
