import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";

import { inProcessConsentReplayStore } from "../consent-ticket";
import { verifyCode } from "../authorization-code";
import { asHarness, authorize, pkcePair, registerTestClient, token } from "./fixtures";

const ORIGIN = "https://app.example.com";
const CALLBACK = "https://claude.ai/api/mcp/auth_callback?existing=a%2Bb";
const FIXED_NOW = Date.parse("2026-09-10T12:00:00.000Z");

afterEach(() => vi.useRealTimers());

async function flow(overrides: Parameters<typeof asHarness>[0] = {}) {
  const harness = await asHarness({
    consent: { path: "/admin/oauth-consent", replay: inProcessConsentReplayStore() },
    ...overrides,
  });
  harness.session.current = {
    subject: "google-sub-1", email: "owner@example.com", sessionBinding: "cookie-session-one",
  };
  const { clientId } = await registerTestClient(harness.api, { redirect_uris: [CALLBACK] });
  const pair = await pkcePair();
  const params = {
    response_type: "code", client_id: clientId, redirect_uri: CALLBACK,
    code_challenge: pair.challenge, code_challenge_method: "S256",
    scope: "mcp:read mcp:write", state: "verbatim +/?=&漢字",
    resource: `${ORIGIN}/api/mcp`,
  };
  const response = await authorize(harness.api, params);
  const location = new URL(response.headers.get("location") ?? ORIGIN);
  const ticket = location.searchParams.get("request") ?? "";
  return { ...harness, ...pair, params, clientId, response, location, ticket };
}

function detailsRequest(ticket: string): Request {
  return new Request(`${ORIGIN}/api/oauth/consent?${new URLSearchParams({ request: ticket })}`);
}

function decisionRequest(ticket: string, decision = "approve", overrides: RequestInit = {}): Request {
  return new Request(`${ORIGIN}/api/oauth/consent`, {
    method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ request: ticket, decision }), ...overrides,
  });
}

async function decide(f: Awaited<ReturnType<typeof flow>>, decision = "approve") {
  return f.api.handlers.consentDecision(decisionRequest(f.ticket, decision));
}

