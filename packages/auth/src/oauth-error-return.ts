import type { AuthConfig } from "@auth/core";

/**
 * A failed OAuth round trip goes back to the page that STARTED it (FUT-4595).
 *
 * Auth.js answers every sign-in failure with one redirect, to `pages.error` (or
 * `pages.signIn`) plus `?error=<code>`. A host has one such page, so a sign-in
 * started anywhere else — a second login screen, an app's own entry page, a
 * page whose query carries a return or a PKCE challenge — came back to a page
 * that was not the one the person left, and without that page's query.
 * Auth.js keeps only the RETURN (the `callback-url` cookie), which is where to
 * go on success, not where the sign-in started.
 *
 * So the start is remembered here, at the one moment it is known: the
 * sign-in POST, whose `Referer` is the page the button sat on. It rides a
 * short-lived cookie of its own through the provider and is read back on the
 * callback. When Auth.js's answer there is its error redirect, the person goes
 * back to the start, its query kept, with Auth.js's `error` (and `code`) set on
 * it. A success is untouched, and the cookie is cleared either way.
 *
 * ## The code a provider's refusal gets
 *
 * A callback that arrives carrying the provider's own `error` parameter (a
 * consent refused, a cancelled Apple sheet) is the PROVIDER saying no. Auth.js
 * reports it as `OAuthCallbackError`, a code no copy pack names, or — when
 * anything trips before the parameter is read, such as the RFC 9207 `iss`
 * check — as `Configuration`, which tells the person the provider is down.
 * Both become `OAuthCallback`, the code the packs already explain as "could
 * not complete the sign-in, try again". Any other failure keeps its own code,
 * so `AccessDenied` from a host's sign-in gate still reads as "sign up first".
 *
 * ## What is never followed
 *
 * Only a path is stored, and only from a `Referer` on the auth URL's own
 * origin and outside the auth routes. Anything else — no `Referer` (a
 * `no-referrer` policy), another origin (a custom domain that hands sign-in to
 * the platform origin), an auth route — clears the cookie, and the failure
 * goes where it always went. A redirect of Auth.js's that is not its error
 * redirect is never rewritten, and neither is a JSON answer
 * (`X-Auth-Return-Redirect`), whose caller reads the code itself.
 *
 * No database, no extra request: two header reads on the sign-in POST and on
 * the callback, nothing on any other route.
 */

/** The start cookie's name, after Auth.js's own `__Secure-` convention. */
export function signInStartCookieName(secure: boolean): string {
  return `${secure ? "__Secure-" : ""}authjs.sign-in-start`;
}

/** Long enough for a provider's consent screen; Auth.js's PKCE cookie lives as long. */
const START_MAX_AGE_SECONDS = 15 * 60;

/** The code every copy pack explains as "could not complete the sign-in". */
const PROVIDER_REFUSAL_CODE = "OAuthCallback";

/** The slice of the Auth.js config this reads. */
type ReturnConfig = Pick<AuthConfig, "basePath" | "pages" | "useSecureCookies">;

interface ReturnContext {
  url: URL;
  basePath: string;
  cookieName: string;
  secure: boolean;
  errorPaths: readonly string[];
}

/** Is `pathname` one of the auth routes (which are never a start)? */
function isAuthRoute(pathname: string, basePath: string): boolean {
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

/**
 * A stored or offered start, accepted only as a same-origin PATH: a leading
 * `/` that is not `//`, outside the auth routes. Returns `path + search`.
 */
function acceptStart(candidate: string, ctx: ReturnContext): string | null {
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate, ctx.url.origin);
  } catch {
    return null;
  }
  if (parsed.origin !== ctx.url.origin || isAuthRoute(parsed.pathname, ctx.basePath)) return null;
  return `${parsed.pathname}${parsed.search}`;
}

/** The page the sign-in button sat on, from the POST's `Referer`. */
function startFromReferer(request: Request, ctx: ReturnContext): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  let parsed: URL;
  try {
    parsed = new URL(referer);
  } catch {
    return null;
  }
  if (parsed.origin !== ctx.url.origin) return null;
  return acceptStart(`${parsed.pathname}${parsed.search}`, ctx);
}

/** One cookie's value off the request, or `null`. */
function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function startCookie(ctx: ReturnContext, value: string | null): string {
  const attributes = ["Path=/", "HttpOnly", "SameSite=Lax"];
  if (ctx.secure) attributes.push("Secure");
  attributes.push(value === null ? "Max-Age=0" : `Max-Age=${START_MAX_AGE_SECONDS}`);
  return [`${ctx.cookieName}=${value === null ? "" : encodeURIComponent(value)}`, ...attributes].join("; ");
}

