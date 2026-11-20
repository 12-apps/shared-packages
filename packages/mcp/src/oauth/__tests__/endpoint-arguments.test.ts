import { describe, expect, it } from "vitest";

import { inProcessConsentReplayStore } from "../consent-ticket";
import {
  authorizeArguments,
  consentDecisionArguments,
  consentDetailsArguments,
  registerArguments,
  tokenArguments,
} from "../endpoint-arguments";
import { asHarness, pkcePair } from "./fixtures";

/**
 * The OAuth endpoints with their input as ARGUMENTS (`api.endpoints`): a host
 * that validates every request strictly parses the input against the engine's
 * own closed schemas, and the engine works on exactly those arguments — never
 * the request's own query string or body.
 */

const ORIGIN = "https://app.example.com";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const SESSION = { subject: "google-sub-1", email: "owner@example.com", sessionBinding: "cookie-session-one" };

/** A surface with the consent screen on, and the owner signed in. */
async function consentSurface() {
  const harness = await asHarness({ consent: { path: "/admin/oauth-consent", replay: inProcessConsentReplayStore() } });
  harness.session.current = SESSION;
  return harness.api;
}

function post(path: string): Request {
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN } });
}

describe("the argument schemas", () => {
  it("are closed: an unknown key is refused at every endpoint", () => {
    expect(authorizeArguments.safeParse({ client_id: "c", evil: "1" }).success).toBe(false);
    expect(consentDetailsArguments.safeParse({ request: "t", extra: "1" }).success).toBe(false);
    expect(consentDecisionArguments.safeParse({ request: "t", decision: "approve", scope: "mcp:write" }).success).toBe(false);
    expect(tokenArguments.safeParse({ grant_type: "authorization_code", admin: "1" }).success).toBe(false);
    expect(registerArguments.safeParse({ client_name: "Claude", jwks: { keys: [] } }).success).toBe(false);
  });

  it("accept what an RFC client sends, including the parameters the engine ignores", () => {
    expect(authorizeArguments.safeParse({
      response_type: "code", client_id: "c", redirect_uri: CALLBACK, scope: "mcp:read", state: "s",
      code_challenge: "x", code_challenge_method: "S256", resource: `${ORIGIN}/api/mcp`, prompt: "consent",
    }).success).toBe(true);
    expect(registerArguments.safeParse({
      client_name: "Claude", redirect_uris: [CALLBACK], grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"], token_endpoint_auth_method: "none", logo_uri: "https://claude.ai/logo.png",
    }).success).toBe(true);
  });

  it("refuse a decision that is neither approve nor deny, and a list where a string belongs", () => {
    expect(consentDecisionArguments.safeParse({ request: "t", decision: "maybe" }).success).toBe(false);
    expect(authorizeArguments.safeParse({ client_id: ["a", "b"] }).success).toBe(false);
  });
});

describe("the whole connect through api.endpoints", () => {
  it("registers, authorizes, consents, redeems and refreshes on arguments alone", async () => {
    const api = await consentSurface();
    const registered = await api.endpoints.register(post("/api/oauth/register"), {
      client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none",
    });
    expect(registered.status).toBe(201);
    const clientId = ((await registered.json()) as { client_id: string }).client_id;

    const { verifier, challenge } = await pkcePair();
    const authorized = await api.endpoints.authorize(new Request(`${ORIGIN}/api/oauth/authorize`), {
      response_type: "code", client_id: clientId, redirect_uri: CALLBACK, scope: "mcp:read",
      code_challenge: challenge, code_challenge_method: "S256", state: "st-1",
    });
    expect(authorized.status).toBe(302);
    const ticket = new URL(authorized.headers.get("location") ?? "").searchParams.get("request") ?? "";

    const details = await api.endpoints.consentDetails(new Request(`${ORIGIN}/api/oauth/consent`), { request: ticket });
    expect(details.status).toBe(200);
    expect(await details.json()).toMatchObject({ clientId, scopes: ["mcp:read"] });

    const decided = await api.endpoints.consentDecision(post("/api/oauth/consent"), { request: ticket, decision: "approve" });
    expect(decided.status).toBe(200);
    const code = new URL(((await decided.json()) as { redirectUrl: string }).redirectUrl).searchParams.get("code") ?? "";

    const issued = await api.endpoints.token(post("/api/oauth/token"), {
      grant_type: "authorization_code", code, redirect_uri: CALLBACK, code_verifier: verifier, client_id: clientId,
    });
    expect(issued.status).toBe(200);
    const { refresh_token: refreshToken } = (await issued.json()) as { refresh_token: string };

    const refreshed = await api.endpoints.token(post("/api/oauth/token"), {
      grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId,
    });
    expect(refreshed.status).toBe(200);
  });
});

describe("arguments, never the request's own input", () => {
  it("reads authorize from the arguments, not from the request's query string", async () => {
    const api = await consentSurface();
    const forged = new Request(`${ORIGIN}/api/oauth/authorize?client_id=forged&redirect_uri=https%3A%2F%2Fevil.example.com`);
    const answer = await api.endpoints.authorize(forged, {});
    // No client in the arguments: a plain 400, never a redirect to the forged callback.
    expect(answer.status).toBe(400);
    expect(answer.headers.get("location")).toBeNull();
  });

  it("reads token from the arguments, not from the request's body", async () => {
    const api = await consentSurface();
    const withBody = new Request(`${ORIGIN}/api/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: ORIGIN },
      body: "grant_type=refresh_token&refresh_token=forged&client_id=forged",
    });
    const answer = await api.endpoints.token(withBody, {});
    expect(answer.status).toBe(400);
    expect(await answer.json()).toMatchObject({ error: "invalid_request" });
  });

  it("still takes the person from the request's cookie session, never from an argument", async () => {
    const harness = await asHarness({ consent: { path: "/admin/oauth-consent", replay: inProcessConsentReplayStore() } });
    harness.session.current = SESSION;
    const { api } = harness;
    const registered = await api.endpoints.register(post("/api/oauth/register"), { client_name: "Claude", redirect_uris: [CALLBACK] });
    const clientId = ((await registered.json()) as { client_id: string }).client_id;
    const { challenge } = await pkcePair();
    const authorized = await api.endpoints.authorize(new Request(`${ORIGIN}/api/oauth/authorize`), {
      response_type: "code", client_id: clientId, redirect_uri: CALLBACK, scope: "mcp:read", code_challenge: challenge, code_challenge_method: "S256",
    });
    const ticket = new URL(authorized.headers.get("location") ?? "").searchParams.get("request") ?? "";
    harness.session.current = null;
    const details = await api.endpoints.consentDetails(new Request(`${ORIGIN}/api/oauth/consent`), { request: ticket });
    expect(details.status).toBe(401);
  });
});
