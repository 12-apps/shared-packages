import { Hono } from "hono";
import type { Context } from "hono";

import { emailAuthRoutes, type EmailAuthRoute, type EmailAuthRoutesConfig } from "../server/email-routes";
import {
  emailAuthSettingsRoutes,
  type EmailAuthSettingsRoutesConfig,
} from "../server/settings-routes";

/**
 * `@12-apps/auth/hono` — the e-mail + password endpoints as a mountable router.
 *
 * The framework-neutral descriptors in `/server` are the contract; this is the
 * adapter for the framework we happen to use. It lives behind its own subpath
 * with `hono` as an OPTIONAL peer, so a host on Express — or one that only
 * wants the React screens — never resolves Hono at all. Importing the package
 * root, `/react` or `/email-credentials` does not reach this file.
 *
 * A host writes:
 *
 *   app.route('/api/auth/email', emailAuthRouter({ credentials, messages, resolveUserId }))
 *
 * and keeps what is genuinely its own: who the caller is, and what language the
 * refusals are written in. Everything after that — the paths, the statuses, the
 * envelope — is the package's, because the packaged browser client is built
 * against exactly those.
 */

/**
 * Resolve the signed-in caller. Returning `null` means unauthenticated, which
 * answers 401 before any session-gated handler runs.
 *
 * The one thing the package cannot supply: sessions are the host's, and a
 * package that guessed at them would be wrong for every host but the first.
 */
export type ResolveUserId = (c: Context) => Promise<string | null> | string | null;

export interface EmailAuthHonoConfig extends EmailAuthRoutesConfig {
  resolveUserId: ResolveUserId;
}

/** Reads the JSON body, tolerating an absent or malformed one. */
async function readBody(c: Context): Promise<unknown> {
  if (c.req.method === "GET") return undefined;
  try {
    return await c.req.json();
  } catch {
    // A malformed body is the caller's error, and the flow's own validation
    // reports it far better than a parse failure would — an empty object walks
    // into `invalid-email`, which is a sentence the screens already render.
    return {};
  }
}

/** Turn descriptors into a Hono app. Shared by both routers below. */
function toRouter(routes: EmailAuthRoute[], resolveUserId: ResolveUserId): Hono {
  const app = new Hono();

  for (const route of routes) {
    const handler = async (c: Context): Promise<Response> => {
      let userId: string | null = null;
      if (route.session) {
        userId = await resolveUserId(c);
        if (!userId) return c.json({ error: "unauthenticated" }, 401);
      }
      const result = await route.handle({ body: await readBody(c), userId });
      return c.json(result.body as object, result.status as 200);
    };

    if (route.method === "GET") app.get(route.path, handler);
    else if (route.method === "POST") app.post(route.path, handler);
    else app.put(route.path, handler);
  }

  return app;
}

/** Build the shopper-facing router. Mount it where the client's `basePath` points. */
export function emailAuthRouter(config: EmailAuthHonoConfig): Hono {
  return toRouter(emailAuthRoutes(config), config.resolveUserId);
}

export interface EmailAuthSettingsHonoConfig extends EmailAuthSettingsRoutesConfig {
  resolveUserId: ResolveUserId;
}

/**
 * Build the OPERATOR-facing router for the two platform switches.
 *
 * Mounted separately from `emailAuthRouter`, at a path the host gates for its
 * platform operators — these endpoints turn a sign-in method off for everybody.
 */
export function emailAuthSettingsRouter(config: EmailAuthSettingsHonoConfig): Hono {
  return toRouter(emailAuthSettingsRoutes(config), config.resolveUserId);
}

export { emailAuthRoutes } from "../server/email-routes";
export type {
  EmailAuthRoute,
  EmailAuthRequest,
  EmailAuthResponse,
  EmailAuthRoutesConfig,
} from "../server/email-routes";
export { EMAIL_AUTH_STATUS } from "../server/messages";
export { PT_BR_MESSAGES } from "../server/pt-BR";
export { EN_US_MESSAGES } from "../server/en-US";
export type { EmailAuthMessages } from "../server/messages";

export { emailAuthSettingsRoutes } from "../server/settings-routes";
export type {
  EmailAuthSettingsStore,
  EmailAuthSettingsRoutesConfig,
} from "../server/settings-routes";

export {
  mountEmailAuth,
  mountEmailAuthSettings,
  type AuthMountOptions,
  type AuthRouteHandlers,
} from "./mount";
