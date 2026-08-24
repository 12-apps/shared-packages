import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  createApiEntitlements,
  type ApiEntitlements,
  type ApiEntitlementsConfig,
  type EntitlementsActor,
} from '../server/create-api-entitlements';

/**
 * `@12-apps/entitlements/hono` — the entitlement endpoints as a mountable
 * router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is
 * the adapter for the framework we happen to use. It lives behind its own
 * subpath with `hono` as an OPTIONAL peer, so a host on Express — or one
 * that only wants the React surface — never resolves Hono at all.
 *
 * A host writes:
 *
 *   app.route('/api/admin/:tenantSlug', entitlementsRouter({ …, resolveActor }))
 *
 * and keeps what is genuinely its own: who the caller is, which tenant the
 * slug names, and whether that caller may file a plan-change request.
 */

/**
 * Resolve the caller. Returning `null` means unauthenticated, which answers
 * 401 before any handler runs.
 *
 * This is the one thing the package cannot supply: authentication, tenant
 * resolution and RBAC are the host's, and a package that guessed at them
 * would be wrong for every host but the first.
 */
export type ResolveEntitlementsActor = (
  c: Context,
) => Promise<EntitlementsActor | null> | EntitlementsActor | null;

export interface EntitlementsHonoConfig<F extends string, K extends string>
  extends ApiEntitlementsConfig<F, K> {
  resolveActor: ResolveEntitlementsActor;
  /**
   * Which language to answer this caller in, as a BCP-47 tag.
   *
   * An ADAPTER seam, deliberately, because the adapter is the only layer that
   * holds the cookie, the header and whatever preference the host stored — and
   * this package negotiates none of it. Omit it and every request answers with
   * the default rendering of `messages`, which is the whole behaviour of a host
   * with one audience.
   *
   * Pointless unless `messages` is a resolver: a plain pack has one rendering.
   */
  resolveLocale?: (c: Context) => string | undefined;
}

// The copy port, re-exported so a hono host wires the whole surface — router
// and messages — from the one subpath it already imports.
export type {
  EntitlementsCopyResolver,
  EntitlementsCopySource,
  EntitlementsMessages,
} from '../server/copy';
import { resolveEntitlementsCopy } from '../server/copy';
export { PT_BR_ENTITLEMENTS_MESSAGES } from '../server/pt-BR';
export { EN_US_ENTITLEMENTS_MESSAGES } from '../server/en-US';
export { ENTITLEMENTS_MESSAGES } from '../server/locales';

/** Reads the JSON body, tolerating an absent or malformed one. */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === 'GET') return undefined;
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the caller's error, and the handler's own
    // validation reports it far better than a parse failure would.
    return undefined;
  }
}

export function entitlementsRouter<F extends string, K extends string>(
  config: EntitlementsHonoConfig<F, K>,
): { app: Hono; api: ApiEntitlements<F> } {
  const { resolveActor, resolveLocale, ...apiConfig } = config;
  const api = createApiEntitlements<F, K>(apiConfig);
  const app = new Hono();

  for (const route of api.routes) {
    const handler = async (c: Context) => {
      const locale = resolveLocale?.(c);
      const actor = await resolveActor(c);
      // The host's sentence, from the same required `messages` the rest of the
      // surface answers with — the adapter adds no words of its own. Rendered
      // per request like every other sentence here, so a 401 cannot be the one
      // answer stuck in the language the process booted with.
      if (!actor) {
        const messages = resolveEntitlementsCopy(config.messages, locale);
        return c.json({ error: messages.unauthenticated }, 401);
      }

      const response = await route.handle({
        actor,
        body: await readBody(c),
        ...(locale === undefined ? {} : { locale }),
      });

      // The status travels with the body the handler chose; this adapter never
      // reinterprets either, or the two halves of the contract would drift —
      // which is the whole reason the handlers live in the package.
      return c.json(response.body, response.status as 200);
    };

    if (route.method === 'GET') app.get(route.path, handler);
    else app.post(route.path, handler);
  }

  return { app, api };
}
