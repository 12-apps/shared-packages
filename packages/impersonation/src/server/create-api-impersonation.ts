import { createPathRules } from '../core/paths';
import { createSessionCodec, type ImpersonationSessionCodec } from '../core/session';
import type { ImpersonationState } from '../core/types';

import type {
  ImpersonationRequest,
  ImpersonationRoute,
  ImpersonationServerConfig,
} from './context';
import { liveSession, type LiveSession } from './live-session';
import { platformRoutes } from './routes-platform';
import { previewRoutes } from './routes-preview';
import { createRefusals } from './refusals';
import { createImpersonationGuard, type ImpersonationGuard } from './write-guard';

/**
 * The one thing this package exposes to a BACKEND host.
 *
 * What stays the HOST's, and is passed in rather than guessed at:
 *
 *  - **who is calling** — authentication, tenant resolution and the caller's
 *    resolved permission ids arrive as an {@link ImpersonationActor}; this
 *    surface narrows against them, it does not compute them.
 *  - **where the data lives** — the four lookups behind
 *    {@link ImpersonationServerConfig.directory}.
 *  - **billing** — the tenant's plan and consent switch, answered by
 *    {@link ImpersonationServerConfig.previewEntitlement} before delegating.
 *  - **the host's own catalogs and vocabularies** — the money-path list, the
 *    account prefixes, the apps a session may land in, the permission id, and
 *    every user-facing sentence. These are what the host CONFIGURES this
 *    surface with; none of them ships here, and none of them is defaulted.
 */
export interface ApiImpersonation {
  /**
   * The whole surface, in mount order, each descriptor naming which of the two
   * mounts it belongs to.
   */
  routes: ImpersonationRoute[];
  /**
   * The per-request gate every OTHER route in the host calls, at the top of the
   * request and before any parse.
   */
  guard: ImpersonationGuard;
  /**
   * The impersonation in force for a request, for the host's own actor
   * resolution. Synchronous and database-free.
   */
  readState(request: Pick<ImpersonationRequest, 'actor' | 'cookieValue'>): ImpersonationState | null;
  /** The same, with the raw payload alongside — for a host that needs the window. */
  readSession(
    request: Pick<ImpersonationRequest, 'actor' | 'cookieValue'>,
  ): LiveSession | null;
  /**
   * The cookie codec, for a host that mints or reads outside these routes (a
   * test fixture, a maintenance script).
   */
  codec: ImpersonationSessionCodec;
}

export function createApiImpersonation(
  config: ImpersonationServerConfig,
): ApiImpersonation {
  const codec = createSessionCodec({
    cookieName: config.cookieName,
    secure: config.secure,
    codec: config.codec,
    timeBox: config.timeBox,
  });
  const refusals = createRefusals({
    audit: config.audit,
    directory: config.directory,
    messages: config.messages,
    // A refusal whose trail write fails must still refuse, so the loss is
    // reported rather than raised — see `createRefusals`.
    onError: config.onError,
  });
  const parts = { config, codec, refusals };

  return {
    routes: [...platformRoutes(parts), ...previewRoutes(parts)],
    guard: createImpersonationGuard({
      rules: createPathRules(config.paths),
      messages: config.messages,
      previewEntitlement: config.previewEntitlement,
      onError: config.onError,
    }),
    readState: (request) => liveSession(codec, request)?.state ?? null,
    readSession: (request) => liveSession(codec, request),
    codec,
  };
}
