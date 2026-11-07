import { matchesRedirectUri } from "./clients";
import { isClientIdMetadataUrl, matchesLoopbackRedirectUri } from "./client-metadata";
import { issuer, resourceAudience } from "./config";
import type { McpOauthContext } from "./context";
import { SUPPORTED_CHALLENGE_METHOD } from "./pkce";
import type { StoredOAuthClient } from "./stores";

/** OAuth 2.1 error codes this endpoint can emit on a validated redirect_uri. */
type AuthorizeErrorCode =
  | "invalid_request"
  | "unsupported_response_type"
  | "invalid_scope"
  /** The resource owner said no — or nobody was asked and nobody approved. */
  | "access_denied"
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
export function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location, "cache-control": "no-store", "referrer-policy": "no-referrer" } });
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
 * Where an authorization response goes: the already-validated `redirect_uri`, the
 * `state` to echo, and the `iss` to name (RFC 9207, the mix-up defence; the CIMD
 * draft makes it a MUST for a server that accepts metadata-document clients).
 */
interface AuthorizeCallback {
  redirectUri: string;
  state: string | null;
  /** The issuer of the request's trusted origin, as the metadata's `issuer` serves it. */
  issuer: string;
}

/**
 * Every authorization response, success or error, is the callback plus its own
 * parameters, then `state` and `iss` (RFC 9207 §2).
 */
export function callbackRedirect(callback: AuthorizeCallback, params: Readonly<Record<string, string>>): Response {
  const target = new URL(callback.redirectUri);
  for (const [name, value] of Object.entries(params)) target.searchParams.set(name, value);
  if (callback.state !== null) target.searchParams.set("state", callback.state);
  target.searchParams.set("iss", callback.issuer);
  return redirectTo(target.toString());
}

/**
 * Build an error redirect back to the (already-validated) `redirect_uri`, carrying
 * the OAuth `error`, the echoed `state` (OAuth 2.1 §4.1.2.1) and `iss`.
 */
export function errorRedirect(callback: AuthorizeCallback, error: AuthorizeErrorCode): Response {
  return callbackRedirect(callback, { error });
}

/**
 * Whether every space-delimited requested scope is within `allowed`. An
 * empty/absent scope grants nothing (there is NO implicit default), but any present
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
): Promise<{ client: StoredOAuthClient; redirectUri: string } | Response> {
  if (!params.clientId) return badRequest("invalid_request: missing client_id");
  if (!params.redirectUri) return badRequest("invalid_request: missing redirect_uri");

  const client = await context.stores.clients.findByClientId(params.clientId);
  if (!client) return badRequest("invalid_client: unknown client_id");
  // A metadata-document client's loopback callback matches on any port (RFC 8252
  // §7.3); every other redirect is the exact match it always was.
  const loopback = context.clientIdMetadataDocuments && isClientIdMetadataUrl(client.clientId) &&
    matchesLoopbackRedirectUri(client.redirectUris, params.redirectUri);
  if (!loopback && !matchesRedirectUri(client, params.redirectUri)) {
    return badRequest("invalid_request: redirect_uri is not registered");
  }

  return { client, redirectUri: params.redirectUri };
}

/**
 * Validate the response_type, mandatory PKCE S256, and the requested scope against
 * the already-validated `redirectUri`. Returns `null` when the request passes, or an
 * error redirect back to the validated URI on the first failure.
 */
function validateAuthorizeRequest(
  params: AuthorizeParams,
  callback: AuthorizeCallback,
  clientScopes: readonly string[],
): Response | null {
  if (params.responseType !== "code") {
    return errorRedirect(callback, "unsupported_response_type");
  }
  // Mandatory PKCE S256: reject a missing challenge or any non-S256 method.
  if (!params.codeChallenge || params.codeChallengeMethod !== SUPPORTED_CHALLENGE_METHOD) {
    return errorRedirect(callback, "invalid_request");
  }
  if (!scopeIsSupported(params.scope, clientScopes)) {
    return errorRedirect(callback, "invalid_scope");
  }
  return null;
}

/** The already-validated inputs an authorize request resolves to before minting. */
export interface ValidatedAuthorize extends AuthorizeCallback {
  /** The registered client — needed by the approval seam, not just its id. */
  client: StoredOAuthClient;
  clientId: string;
  codeChallenge: string;
  scope: string;
}

/** Validate without authenticating or issuing any credential. */
export async function validateAuthorization(
  context: McpOauthContext,
  url: URL,
  origin: string,
): Promise<ValidatedAuthorize | Response> {
  // Ambiguous parameters must never be displayed one way and redeemed another.
  for (const name of ["client_id", "redirect_uri", "response_type", "code_challenge",
    "code_challenge_method", "scope", "state", "resource"]) {
    if (url.searchParams.getAll(name).length > 1) return badRequest("invalid_request: duplicate parameter");
  }
  const params = parseParams(url);
  const result = await validateClientAndRedirect(context, params);
  if (result instanceof Response) return result;
  const callback: AuthorizeCallback = { redirectUri: result.redirectUri, state: params.state, issuer: issuer(origin) };
  const error = validateAuthorizeRequest(params, callback, result.client.scopes);
  if (error) return error;
  const resource = url.searchParams.get("resource");
  if (resource !== null && resource !== resourceAudience(origin, context.resourcePath)) {
    return errorRedirect(callback, "invalid_request");
  }
  return {
    ...callback,
    client: result.client,
    clientId: params.clientId as string,
    codeChallenge: params.codeChallenge as string,
    scope: params.scope ?? "",
  };
}
