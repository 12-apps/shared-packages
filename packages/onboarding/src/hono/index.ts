import { Hono } from "hono";
import type { Context } from "hono";

import {
  createApiOnboarding,
  type ApiOnboarding,
} from "../server/create-api-onboarding";
import type { OnboardingActor, OnboardingServerConfig } from "../server/context";

/**
 * `@12-apps/onboarding/hono` — the progress endpoints as a mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use, behind its own subpath with
 * `hono` as an OPTIONAL peer (the report-builder / rbac precedent — a host on
 * Express, or one that only wants the React surface, never resolves Hono).
 *
 * A host writes:
 *
 *   const onboarding = onboardingRouter({ db, resolveActor });
 *   app.route('/api/admin/:tenantSlug', onboarding.router);
 *
 * and keeps what is genuinely its own: who the caller is, which tenant the slug
 * resolves to, and the permission gate in front of both.
 */

/**
 * Resolve the caller. Returning `null` means unauthenticated (401 before any
 * handler runs); THROWING is how a host reports its own refusal (a 403 from an
 * RBAC guard, a 402 from an entitlement) — the adapter never swallows it.
 */
export type ResolveOnboardingActor = (
  c: Context,
) => Promise<OnboardingActor | null> | OnboardingActor | null;

export interface OnboardingHonoConfig extends OnboardingServerConfig {
  resolveActor: ResolveOnboardingActor;
  /** The 401 body's message. pt-BR default, like every other string here. */
  unauthenticatedMessage?: string;
}

export interface OnboardingHono extends ApiOnboarding {
  router: Hono;
}

/** Reads the JSON body, tolerating an absent or malformed one. */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === "GET") return undefined;
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the caller's error; the handler's own validation
    // reports it far better than a parse failure would.
    return undefined;
  }
}

export function onboardingRouter(config: OnboardingHonoConfig): OnboardingHono {
  const api = createApiOnboarding(config);
  const router = new Hono();
  const unauthenticated = config.unauthenticatedMessage ?? "Não autenticado.";

  for (const route of api.routes) {
    const handler = async (c: Context): Promise<Response> => {
      const actor = await config.resolveActor(c);
      if (!actor) return c.json({ error: unauthenticated }, 401);

      const response = await route.handle({
        actor,
        params: c.req.param() as Record<string, string | undefined>,
        query: c.req.query() as Record<string, string | undefined>,
        body: await readBody(c),
      });

      // The status travels with the body the handler chose; the adapter never
      // reinterprets either.
      return c.json(response.body as Record<string, unknown>, response.status as 200);
    };

    if (route.method === "GET") router.get(route.path, handler);
    else router.patch(route.path, handler);
  }

  return { ...api, router };
}
