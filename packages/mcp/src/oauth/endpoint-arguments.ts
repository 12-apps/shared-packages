import { z } from "zod";

import type { McpOauthHandlers } from "./create-api-mcp-oauth";

/**
 * The OAuth endpoints with their inputs as ARGUMENTS: each one takes the query
 * or body a host has already validated, never reading the request's own query
 * string or body.
 *
 * Why: a host that validates every request strictly (an unknown key refused
 * before anything runs) parses the input with its route builder, and the
 * engine then works on exactly what was validated. The schemas below are the
 * engine's own statement of each endpoint's input, closed at every level, so
 * a host and the engine cannot disagree about which keys exist.
 *
 * They list every parameter the engine reads, plus the ones the RFCs define
 * for the same message that a client may send and the engine ignores (a
 * registration's `logo_uri`, an authorize request's `prompt`), so a client
 * that follows the RFCs connects. Values are bounded strings; whether a value
 * is ACCEPTABLE stays the engine's call, answered in the RFC's own error shape
 * (an error redirect, `invalid_request`, `invalid_client_metadata`).
 *
 * The request still travels with the arguments, for what is not an input:
 * the cookie session, the `Authorization` header of a confidential client,
 * and the origin. `handlers` (the request-reading endpoints) are unchanged.
 */

const value = z.string().max(2048);
const shortValue = z.string().max(256);
const uriList = z.array(value).max(20);

/** `GET authorize` (RFC 6749 §4.1.1, RFC 7636 §4.3, RFC 8707 §2, OIDC Core §3.1.2.1). */
export const authorizeArguments = z.strictObject({
  response_type: shortValue.optional(),
  client_id: value.optional(),
  redirect_uri: value.optional(),
  scope: value.optional(),
  state: value.optional(),
  code_challenge: shortValue.optional(),
  code_challenge_method: shortValue.optional(),
  resource: value.optional(),
  prompt: shortValue.optional(),
  login_hint: shortValue.optional(),
  nonce: shortValue.optional(),
  response_mode: shortValue.optional(),
});

/** `GET consent`: the signed request ticket the consent screen was opened with. */
export const consentDetailsArguments = z.strictObject({
  request: z.string().min(1).max(8192),
});

/** `POST consent`: the person's decision on that ticket. */
export const consentDecisionArguments = z.strictObject({
  request: z.string().min(1).max(8192),
  decision: z.enum(["approve", "deny"]),
});

/** `POST token`, form-encoded (RFC 6749 §4.1.3 and §6, RFC 7636 §4.5, RFC 8707 §2, RFC 7523 §2.2). */
export const tokenArguments = z.strictObject({
  grant_type: shortValue.optional(),
  code: value.optional(),
  redirect_uri: value.optional(),
  code_verifier: shortValue.optional(),
  client_id: value.optional(),
  client_secret: shortValue.optional(),
  refresh_token: shortValue.optional(),
  scope: value.optional(),
  resource: value.optional(),
  client_assertion: z.string().max(8192).optional(),
  client_assertion_type: shortValue.optional(),
});

/** `POST register`, JSON (RFC 7591 §2, the client metadata it defines as strings or string lists). */
export const registerArguments = z.strictObject({
  redirect_uris: uriList.optional(),
  token_endpoint_auth_method: shortValue.optional(),
  grant_types: z.array(shortValue).max(10).optional(),
  response_types: z.array(shortValue).max(10).optional(),
  client_name: shortValue.optional(),
  client_uri: value.optional(),
  logo_uri: value.optional(),
  scope: value.optional(),
  contacts: z.array(shortValue).max(10).optional(),
  tos_uri: value.optional(),
  policy_uri: value.optional(),
  jwks_uri: value.optional(),
  software_id: shortValue.optional(),
  software_version: shortValue.optional(),
});

export type AuthorizeArguments = z.infer<typeof authorizeArguments>;
export type ConsentDetailsArguments = z.infer<typeof consentDetailsArguments>;
export type ConsentDecisionArguments = z.infer<typeof consentDecisionArguments>;
export type TokenArguments = z.infer<typeof tokenArguments>;
export type RegisterArguments = z.infer<typeof registerArguments>;

/** The endpoints that take input, each given its validated arguments. */
export interface McpOauthArgumentEndpoints {
  authorize: (request: Request, query: AuthorizeArguments) => Promise<Response>;
  consentDetails: (request: Request, query: ConsentDetailsArguments) => Promise<Response>;
  consentDecision: (request: Request, body: ConsentDecisionArguments) => Promise<Response>;
  token: (request: Request, form: TokenArguments) => Promise<Response>;
  register: (request: Request, body: RegisterArguments) => Promise<Response>;
}

/** The defined entries of an argument object, as name/value string pairs. */
function definedPairs(args: Record<string, string | undefined>): [string, string][] {
  return Object.entries(args).filter((entry): entry is [string, string] => entry[1] !== undefined);
}

/** The request's headers, minus what described a body this request no longer carries. */
function carriedHeaders(request: Request, contentType?: string): Headers {
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.delete("content-type");
  if (contentType) headers.set("content-type", contentType);
  return headers;
}

/** The same request, whose query is exactly `args`. */
function withQuery(request: Request, args: Record<string, string | undefined>): Request {
  const url = new URL(request.url);
  url.search = new URLSearchParams(definedPairs(args)).toString();
  return new Request(url, { method: "GET", headers: carriedHeaders(request) });
}

/** The same request, whose body is exactly `body` (already serialised). */
function withBody(request: Request, body: string, contentType: string): Request {
  const url = new URL(request.url);
  url.search = "";
  return new Request(url, { method: "POST", headers: carriedHeaders(request, contentType), body });
}

/**
 * The argument endpoints over a surface's handlers: each builds the one input
 * the core reads from its arguments alone (the request's own query string and
 * body are dropped), then runs the very handler `handlers` serves — the same
 * gate, the same retry answer, the same core.
 */
export function argumentEndpoints(handlers: McpOauthHandlers): McpOauthArgumentEndpoints {
  return {
    authorize: (request, query) => handlers.authorize(withQuery(request, query)),
    consentDetails: (request, query) => handlers.consentDetails(withQuery(request, query)),
    consentDecision: (request, body) =>
      handlers.consentDecision(withBody(request, JSON.stringify(body), "application/json")),
    token: (request, form) =>
      handlers.token(withBody(request, new URLSearchParams(definedPairs(form)).toString(), "application/x-www-form-urlencoded")),
    register: (request, body) => handlers.register(withBody(request, JSON.stringify(body), "application/json")),
  };
}
