import { describe, expect, it, vi } from "vitest";

import { createEmailAuth } from "../create-email-auth";
import { parseSignInUrl } from "../password-signin";

/**
 * The browser client's half of the wire contract: which URL each call hits,
 * and how an answer becomes a result.
 *
 * The refusal-parsing tests are the ones with teeth. Everything here is
 * untrusted input — a reverse proxy's HTML error page reaches this code as
 * readily as the host's own JSON — and the failure this guards is a screen that
 * renders `undefined` at a person who just wanted to reset their password.
 */

function fakeFetch(
  reply: { status: number; body: unknown } | { throws: true },
): { impl: typeof fetch; calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    if ("throws" in reply) throw new TypeError("network down");
    return new Response(JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("createEmailAuth routing", () => {
  it("posts each call to its own endpoint under the base path", async () => {
    const cases: [string, (client: ReturnType<typeof createEmailAuth>) => Promise<unknown>][] = [
      ["/api/auth/email/signup", (c) => c.signUp({ email: "a@b.co", password: "x" })],
      ["/api/auth/email/verify", (c) => c.verifyEmail("t")],
      ["/api/auth/email/resend-verification", (c) => c.resendVerification("a@b.co")],
      ["/api/auth/email/forgot-password", (c) => c.requestPasswordReset("a@b.co")],
      ["/api/auth/email/reset-password", (c) => c.resetPassword("t", "x")],
      ["/api/auth/email/password", (c) => c.setPassword({ password: "x" })],
      ["/api/auth/email/settings", (c) => c.getSettings()],
    ];

    for (const [expectedUrl, call] of cases) {
      const { impl, calls } = fakeFetch({ status: 200, body: { data: null } });
      await call(createEmailAuth({ fetchImpl: impl }));
      expect(calls[0]?.url).toBe(expectedUrl);
    }
  });

  it("honours a custom base path", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { data: null } });
    await createEmailAuth({ basePath: "/auth/mail", fetchImpl: impl }).verifyEmail("t");
    expect(calls[0]?.url).toBe("/auth/mail/verify");
  });

  it("sends the session cookie — the signed-in calls do not work without it", async () => {
    const { impl, calls } = fakeFetch({ status: 200, body: { data: null } });
    await createEmailAuth({ fetchImpl: impl }).setPassword({ password: "x" });
    expect(calls[0]?.init.credentials).toBe("same-origin");
    expect(calls[0]?.init.method).toBe("PUT");
  });

  it("reads the security state with GET and no body", async () => {
    const { impl, calls } = fakeFetch({
      status: 200,
      body: { data: { hasPassword: false, emailVerified: true } },
    });
    const result = await createEmailAuth({ fetchImpl: impl }).getSecurity();
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
    expect(result).toEqual({ ok: true, data: { hasPassword: false, emailVerified: true } });
  });
});

describe("createEmailAuth results", () => {
  it("unwraps the data envelope on success", async () => {
    const { impl } = fakeFetch({ status: 200, body: { data: { status: "verification-sent" } } });
    await expect(
      createEmailAuth({ fetchImpl: impl }).signUp({ email: "a@b.co", password: "x" }),
    ).resolves.toEqual({ ok: true, data: { status: "verification-sent" } });
  });

  it("carries the refusal code through, so the screen can be specific", async () => {
    const { impl } = fakeFetch({
      status: 400,
      body: { error: "…", reason: "email-not-verified" },
    });
    await expect(createEmailAuth({ fetchImpl: impl }).verifyEmail("t")).resolves.toEqual({
      ok: false,
      reason: "email-not-verified",
    });
  });

  it("carries the broken password rules through", async () => {
    const { impl } = fakeFetch({
      status: 400,
      body: { error: "…", reason: "weak-password", violations: ["too-short", "needs-number"] },
    });
    await expect(
      createEmailAuth({ fetchImpl: impl }).resetPassword("t", "a"),
    ).resolves.toEqual({
      ok: false,
      reason: "weak-password",
      violations: ["too-short", "needs-number"],
    });
  });

  it("collapses a code it does not know rather than showing it to a user", async () => {
    const { impl } = fakeFetch({ status: 400, body: { error: "…", reason: "OAuthCallbackError" } });
    await expect(createEmailAuth({ fetchImpl: impl }).verifyEmail("t")).resolves.toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("survives a body that is not the contract at all", async () => {
    for (const body of [null, "<html>502</html>", { message: "nope" }, []]) {
      const { impl } = fakeFetch({ status: 502, body });
      await expect(createEmailAuth({ fetchImpl: impl }).verifyEmail("t")).resolves.toEqual({
        ok: false,
        reason: "unknown",
      });
    }
  });

  it("treats a dead network as a refusal, not an exception", async () => {
    const { impl } = fakeFetch({ throws: true });
    await expect(createEmailAuth({ fetchImpl: impl }).verifyEmail("t")).resolves.toEqual({
      ok: false,
      reason: "unknown",
    });
  });
});

describe("parseSignInUrl", () => {
  it("reads a success as the URL to navigate to", () => {
    expect(parseSignInUrl("https://app.example.com/pedidos")).toEqual({
      ok: true,
      url: "https://app.example.com/pedidos",
    });
  });

  it("reads the refusal code Auth.js put on the URL", () => {
    expect(
      parseSignInUrl("https://app.example.com/login?error=CredentialsSignin&code=invalid-credentials"),
    ).toEqual({ ok: false, reason: "invalid-credentials" });
    expect(
      parseSignInUrl("https://app.example.com/login?error=CredentialsSignin&code=email-not-verified"),
    ).toEqual({ ok: false, reason: "email-not-verified" });
  });

  it("does not leak an Auth.js-internal code to the UI", () => {
    expect(parseSignInUrl("/login?error=Configuration")).toEqual({
      ok: false,
      reason: "unknown",
    });
  });

  it("refuses a URL it cannot parse rather than reporting success", () => {
    // A scheme with no host. Most malformed-looking strings resolve fine
    // against the base and are treated as relative paths — which is correct,
    // since that is what the callback URL usually is.
    expect(parseSignInUrl("http://")).toEqual({ ok: false, reason: "unknown" });
  });

  it("treats a bare relative path as the success it is", () => {
    expect(parseSignInUrl("/pedidos")).toEqual({ ok: true, url: "/pedidos" });
  });
});
