import type { ImpersonationBannerState } from '../core/types';

import { bannerHostMounted, waitForPaintedBanner } from './banner-host';
import { notifyImpersonationChanged } from './state';
import type { ImpersonationTransport } from './transport';

/**
 * Starting and stopping a session from the browser — the two operations that
 * have to be all-or-nothing, kept together because the failure path of the first
 * one IS the second one.
 */

/** Where the two mounts live, and how to reach them. */
export interface ImpersonationEndpoints {
  transport: ImpersonationTransport;
  /** The shared session surface: starts operator sessions, stops either kind. */
  platformPath: string;
  /** The tenant preview mount for a slug. */
  tenantPath(slug: string): string;
  /**
   * Called after a session ENDS, however it ended.
   *
   * This is where a host drops its query cache. The identity behind every cached
   * response just changed, so every cached response is now another person's —
   * and it has to be a CLEAR rather than an invalidation, which refetches only
   * what is MOUNTED and leaves the rest of the cache readable as the subject.
   */
  onEnd?(): void;
}

/** Why a start did not happen. Both are refusals, not errors. */
export type ImpersonationStartRefusal =
  /** No banner host was mounted, so nothing was requested at all. */
  | 'banner-unavailable'
  /** The session was started and then immediately undone: no bar appeared. */
  | 'banner-not-rendered';

export interface ImpersonationStartResult {
  started: boolean;
  refusal?: ImpersonationStartRefusal;
}

/** What to POST, so this stays usable by both entry points. */
interface ImpersonationStartRequest {
  path: string;
  body: unknown;
}

/** DELETE the session. Throws on anything that is not a 2xx. */
async function deleteSession(
  endpoints: ImpersonationEndpoints,
  path: string,
): Promise<void> {
  await endpoints.transport.request(path, { method: 'DELETE' });
}

/**
 * Start a session, but only behind a rendered banner — see `./banner-host` for
 * why the precondition lives here and what the two halves of it prove.
 *
 * The API error is NOT swallowed: a 402, a 403 or a 409 is the caller's to
 * render, and collapsing them into a boolean would leave every one of those
 * looking like a banner problem. This function answers only the question it can
 * answer — did a VISIBLE session start — and rethrows everything else untouched.
 */
export async function startImpersonation(
  endpoints: ImpersonationEndpoints,
  request: ImpersonationStartRequest,
): Promise<ImpersonationStartResult> {
  if (!bannerHostMounted()) return { started: false, refusal: 'banner-unavailable' };

  await endpoints.transport.request(request.path, {
    method: 'POST',
    body: request.body,
  });
  // The cookie now exists. Wake every mounted banner so the bar it is about to
  // paint is the evidence the check below waits on.
  notifyImpersonationChanged();

  if (await waitForPaintedBanner()) return { started: true };

  // Un-start it. Best effort by necessity — there is nothing left to try if the
  // exit also fails — but the server's own hard time box closes the session
  // regardless, and the caller is told plainly that it did not start.
  await deleteSession(endpoints, endpoints.platformPath).catch(() => undefined);
  notifyImpersonationChanged();
  return { started: false, refusal: 'banner-not-rendered' };
}

/**
 * WHICH exit a live session uses.
 *
 * Both mounts clear the same cookie, so either would technically work — but only
 * the tenant one files a tenant-scoped END entry for a preview, and only the
 * platform one is right for an operator session (ending that through a tenant
 * mount would record a platform session as a tenant event). A preview with no
 * tenant on the payload falls back to the platform path: getting out always
 * beats getting the paperwork right.
 */
function impersonationExitPath(
  endpoints: ImpersonationEndpoints,
  state: ImpersonationBannerState,
): string {
  if (state.kind !== 'preview' || !state.tenant) return endpoints.platformPath;
  return endpoints.tenantPath(state.tenant.slug);
}

/**
 * Drop a cookie the server has ALREADY stopped honouring — the time box closed.
 *
 * Deliberately does not run `onEnd`, and that is not an oversight: restoring the
 * actor's own view is driven by the OBSERVED end of the session (the banner's
 * transition watcher), which fires however it ended — this call, the exit
 * button, an expiry the tab slept through, or another tab. Doing it here as well
 * would leave the one path that does NOT come through here, the slept-through
 * expiry, as the only one that forgot.
 */
export async function dropExpiredImpersonation(
  endpoints: ImpersonationEndpoints,
  state: ImpersonationBannerState,
): Promise<void> {
  await deleteSession(endpoints, impersonationExitPath(endpoints, state));
  notifyImpersonationChanged();
}

/**
 * Leave the impersonation and put the actor back in their own view.
 *
 * ORDER IS THE WHOLE POINT, and it is server-first:
 *
 *   1. DELETE — the authoritative act. A THROW here leaves everything else
 *      untouched, so a failed exit is a failed exit: the bar stays up, the
 *      caches still hold the subject's data, and the operator can press it
 *      again. Nothing is half-done.
 *   2. `onEnd` — the host drops its cache.
 *   3. The notification — every mounted banner re-reads, sees no session, and
 *      takes itself down.
 *
 * No reload and no re-authentication: the actor's own session cookie was never
 * touched (that is why impersonation rides a separate one), so dropping this one
 * restores them where they stand.
 */
export async function endImpersonation(
  endpoints: ImpersonationEndpoints,
  state: ImpersonationBannerState,
): Promise<void> {
  await deleteSession(endpoints, impersonationExitPath(endpoints, state));
  endpoints.onEnd?.();
  notifyImpersonationChanged();
}
