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
 * A callback that arrives with the provider's `error=access_denied` is the
 * person refusing consent. Auth.js reports it as `OAuthCallbackError`, a code
 * no copy pack names, or — when anything trips before the parameter is read,
 * such as the RFC 9207 `iss` check — as `Configuration`, which tells the person
 * the provider is down. Both become `OAuthCallback`, the code the packs already
 * explain as "could not complete the sign-in, try again". Any other provider
 * error (`server_error`, `unauthorized_client`, …) and any other failure keeps
 * Auth.js's code, so `AccessDenied` from a host's sign-in gate still reads as
 * "sign up first".
 *
 * A provider that answers with a cross-site form POST (Apple's `form_post`)
 * never brings the start cookie back — it is `SameSite=Lax`, like Auth.js's
 * own — so such a failure goes to the sign-in page, as it always did.
 *
 * ## What is never followed
 *
 * Only a path is stored, and only from a `Referer` on the auth URL's own
 * origin and outside the auth routes. Anything else — no `Referer` (a
 * `no-referrer` policy), another origin (a custom domain that hands sign-in to
 * the platform origin), an auth route — clears the cookie, and the failure
 * goes where it always went. A stored start is re-checked as it is used: its
 * PARSED path may not start with `//` or `/\` (a dot segment such as
 * `/.//host` normalises into one), and the URL built from it must stay on the
 * auth origin. On https the cookie is `__Host-`, so a sibling subdomain cannot
 * plant one. A redirect of Auth.js's that is not its error
 * redirect is never rewritten, and neither is a JSON answer
 * (`X-Auth-Return-Redirect`), whose caller reads the code itself.
 *
 * No database, no extra request: two header reads on the sign-in POST and on
 * the callback, nothing on any other route.
 *
 * OPT-IN (`errorReturnsToStart`): a host turns it on once every page that can
 * start a sign-in renders `?error`. Off, the handler is Auth.js's, untouched.
 */

/**
 * The start cookie's name. `__Host-` on https (as Auth.js names its CSRF
 * cookie): it then cannot carry a `Domain`, so a sibling subdomain cannot set
 * one for this origin.
 */
export function signInStartCookieName(secure: boolean): string {
  return `${secure ? "__Host-" : ""}authjs.sign-in-start`;
}

/** Long enough for a provider's consent screen; Auth.js's PKCE cookie lives as long. */
const START_MAX_AGE_SECONDS = 15 * 60;

/** The code every copy pack explains as "could not complete the sign-in". */
const PROVIDER_REFUSAL_CODE = "OAuthCallback";

/** The provider's `error` for a refused consent (RFC 6749 §4.1.2.1). */
const CONSENT_REFUSED = "access_denied";

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

/** Would a browser read this path as another host (`//host`, `/\host`)? */
function isProtocolRelative(path: string): boolean {
  return path.startsWith("//") || path.startsWith("/\\");
}

/**
 * A stored or offered start, accepted only as a same-origin PATH: a leading
 * `/` that is not `//` or `/\` — before AND after the URL parser normalises
 * it, since `/.//host` becomes `//host` — outside the auth routes. Returns
 * `path + search`.
 */
function acceptStart(candidate: string, ctx: ReturnContext): string | null {
  if (!candidate.startsWith("/") || isProtocolRelative(candidate)) return null;
  let parsed: URL;
  try {
    parsed = new URL(candidate, ctx.url.origin);
  } catch {
    return null;
  }
  if (parsed.origin !== ctx.url.origin || isProtocolRelative(parsed.pathname)) return null;
  if (isAuthRoute(parsed.pathname, ctx.basePath)) return null;
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

/** The provider's `error`, from the query or a `form_post` body, or `null`. */
async function providerError(request: Request): Promise<string | null> {
  const fromQuery = new URL(request.url).searchParams.get("error");
  if (fromQuery !== null) return fromQuery;
  if (request.method !== "POST") return null;
  if (!(request.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    return null;
  }
  try {
    return new URLSearchParams(await request.text()).get("error");
  } catch {
    return null;
  }
}

/**
 * The start page, with Auth.js's `error` set on its own query — or `null` when
 * the URL it builds would leave the auth origin.
 *
 * The page's own parameters are kept. Auth.js's `code` (a credentials
 * failure's detail) is added only when Auth.js sent one with this same
 * `error`; a `code` the start page carried itself (an invite, a coupon) is
 * never removed for an error that had none.
 */
function backToStart(start: string, authError: URL, code: string, origin: string): string | null {
  const target = new URL(start, origin);
  if (target.origin !== origin) return null;
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
  const back =
    failure === null || start === null
      ? null
      : backToStart(start, failure, failure.searchParams.get("error") ?? "", ctx.url.origin);
  if (back !== null) out.headers.set("location", back);
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
  const refused = (await providerError(request.clone())) === CONSENT_REFUSED;
  const response = await handle(request);
  const failure = errorRedirect(response, ctx);
  if (failure === null && stored === null) return response;

  const out = editable(response);
  if (stored !== null) out.headers.append("set-cookie", startCookie(ctx, null));
  const next = failure === null ? null : failureLocation(failure, stored, refused, ctx);
  if (next !== null) out.headers.set("location", next);
  return out;
}

/**
 * Where a failed callback goes instead of Auth.js's error page: the stored
 * start when it is usable, else that same page with a refused consent's code —
 * or `null` to leave Auth.js's redirect as it is.
 */
function failureLocation(
  failure: URL,
  stored: string | null,
  refused: boolean,
  ctx: ReturnContext,
): string | null {
  const code = refused ? PROVIDER_REFUSAL_CODE : (failure.searchParams.get("error") ?? "");
  const start = stored === null ? null : acceptStart(stored, ctx);
  const back = start === null ? null : backToStart(start, failure, code, ctx.url.origin);
  if (back !== null) return back;
  if (!refused) return null;
  failure.searchParams.set("error", code);
  return failure.toString();
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
