import { mintCode } from "./authorization-code";
import { matchesRedirectUri } from "./clients";
import type { McpOauthContext } from "./context";
import { SUPPORTED_CHALLENGE_METHOD } from "./pkce";

/**
 * The OAuth 2.1 Authorization Code + PKCE authorization endpoint (12-23, ported
 * from future-pay's `app/api/oauth/authorize/route.ts`).
 *
 * It renders no UI: it authenticates the caller against the host's cookie session
 * (through `resolveSession`), validates the request, and either 302-redirects an
 * unauthenticated caller into the host's sign-in flow (so the flow resumes
 * post-login) or, for a signed-in caller with a valid request, mints a stateless
 * authorization code bound to the SESSION identity and 302-redirects back to the
 * client's registered `redirect_uri` with the code and echoed `state`.
 *
 * Security invariants, unchanged:
 *   - **Open-redirect prevention:** `client_id` + `redirect_uri` are validated
 *     against the registered client BEFORE anything else; an unknown client or a
 *     `redirect_uri` that is not an EXACT registered match yields a 400 plain-text
 *     response — the endpoint NEVER redirects an error to an unvalidated URI. Only
 *     once the URI is validated do other failures redirect back to it.
 *   - **Mandatory PKCE S256:** a missing `code_challenge`, or a method other than
 *     `S256` (incl. `plain`), is rejected.
 *   - **Identity from the session only:** `sub`/`email` come solely from the
 *     verified session; a client can never supply the identity via a query param.
 *   - **No key, no code:** an unprovisioned signing key is a `server_error`
 *     redirect, never a weaker mode.
 */

/** OAuth 2.1 error codes this endpoint can emit on a validated redirect_uri. */
type AuthorizeErrorCode =
  | "invalid_request"
  | "unsupported_response_type"
  | "invalid_scope"
  | "server_error";

/** The parsed, still-untrusted query parameters of an authorize request. */
interface AuthorizeParams {
  responseType: string | null;
  clientId: string | null;
  redirectUri: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  scope: string | null;
  state: string | null;
}

function parseParams(url: URL): AuthorizeParams {
  const q = url.searchParams;
  return {
    responseType: q.get("response_type"),
    clientId: q.get("client_id"),
    redirectUri: q.get("redirect_uri"),
    codeChallenge: q.get("code_challenge"),
    codeChallengeMethod: q.get("code_challenge_method"),
    scope: q.get("scope"),
    state: q.get("state"),
  };
}

/** A 302 response to `location` with no body. */
function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

/**
 * A 400 plain-text refusal used ONLY when the `redirect_uri`/`client_id` are
 * themselves invalid — i.e. there is no validated URI to safely redirect an error
 * to (the open-redirect guard).
 */
