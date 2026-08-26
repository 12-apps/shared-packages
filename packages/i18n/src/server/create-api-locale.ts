import type { WireRequest, WireResponse, WireRoute } from '@12-apps/wiring';

import { localeRoutes, type LocaleRoute, type LocaleRoutesConfig } from './locale-routes';

/**
 * The reader's-language surface as a `@12-apps/wiring` HTTP contribution.
 *
 * `@12-apps/wiring` is imported for TYPES ONLY and declared as an OPTIONAL
 * PEER — the doctrine `@12-apps/auth`'s manifest states in full. Making it a
 * runtime dependency would put the contract in every installer's tree and, worse,
 * put this package's releases behind the contract's; this package is depended on
 * by most of the estate, so that is the worst possible place for such an edge.
 *
 * The peer declaration is not optional bookkeeping. This package ships `src/`,
 * so a consumer resolving `./server` reads the import below — and a package
 * importing something it never declares is broken for that consumer even though
 * the import is erased at build time. Optional, because a host that never adopts
 * the contract never needs it installed.
 */

/**
 * The signed-in caller: an opaque user id, or `null` for nobody.
 *
 * Local rather than exported — a host reads it off `WireRoute`'s own parameter
 * and never needs to name it, and an exported alias nothing imports is exactly
 * what the unused-exports gate refuses.
 */
type LocaleActor = string | null;

function toWireRoute(route: LocaleRoute): WireRoute<LocaleActor> {
  return {
    method: route.method,
    path: route.path,
    // Both endpoints act on the caller and only the caller, so both are
    // `authenticated`. Saying it in the contract's vocabulary is what lets a
    // consumer's gate refuse before a handler runs.
    kind: 'authenticated',
    handle: async (request: WireRequest<LocaleActor>): Promise<WireResponse> => {
      // Refused HERE and not left to the host, because `session` is a property
      // of the ROUTE: which endpoints need a caller is this package's answer,
      // and a host restating it per route would eventually restate one wrong.
      // The host supplies WHO; the route decides whether it needed anybody.
      if (route.session && !request.actor) {
        return { status: 401, body: { error: 'unauthenticated' } };
      }
      return route.handle({ body: request.body, userId: request.actor });
    },
  };
}

export function createApiLocale(config: LocaleRoutesConfig): {
  routes: WireRoute<LocaleActor>[];
} {
  return { routes: localeRoutes(config).map(toWireRoute) };
}
