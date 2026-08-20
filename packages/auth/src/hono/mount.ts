import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";

import {
  emailAuthRouter,
  emailAuthSettingsRouter,
  type EmailAuthHonoConfig,
  type EmailAuthSettingsHonoConfig,
} from "./index";

/**
 * The MOUNT, as opposed to the router — the ten lines every host wrote around
 * `emailAuthRouter` to turn it into a route file.
 *
 * `emailAuthRouter` returns a `Hono`, and a host on the `app/**\/route.ts`
 * layout cannot export one of those; it exports verb functions. So both mounts
 * in the origin host ended with the same block:
 *
 * ```ts
 * const router = new Hono().route(MOUNT_PREFIX, emailAuthRouter({ … }));
 * router.notFound(() => Response.json({ error: "Not found." }, { status: 404 }));
 * export async function GET(request: Request) { return router.fetch(request); }
 * export async function POST(request: Request) { return router.fetch(request); }
 * export async function PUT(request: Request) { return router.fetch(request); }
 * ```
 *
 * Copied twice in one repo is copied in every repo, and the copy is where the
 * two mounts drift: forget `PUT` on one of them and the reset endpoint answers
 * 405 with nothing red anywhere, because no test drives a verb the file does
 * not export.
 *
 * The verbs are derived from the ROUTE DESCRIPTORS instead. A route the package
 * adds later arrives with its verb already exported, which is the same
 * guarantee the catch-all segment gives for its path.
 */

/** The verb exports a `route.ts` file needs. */
export interface AuthRouteHandlers {
  GET(request: Request): Promise<Response>;
  POST(request: Request): Promise<Response>;
  PUT(request: Request): Promise<Response>;
}

export interface AuthMountOptions {
  /**
   * The URL prefix this route file is mounted at, which the router's paths
   * hang off — `/api/auth/email`.
   */
  path: string;
  /**
   * What an unknown sub-path UNDER the prefix answers.
   *
   * The host's, because a 404 body is part of an API's own vocabulary and
   * Hono's default is plain text. Omitted, that default stands: this package
   * will not invent an envelope a host's other endpoints do not use.
   */
  notFound?: () => Response;
  /**
   * Runs in front of the package's router, for a gate the host answers itself.
   *
   * The reason this exists rather than being folded into `resolveUserId`:
   * `resolveUserId` answers `string | null`, and `null` becomes **401** for
   * every refusal it can express. A host whose gate has a second refusal — a
   * signed-in user who is simply not permitted, which is a **403** — cannot say
   * so through that seam, and collapsing the two bounces somebody to a sign-in
   * they are already past.
   *
   * So the host refuses first, in its own statuses, and `resolveUserId` is then
   * a pure read of somebody already proven.
   */
  before?: MiddlewareHandler;
}

/** Wrap a built router in a prefix, a gate and the verb exports. */
function toHandlers(
  build: () => Hono,
  options: AuthMountOptions,
): AuthRouteHandlers {
  const app = new Hono();
  if (options.before) app.use(`${options.path}/*`, options.before);
  app.route(options.path, build());
  if (options.notFound) app.notFound(options.notFound);

  const fetch = (request: Request): Promise<Response> =>
    Promise.resolve(app.fetch(request));
  return { GET: fetch, POST: fetch, PUT: fetch };
}

/**
 * Mount the shopper-facing surface as a route file's verb exports.
 *
 * ```ts
 * export const { GET, POST, PUT } = mountEmailAuth({
 *   path: "/api/auth/email",
 *   credentials: emailCredentials(),
 *   messages: PT_BR_MESSAGES,
 *   resolveUserId: async () => (await session())?.userId ?? null,
 * });
 * ```
 */
export function mountEmailAuth(
  config: EmailAuthHonoConfig & AuthMountOptions,
): AuthRouteHandlers {
  return toHandlers(() => emailAuthRouter(config), config);
}

/**
 * Mount the OPERATOR-facing settings surface.
 *
 * Generic over Hono's per-request variables so a host gate can stash who is
 * acting — `before` sets it, `resolveUserId` reads it, and the two agree at the
 * type level. A module-level box would be shared by every concurrent request;
 * the per-request context is the whole point of having one.
 *
 * ```ts
 * export const { GET, PUT } = mountEmailAuthSettings<{ operator: string }>({
 *   path: "/api/platform/auth-settings",
 *   before: async (c, next) => {
 *     try { c.set("operator", (await requireSuperadmin()).email); }
 *     catch (error) { return errorResponse(error); }
 *     return next();
 *   },
 *   resolveUserId: (c) => c.get("operator") ?? null,
 *   store,
 * });
 * ```
 */
export function mountEmailAuthSettings<TVars extends Record<string, unknown>>(
  // `resolveUserId` and `before` are REPLACED rather than intersected: the base
  // signatures are typed against Hono's default (empty) variables, and an
  // intersection would require a handler satisfying both — which makes
  // `c.get("operator")` resolve to `never` at the one call site that needs it.
  config: Omit<EmailAuthSettingsHonoConfig, "resolveUserId"> &
    Omit<AuthMountOptions, "before"> & {
      before?: MiddlewareHandler<{ Variables: TVars }>;
      resolveUserId: (c: Context<{ Variables: TVars }>) => Promise<string | null> | string | null;
    },
): AuthRouteHandlers {
  return toHandlers(
    () => emailAuthSettingsRouter(config as EmailAuthSettingsHonoConfig),
    config as AuthMountOptions,
  );
}