function badRequest(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Build an error redirect back to the (already-validated) `redirect_uri`, carrying
 * the OAuth `error` and the echoed `state` per OAuth 2.1 §4.1.2.1.
 */
function errorRedirect(
  redirectUri: string,
  error: AuthorizeErrorCode,
  state: string | null,
): Response {
  const target = new URL(redirectUri);
  target.searchParams.set("error", error);
  if (state !== null) target.searchParams.set("state", state);
  return redirectTo(target.toString());
}

/**
 * Whether every space-delimited requested scope is within `allowed`. An
 * empty/absent scope is permitted (the server applies its default), but any present
 * scope must be in `allowed` — and `allowed` is the SPECIFIC CLIENT's registered
 * scopes, so a client that registered for only `mcp:read` cannot request
 * `mcp:write` and be issued a code for it ("no privilege escalation via metadata",
 * enforced at authorize rather than trusted at registration).
 */
function scopeIsSupported(scope: string | null, allowed: readonly string[]): boolean {
  if (!scope) return true;
  const requested = scope.split(/\s+/).filter(Boolean);
  const allowedSet = new Set<string>(allowed);
  return requested.every((candidate) => allowedSet.has(candidate));
}

/**
 * Resolve + validate the client and its `redirect_uri` FIRST (the open-redirect
 * guard). Returns the validated URI AND the client's registered scopes, or a plain
 * 400 — NEVER a redirect — when the client or URI is unknown/unregistered, so an
 * error is never steered to an unvalidated URI.
 */
async function validateClientAndRedirect(
  context: McpOauthContext,
  params: AuthorizeParams,
): Promise<{ redirectUri: string; clientScopes: string[] } | Response> {
  if (!params.clientId) return badRequest("invalid_request: missing client_id");
  if (!params.redirectUri) return badRequest("invalid_request: missing redirect_uri");

  const client = await context.stores.clients.findByClientId(params.clientId);
  if (!client) return badRequest("invalid_client: unknown client_id");
  if (!matchesRedirectUri(client, params.redirectUri)) {
    return badRequest("invalid_request: redirect_uri is not registered");
  }

  return { redirectUri: params.redirectUri, clientScopes: client.scopes };
}

/**
 * Validate the response_type, mandatory PKCE S256, and the requested scope against
 * the already-validated `redirectUri`. Returns `null` when the request passes, or an
 * error redirect back to the validated URI on the first failure.
 */
function validateAuthorizeRequest(
  params: AuthorizeParams,
  redirectUri: string,
  clientScopes: readonly string[],
): Response | null {
  const { state } = params;

  if (params.responseType !== "code") {
    return errorRedirect(redirectUri, "unsupported_response_type", state);
  }
  // Mandatory PKCE S256: reject a missing challenge or any non-S256 method.
  if (!params.codeChallenge || params.codeChallengeMethod !== SUPPORTED_CHALLENGE_METHOD) {
    return errorRedirect(redirectUri, "invalid_request", state);
  }
  if (!scopeIsSupported(params.scope, clientScopes)) {
    return errorRedirect(redirectUri, "invalid_scope", state);
  }
  return null;
}

/** The already-validated inputs an authorize request resolves to before minting. */
interface ValidatedAuthorize {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state: string | null;
}

/**
 * With a validated request, resolve the authenticated session (identity from the
 * session ONLY) and either send the caller through sign-in, mint the code, or
 * `server_error` when no signing key is configured.
 */
async function authenticateAndMint(
  context: McpOauthContext,
  request: Request,
  url: URL,
  origin: string,
  validated: ValidatedAuthorize,
): Promise<Response> {
  const { redirectUri, state } = validated;

  const session = await context.resolveSession(request);
  if (!session?.email) {
    // No session: send the caller through the host's sign-in flow with a callback
    // back to THIS authorize URL so the flow resumes post-login. No code is minted
    // for an unauthenticated request.
    const loginUrl = new URL(context.loginPath, origin);
    loginUrl.searchParams.set(context.loginCallbackParam, url.pathname + url.search);
    return redirectTo(loginUrl.toString());
  }

  const code = await mintCode(context.signingKey, {
    // The subject is the OAuth `sub` the host resolved, NOT a DB id: downstream
    // guards resolve the user by EMAIL, and the code carries only what the session
    // verified.
    sub: session.subject || session.email,
    email: session.email,
    clientId: validated.clientId,
    redirectUri,
    codeChallenge: validated.codeChallenge,
    scope: validated.scope,
    origin,
  });

  if (!code) {
    // No signing key configured while the surface is on — refuse to issue rather
    // than fall back to a weaker mode (safe-by-default).
    return errorRedirect(redirectUri, "server_error", state);
  }

  const success = new URL(redirectUri);
  success.searchParams.set("code", code);
  if (state !== null) success.searchParams.set("state", state);
  return redirectTo(success.toString());
}

/** `GET <authorize>` — the whole endpoint. */
export async function authorizeEndpoint(
  context: McpOauthContext,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const origin = context.originOf(request);
  const params = parseParams(url);

  // --- Validate client + redirect_uri FIRST (the open-redirect guard) --------
  const clientResult = await validateClientAndRedirect(context, params);
  if (clientResult instanceof Response) return clientResult;
  const { redirectUri, clientScopes } = clientResult;

  // --- Validate the rest (scope checked against the CLIENT's own registration)
  const requestError = validateAuthorizeRequest(params, redirectUri, clientScopes);
  if (requestError) return requestError;

  // The guards above guarantee a present client_id + PKCE challenge; narrow them.
  return authenticateAndMint(context, request, url, origin, {
    clientId: params.clientId as string,
    redirectUri,
    codeChallenge: params.codeChallenge as string,
    scope: params.scope ?? "",
    state: params.state,
  });
}
