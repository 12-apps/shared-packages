import type { McpOauthContext, McpOauthSession } from "./context";
import { errorRedirect, redirectTo, validateAuthorization } from "./authorize-request";
import { mintAuthorization } from "./authorize-response";
import { consentSessionBinding, mintConsentTicket, readConsentTicket } from "./consent-ticket";

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function refuse(error: string, status = 400): Response {
  return json({ error }, status);
}

/** GET authorize issues a ticket for the UI, never an authorization code. */
export async function beginConsent(
  context: McpOauthContext,
  session: McpOauthSession,
  url: URL,
  origin: string,
): Promise<Response> {
  if (!context.consent) return refuse("consent_unavailable", 404);
  if (url.search.length > 8_192) return refuse("invalid_request");
  if (!consentSessionBinding(session)) {
    const target = new URL(context.consent.path, origin);
    target.searchParams.set("reauthenticate", "1");
    return redirectTo(target.toString());
  }
  const ticket = await mintConsentTicket(context, session, url.search, origin);
  if (!ticket) return refuse("consent_unavailable", 503);
  const target = new URL(context.consent.path, origin);
  target.searchParams.set("request", ticket);
  return redirectTo(target.toString());
}

/** Check the actual cookie session on EVERY read/decision, including after login. */
async function resolveConsent(context: McpOauthContext, request: Request, ticketText: string) {
  if (!context.consent) return refuse("consent_unavailable", 404);
  const session = await context.resolveSession(request);
  if (!session?.email) return refuse("login_required", 401);
  const origin = context.originOf(request);
  const ticket = await readConsentTicket(context, ticketText, origin);
  if (!ticket) return refuse("invalid_or_expired_request");
  if (consentSessionBinding(session) !== ticket.binding) return refuse("session_changed", 403);
  // Revalidate current client registration. All parameters come from the SIGNED
  // original query, never from caller-supplied approval fields.
  const original = new URL(context.paths.authorize, origin);
  original.search = ticket.query;
  const validated = await validateAuthorization(context, original, origin);
  if (validated instanceof Response) return refuse("invalid_request");
  if (context.consent.requireClientApproval && !(await context.approve(
    new Request(original, { headers: request.headers }),
    validated.client,
    validated.scope.split(/\s+/).filter(Boolean),
  ))) return refuse("access_denied", 403);
  return { session, origin, ticket, validated };
}

export async function consentDetailsEndpoint(
  context: McpOauthContext,
  request: Request,
): Promise<Response> {
  if (request.method !== "GET") return refuse("method_not_allowed", 405);
  const query = new URL(request.url).searchParams;
  if (query.getAll("request").length !== 1) return refuse("invalid_request");
  const resolved = await resolveConsent(context, request, query.get("request") ?? "");
  if (resolved instanceof Response) return resolved;
  const { validated, ticket, session } = resolved;
  return json({
    // Response-only identity: never part of the ticket or redirect URL.
    accountEmail: session.email,
    clientId: validated.clientId,
    clientName: validated.client.clientName,
    redirectUri: validated.redirectUri,
    scopes: [...new Set(validated.scope.split(/\s+/).filter(Boolean))],
    expiresAt: new Date(ticket.expiresAtMs).toISOString(),
  });
}

interface ConsentDecision {
  request: string;
  decision: "approve" | "deny";
}

async function readDecision(request: Request): Promise<ConsentDecision | null> {
  try {
    const text = await request.text();
    if (text.length > 26_000) return null;
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const body = value as Record<string, unknown>;
    if (typeof body.request !== "string" ||
      (body.decision !== "approve" && body.decision !== "deny")) return null;
    // Reject hidden OAuth parameter overrides rather than ignoring them.
    if (Object.keys(body).some((key) => key !== "request" && key !== "decision")) return null;
    return { request: body.request, decision: body.decision };
  } catch {
    return null;
  }
}

/** Same-origin JSON + a session-bound ticket are the server's CSRF proof. */
function isSameOriginDecision(context: McpOauthContext, request: Request): boolean {
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return request.method === "POST" && contentType === "application/json" &&
    request.headers.get("origin") === context.originOf(request);
}

async function consumeDecision(
  context: McpOauthContext,
  ticket: { jti: string; expiresAtMs: number },
): Promise<Response | null> {
  try {
    const used = await context.consent?.replay.consume(ticket.jti, Date.now(), ticket.expiresAtMs);
    return used ? null : refuse("request_already_decided", 409);
  } catch {
    // Uniqueness unknown is NOT approval. Never fall back to process memory.
    return refuse("consent_unavailable", 503);
  }
}

export async function consentDecisionEndpoint(
  context: McpOauthContext,
  request: Request,
): Promise<Response> {
  if (!context.consent) return refuse("consent_unavailable", 404);
  if (!isSameOriginDecision(context, request)) return refuse("invalid_origin", 403);
  const decision = await readDecision(request);
  if (!decision) return refuse("invalid_request");
  const resolved = await resolveConsent(context, request, decision.request);
  if (resolved instanceof Response) return resolved;
  const { session, origin, ticket, validated } = resolved;
  const replay = await consumeDecision(context, ticket);
  if (replay) return replay;
  // Consume before minting: a crash or repeated click can never issue two codes.
  // A lost response requires a fresh authorization flow, not a credential replay.
  const result = decision.decision === "deny"
    ? errorRedirect(validated.redirectUri, "access_denied", validated.state)
    : await mintAuthorization(context, session, origin, validated);
  return json({ redirectUrl: result.headers.get("location") });
}
