import type { EmailAuthCookie } from "./email-routes";

/**
 * The cookie that ties a confirmation link to the browser that signed up
 * (FUT-3474). See `../email-credentials/link-sign-in`.
 *
 * `__Host-`: the browser then accepts it only `Secure`, at `Path=/` and with
 * no `Domain` — so a sibling subdomain cannot plant one here ("cookie
 * tossing"), which would sign this browser in to the planter's account.
 */
export const SIGNUP_BINDING_COOKIE = "__Host-auth-signup-binding";

/**
 * The one way a cookie the e-mail routes ask for is written, and the one way a
 * request's cookies are read — shared by both adapters (`../hono` and the
 * wiring view in `./create-api-email-auth`), so the two cannot drift on an
 * attribute.
 *
 * The attributes are fixed: `HttpOnly` (no script reads a binding),
 * `Secure` (browsers accept it on `http://localhost` too), `SameSite=Lax` and
 * `Path=/`. Every cookie gets the same ones, which is what lets the sign-up
 * branches set "the same" cookie and mean it byte for byte.
 */
export function serializeAuthCookie(cookie: EmailAuthCookie): string {
  return `${cookie.name}=${cookie.value}; Max-Age=${cookie.maxAge}; Path=/; HttpOnly; Secure; SameSite=Lax`;
}

/** A `Cookie` header, by name. Values are taken as sent; ours are base64url. */
export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (name && !(name in cookies)) cookies[name] = part.slice(index + 1).trim();
  }
  return cookies;
}

/**
 * Was this request sent by a page of another site?
 *
 * The binding cookie proves "this browser called sign-up", and that is only
 * worth something if no OTHER site can make the browser call it. A form on
 * evil.example auto-submitting to `/signup` would otherwise plant a binding for
 * the attacker's own account, and the attacker's own confirmation link would
 * then sign the victim in to it (login CSRF). Two checks, either sufficient:
 *
 * - **The body must be JSON.** A cross-site form can only send form or text
 *   encodings; a cross-site `fetch` with `application/json` needs a CORS
 *   preflight these routes never answer.
 * - **`Sec-Fetch-Site`** — sent by every current browser — must say the
 *   request came from this origin, or from no page at all.
 */
export function isForgedPost(request: Request): boolean {
  if (request.method === "GET") return false;
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type.trim())) return true;
  const site = request.headers.get("sec-fetch-site");
  return site !== null && site !== "same-origin" && site !== "none";
}
