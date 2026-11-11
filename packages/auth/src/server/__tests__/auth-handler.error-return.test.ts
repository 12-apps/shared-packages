// @vitest-environment node
// Node, not jsdom, for the same reason as `oauth-error-return.test.ts`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The legacy `authHandler` takes the same opt-in as `createApiAuth`
 * (FUT-4595): off by default, on through `setErrorReturnsToStart(true)`.
 *
 * The module reads its environment and builds its providers at import time,
 * so each case imports it fresh after stubbing what it needs. Google's
 * discovery fetch is made to fail, which is the shape the live reproduction
 * hit: Auth.js answers `Configuration` before it reads the refusal.
 */

const START = "/entrar?volta=%2Fpainel";
const CALLBACK = "http://localhost:3000/api/auth/callback/google?error=access_denied";

async function freshLegacy() {
  vi.resetModules();
  const config = await import("../../config");
  const handler = await import("../auth-handler");
  return { setErrorReturnsToStart: config.setErrorReturnsToStart, authHandler: handler.authHandler };
}

function refusal(): Request {
  return new Request(CALLBACK, {
    headers: { cookie: `authjs.sign-in-start=${encodeURIComponent(START)}` },
  });
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", "test-secret-value-long-enough");
  vi.stubEnv("AUTH_TRUST_HOST", "true");
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("legacy authHandler — a failed OAuth sign-in and its start page", () => {
  it("is off by default: Auth.js's own redirect, untouched", async () => {
    const { authHandler } = await freshLegacy();

    const response = await authHandler(refusal());

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("error")).toBe("Configuration");
    expect(response.headers.getSetCookie().join("\n")).not.toContain("sign-in-start");
  });

  it("returns to the start, as OAuthCallback, once turned on", async () => {
    const { authHandler, setErrorReturnsToStart } = await freshLegacy();
    setErrorReturnsToStart(true);

    const response = await authHandler(refusal());

    expect(response.status).toBe(302);
    const target = new URL(response.headers.get("location") ?? "");
    expect(target.pathname).toBe("/entrar");
    expect(target.searchParams.get("volta")).toBe("/painel");
    expect(target.searchParams.get("error")).toBe("OAuthCallback");
  });
});