/**
 * Auth.js's error redirect, if that is what `response` is: a 3xx to one of its
 * error pages on the same origin, carrying `?error=`.
 */
function errorRedirect(response: Response, ctx: ReturnContext): URL | null {
  if (response.status < 300 || response.status >= 400) return null;
  const location = response.headers.get("location");
  if (!location) return null;
  let target: URL;
  try {
    target = new URL(location, ctx.url.origin);
  } catch {
    return null;
  }
  if (target.origin !== ctx.url.origin) return null;
  if (!target.searchParams.has("error") || !ctx.errorPaths.includes(target.pathname)) return null;
  return target;
}

/** Did the provider itself answer with an `error` (query, or Apple's form post)? */
async function providerRefused(request: Request): Promise<boolean> {
  if (new URL(request.url).searchParams.has("error")) return true;
  if (request.method !== "POST") return false;
  if (!(request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    return false;
  }
  try {
    return new URLSearchParams(await request.text()).has("error");
  } catch {
    return false;
  }
}

/** The start page, with Auth.js's error parameters set on its own query. */
function backToStart(start: string, authError: URL, code: string, origin: string): string {
  const target = new URL(start, origin);
  target.searchParams.delete("code");
  target.searchParams.set("error", code);
  const detail = authError.searchParams.get("code");
  if (detail !== null && code === authError.searchParams.get("error")) {
    target.searchParams.set("code", detail);
  }
  return target.toString();
}

/** A copy of `response` whose headers can be changed (`Response.redirect`'s cannot). */
function editable(response: Response): Response {
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers),
  });
}

/**
 * The sign-in POST: remember the start (or forget a stale one), and send a
 * failure of the sign-in step itself straight back to it.
 */
async function onSignIn(
  request: Request,
  handle: (request: Request) => Promise<Response>,
  ctx: ReturnContext,
): Promise<Response> {
  const start = startFromReferer(request, ctx);
  const stale = readCookie(request, ctx.cookieName) !== null;
  const response = await handle(request);
  if (start === null && !stale) return response;

  const out = editable(response);
  out.headers.append("set-cookie", startCookie(ctx, start));
  const failure = errorRedirect(response, ctx);
  if (failure !== null && start !== null) {
    out.headers.set(
      "location",
      backToStart(start, failure, failure.searchParams.get("error") ?? "", ctx.url.origin),
    );
  }
  return out;
}

/** The callback: a failure goes back to the start; the start is cleared either way. */
async function onCallback(
  request: Request,
  handle: (request: Request) => Promise<Response>,
  ctx: ReturnContext,
): Promise<Response> {
  const stored = readCookie(request, ctx.cookieName);
  // Read before Auth.js consumes the body; a clone leaves its stream intact.
  const refused = await providerRefused(request.clone());
  const response = await handle(request);
  const failure = errorRedirect(response, ctx);
  if (failure === null && stored === null) return response;

  const out = editable(response);
  if (stored !== null) out.headers.append("set-cookie", startCookie(ctx, null));
  if (failure !== null) {
    const code = refused ? PROVIDER_REFUSAL_CODE : (failure.searchParams.get("error") ?? "");
    const start = stored === null ? null : acceptStart(stored, ctx);
    if (start !== null) {
      out.headers.set("location", backToStart(start, failure, code, ctx.url.origin));
    } else if (refused) {
      failure.searchParams.set("error", code);
      out.headers.set("location", failure.toString());
    }
  }
  return out;
}

/**
 * Serve one auth request through `handle`, returning a failed OAuth sign-in
 * to the page that started it. Every route but the sign-in POST and the
 * callback passes straight through.
 */
export async function withOAuthErrorReturn(
  request: Request,
  handle: (request: Request) => Promise<Response>,
  config: ReturnConfig,
): Promise<Response> {
  const url = new URL(request.url);
  const basePath = config.basePath ?? "/api/auth";
  const isSignIn = request.method === "POST" && url.pathname.startsWith(`${basePath}/signin/`);
  const isCallback = url.pathname.startsWith(`${basePath}/callback/`);
  if (!isSignIn && !isCallback) return handle(request);

  const ctx = returnContext(url, basePath, config);
  return isSignIn ? onSignIn(request, handle, ctx) : onCallback(request, handle, ctx);
}

/** What both halves read: the origin, the cookie, and Auth.js's error pages. */
function returnContext(url: URL, basePath: string, config: ReturnConfig): ReturnContext {
  const secure = config.useSecureCookies ?? url.protocol === "https:";
  return {
    url,
    basePath,
    secure,
    cookieName: signInStartCookieName(secure),
    errorPaths: [
      config.pages?.error ?? `${basePath}/error`,
      config.pages?.signIn ?? `${basePath}/signin`,
    ],
  };
}
