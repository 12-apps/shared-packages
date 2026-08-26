import type { WireRequest, WireResponse, WireRoute } from '@12-apps/wiring';

import { localeRoutes, type LocaleRoute, type LocaleRoutesConfig } from './locale-routes';

/**
 * The reader's-language surface as a `@12-apps/wiring` HTTP contribution.
 *
 * `@12-apps/wiring` is a TYPE-ONLY devDependency here, the doctrine
 * `@12-apps/auth`'s manifest states in full: importing it as a runtime
 * dependency would make every installer of this package download the contract,
 * and — worse — put this package's releases behind the contract's. This package
 * is depended on by most of the estate, so it is the worst possible place for
 * that edge. Nothing below survives compilation.
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