describe("interactive OAuth consent", () => {
  it("displays and issues exactly no scopes when scope is omitted, empty or whitespace", async () => {
    for (const scope of [undefined, "", "  "]) {
      const f = await flow();
      const scopeParams: Record<string, string> = { ...f.params };
      if (scope === undefined) delete scopeParams.scope;
      else scopeParams.scope = scope;
      const started = await authorize(f.api, scopeParams);
      const ticket = new URL(started.headers.get("location") ?? ORIGIN).searchParams.get("request") ?? "";
      const details = await f.api.handlers.consentDetails(detailsRequest(ticket));
      expect((await details.json() as { scopes: string[] }).scopes).toEqual([]);
      const approved = await f.api.handlers.consentDecision(decisionRequest(ticket));
      const redirect = new URL((await approved.json() as { redirectUrl: string }).redirectUrl);
      const grant = await token(f.api, {
        grant_type: "authorization_code", code: redirect.searchParams.get("code") ?? "",
        client_id: f.clientId, redirect_uri: CALLBACK, code_verifier: f.verifier,
      });
      const issued = await grant.json() as { scope: string; access_token: string };
      expect(issued.scope).toBe("");
      expect((await f.api.verifyBearer(issued.access_token, new Request(`${ORIGIN}/api/mcp`))).scopes).toEqual([]);
    }
  });

  it("rechecks a reduced client ceiling and never widens the signed scope request", async () => {
    const f = await flow();
    const client = f.stores.clients.rows()[0]!;
    client.scopes = ["mcp:read"];
    expect((await decide(f)).status).toBe(400);
    const limited = await authorize(f.api, { ...f.params, scope: "mcp:read" });
    const ticket = new URL(limited.headers.get("location") ?? ORIGIN).searchParams.get("request") ?? "";
    client.scopes = ["mcp:read", "mcp:write"];
    const approved = await f.api.handlers.consentDecision(decisionRequest(ticket));
    const location = new URL((await approved.json() as { redirectUrl: string }).redirectUrl);
    const verified = await verifyCode(f.api.context.signingKey, location.searchParams.get("code") ?? "", { origin: ORIGIN });
    expect(verified.scope).toBe("mcp:read");
  });
  it("can preserve eligibility rules without treating eligibility as human approval", async () => {
    const config = { path: "/admin/oauth-consent", replay: inProcessConsentReplayStore(), requireClientApproval: true };
    const refused = await flow({ consent: config, resolveApproval: () => false });
    expect(refused.location.searchParams.get("error")).toBe("access_denied");
    expect(refused.ticket).toBe("");
    const allowed = await flow({ consent: config, resolveApproval: () => true });
    expect(allowed.location.pathname).toBe("/admin/oauth-consent");
    allowed.api.context.approve = async () => false;
    expect((await decide(allowed)).status).toBe(403);
    expect(allowed.stores.refreshTokens.rows()).toEqual([]);
  });
  it("displays the exact callback, client and scopes without issuing a code", async () => {
    const f = await flow();
    expect(f.location.pathname).toBe("/admin/oauth-consent");
    expect(f.location.searchParams.has("code")).toBe(false);
    expect(f.stores.refreshTokens.rows()).toEqual([]);
    const result = await f.api.handlers.consentDetails(detailsRequest(f.ticket));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(await result.json()).toMatchObject({
      accountEmail: "owner@example.com",
      clientId: f.clientId, clientName: "Claude", redirectUri: CALLBACK,
      scopes: ["mcp:read", "mcp:write"],
    });
    const payload = decodeJwt(f.ticket);
    expect(payload.email).toBeUndefined();
    expect(payload.sub).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain("cookie-session-one");
    expect(JSON.stringify(payload)).not.toContain("owner@example.com");
  });

  it("requires explicit consent even for an operator-preapproved id and approval callback", async () => {
    const f = await flow();
    const preapproved = await asHarness({
      stores: f.stores, signingKey: f.api.context.signingKey,
      resolveSession: () => f.session.current, preApprovedClientIds: [f.clientId],
      resolveApproval: () => true,
      consent: { path: "/admin/oauth-consent", replay: inProcessConsentReplayStore() },
    });
    const result = await authorize(preapproved.api, f.params);
    expect(new URL(result.headers.get("location") ?? ORIGIN).pathname).toBe("/admin/oauth-consent");
  });

  it("only approve mints a code, preserving identity, PKCE, callback, scopes and state", async () => {
    const f = await flow();
    const result = await decide(f);
    expect(result.status).toBe(200);
    const body = await result.json() as { redirectUrl: string };
    const location = new URL(body.redirectUrl);
    expect(location.searchParams.get("existing")).toBe("a+b");
    expect(location.searchParams.get("state")).toBe(f.params.state);
    const code = location.searchParams.get("code") ?? "";
    expect(await verifyCode(f.api.context.signingKey, code, { origin: ORIGIN })).toMatchObject({
      clientId: f.clientId, redirectUri: CALLBACK, codeChallenge: f.challenge,
      scope: f.params.scope, email: "owner@example.com", sub: "google-sub-1",
    });
    const grant = await token(f.api, {
      grant_type: "authorization_code", code, client_id: f.clientId,
      redirect_uri: CALLBACK, code_verifier: f.verifier,
    });
    expect(grant.status).toBe(200);
    expect((await decide(f)).status).toBe(409);
  });

  it("denies explicitly, echoes state, and cannot later approve the same request", async () => {
    const f = await flow();
    const result = await decide(f, "deny");
    const body = await result.json() as { redirectUrl: string };
    const location = new URL(body.redirectUrl);
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe(f.params.state);
    expect(location.searchParams.has("code")).toBe(false);
    expect((await decide(f)).status).toBe(409);
    expect(f.stores.refreshTokens.rows()).toEqual([]);
  });

  it("claims only one of concurrent approve/deny decisions", async () => {
    const f = await flow();
    const results = await Promise.all([decide(f), decide(f, "deny")]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  });

  it("refuses missing/different origins and simple form posts without burning the ticket", async () => {
    const f = await flow();
    for (const headers of [
      { "content-type": "application/json" },
      { origin: "https://attacker.example", "content-type": "application/json" },
      { origin: ORIGIN, "content-type": "application/x-www-form-urlencoded" },
    ]) {
      const result = await f.api.handlers.consentDecision(decisionRequest(f.ticket, "approve", { headers }));
      expect(result.status).toBe(403);
    }
    expect((await decide(f)).status).toBe(200);
  });

  it("rejects approval-field overrides and altered signatures", async () => {
    const f = await flow();
    const forged = await f.api.handlers.consentDecision(decisionRequest(f.ticket, "approve", {
      body: JSON.stringify({ request: f.ticket, decision: "approve", scope: "mcp:write" }),
    }));
    expect(forged.status).toBe(400);
    const identityOverride = await f.api.handlers.consentDecision(decisionRequest(f.ticket, "approve", {
      body: JSON.stringify({ request: f.ticket, decision: "approve", accountEmail: "other@example.com" }),
    }));
    expect(identityOverride.status).toBe(400);
    const parts = f.ticket.split(".");
    parts[1] = `${parts[1]}a`;
    expect((await f.api.handlers.consentDetails(detailsRequest(parts.join(".")))).status).toBe(400);
    expect((await decide(f)).status).toBe(200);
  });

  it("refuses session loss, a different account, or a different login of the same account", async () => {
    const f = await flow();
    const original = f.session.current;
    f.session.current = null;
    expect((await decide(f)).status).toBe(401);
    f.session.current = { ...original!, email: "someone@example.com" };
    expect((await decide(f)).status).toBe(403);
    f.session.current = { ...original!, sessionBinding: "another-login" };
    expect((await decide(f)).status).toBe(403);
    f.session.current = original;
    expect((await decide(f)).status).toBe(200);
  });

  it("allows a fresh parallel flow without replacing another tab's request", async () => {
    const f = await flow();
    const second = await authorize(f.api, { ...f.params, state: "second-tab" });
    const ticket = new URL(second.headers.get("location") ?? ORIGIN).searchParams.get("request") ?? "";
    expect((await decide(f)).status).toBe(200);
    const result = await f.api.handlers.consentDecision(decisionRequest(ticket));
    expect(result.status).toBe(200);
    expect(new URL((await result.json() as { redirectUrl: string }).redirectUrl).searchParams.get("state"))
      .toBe("second-tab");
  });

  it("expires interrupted flows, and keeps a decision claimed beyond code-replay's 90 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
    const f = await flow();
    expect((await decide(f)).status).toBe(200);
    vi.setSystemTime(FIXED_NOW + 100_000);
    expect((await decide(f)).status).toBe(409);
    vi.setSystemTime(FIXED_NOW + 301_000);
    expect((await decide(f)).status).toBe(400);
  });

  it("fails closed when the shared single-use store is unavailable", async () => {
    const f = await flow({ consent: { path: "/admin/oauth-consent", replay: {
      consume: () => { throw new Error("store offline"); },
    } } });
    expect((await decide(f)).status).toBe(503);
    expect(f.stores.refreshTokens.rows()).toEqual([]);
  });

  it("never redirects to an unregistered callback or arbitrary resource", async () => {
    const f = await flow();
    const bad = await authorize(f.api, { ...f.params, redirect_uri: "https://attacker.example/cb" });
    expect(bad.status).toBe(400);
    expect(bad.headers.has("location")).toBe(false);
    const resource = await authorize(f.api, { ...f.params, resource: "https://other.example/api/mcp" });
    expect(new URL(resource.headers.get("location") ?? ORIGIN).searchParams.get("error")).toBe("invalid_request");
    const duplicate = new URL(`${ORIGIN}/api/oauth/authorize?${new URLSearchParams(f.params)}`);
    duplicate.searchParams.append("scope", "mcp:write");
    expect((await f.api.handlers.authorize(new Request(duplicate))).status).toBe(400);
  });

  it("does not accept a consent ticket as an OAuth code or bearer credential", async () => {
    const f = await flow();
    await expect(verifyCode(f.api.context.signingKey, f.ticket, { origin: ORIGIN })).rejects.toThrow();
    await expect(f.api.verifyBearer(f.ticket, new Request(`${ORIGIN}/api/mcp`))).rejects.toThrow();
  });

  it("fails closed without a login-session binding and validates the configured UI path", async () => {
    const f = await flow();
    f.session.current = { subject: "google-sub-1", email: "owner@example.com" };
    const missing = await authorize(f.api, f.params);
    expect(missing.status).toBe(302);
    const reauthenticate = new URL(missing.headers.get("location") ?? ORIGIN);
    expect(reauthenticate.pathname).toBe("/admin/oauth-consent");
    expect(reauthenticate.searchParams.get("reauthenticate")).toBe("1");
    expect(reauthenticate.searchParams.has("request")).toBe(false);
    await expect(asHarness({ consent: { path: "//attacker.example", replay: inProcessConsentReplayStore() } }))
      .rejects.toThrow("same-origin");
  });
});
