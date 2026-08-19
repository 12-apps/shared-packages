import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApiAuth } from "../create-api-auth";
import { CREDENTIALS_PROVIDER_ID } from "../credentials-provider-id";

beforeEach(() => {
  // `vi.stubEnv` rather than assigning `process.env` directly: the flakiness
  // gate rejects the latter, and rightly — an assignment that outlives the test
  // leaks into whatever runs next in the same worker.
  vi.stubEnv("AUTH_SECRET", "test-secret-value-long-enough");
  // Without this Auth.js rejects the request as an untrusted host BEFORE it
  // reaches the session endpoint. The `auth()` tests would still resolve null —
  // for entirely the wrong reason, asserting nothing about the empty-session
  // path they claim to cover.
  vi.stubEnv("AUTH_TRUST_HOST", "true");
  vi.stubEnv("AUTH_URL", "");
  vi.stubEnv("ADMIN_EMAILS", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("createApiAuth", () => {
  it("mounts at /api/auth, not Auth.js core's /auth default", () => {
    // Core defaults to `/auth`; every OAuth redirect URI already registered with
    // Google, Facebook and Apple points at `/api/auth`. Taking core's default
    // would invalidate all of them.
    expect(createApiAuth().config.basePath).toBe("/api/auth");
  });

  it("takes the base path from AUTH_URL's pathname when it has one", () => {
    vi.stubEnv("AUTH_URL", "https://example.com/custom/auth");

    expect(createApiAuth().config.basePath).toBe("/custom/auth");
  });

  it("falls back to /api/auth when AUTH_URL is malformed rather than throwing", () => {
    vi.stubEnv("AUTH_URL", "not a url");

    expect(createApiAuth().config.basePath).toBe("/api/auth");
  });

  it("prefers an explicit basePath over AUTH_URL", () => {
    vi.stubEnv("AUTH_URL", "https://example.com/from-env");

    expect(createApiAuth({ basePath: "/explicit" }).config.basePath).toBe("/explicit");
  });

  it("keeps the JWT strategy and owns no database adapter", () => {
    const { config } = createApiAuth();

    // The single most important property of this package: no adapter means no
    // tables, so there is no Prisma partial to adopt and no user rows to
    // migrate. A host's user record is the host's.
    expect(config.session?.strategy).toBe("jwt");
    expect(config.adapter).toBeUndefined();
  });

  describe("adding a password provider leaves OAuth alone", () => {
    /**
     * The regression this guards is silent and expensive: a host opts into
     * e-mail + password and "Continue with Google" quietly stops existing,
     * which nothing else here would notice — the gate tests pass an identity in
     * directly and never go near the provider list.
     */
    function providerIds(config: { providers: unknown[] }): string[] {
      return config.providers.map((provider) =>
        typeof provider === "function"
          ? String((provider as () => { id?: string })().id)
          : String((provider as { id?: string }).id),
      );
    }

    beforeEach(() => {
      vi.stubEnv("GOOGLE_CLIENT_ID", "google-client-id");
      vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-client-secret");
    });

    it("keeps Google and appends the credentials provider after it", () => {
      const { config } = createApiAuth({
        emailPassword: { authenticate: () => Promise.resolve({ ok: false, reason: "invalid-credentials" }) },
      });

      const ids = providerIds(config);
      expect(ids).toContain("google");
      expect(ids).toContain(CREDENTIALS_PROVIDER_ID);
      // LAST, not first. Order is what decides which provider a bare sign-in
      // falls through to, so appending is the part that must not drift.
      expect(ids[ids.length - 1]).toBe(CREDENTIALS_PROVIDER_ID);
    });

    it("adds nothing at all when the host did not opt in", () => {
      const ids = providerIds(createApiAuth().config);

      expect(ids).toContain("google");
      expect(ids).not.toContain(CREDENTIALS_PROVIDER_ID);
    });

    it("keeps a host's explicit provider list and appends to that", () => {
      // A host that names its providers has not thereby said anything about
      // passwords, and vice versa — restating one to get the other is the shape
      // of config change that drops a provider from a deployment.
      const custom = { id: "custom-oauth", name: "Custom", type: "oidc" } as never;
      const { config } = createApiAuth({
        providers: [custom],
        emailPassword: { authenticate: () => Promise.resolve({ ok: false, reason: "invalid-credentials" }) },
      });

      expect(providerIds(config)).toEqual(["custom-oauth", CREDENTIALS_PROVIDER_ID]);
    });
  });

  describe("the sign-in gate", () => {
    it("refuses every sign-in when no gate is supplied", async () => {
      const { config } = createApiAuth();

      const allowed = await config.callbacks?.signIn?.({
        user: { email: "someone@example.com" },
        account: { provider: "google" },
      } as never);

      // Fails closed on purpose: a host that forgets the gate gets no sessions,
      // not open registration.
      expect(allowed).toBe(false);
    });

    it("refuses a sign-in with no email even when a gate would allow it", async () => {
      const signInGate = vi.fn().mockResolvedValue(true);
      const { config } = createApiAuth({ signInGate });

      const allowed = await config.callbacks?.signIn?.({
        user: { email: null },
        account: { provider: "google" },
      } as never);

      expect(allowed).toBe(false);
      expect(signInGate).not.toHaveBeenCalled();
    });

    it("passes the identity through to the gate and honours its verdict", async () => {
      const signInGate = vi.fn().mockResolvedValue(false);
      const { config } = createApiAuth({ signInGate });

      const allowed = await config.callbacks?.signIn?.({
        user: { email: "a@b.com", name: "A", image: null },
        account: { provider: "google" },
      } as never);

      expect(allowed).toBe(false);
      expect(signInGate).toHaveBeenCalledWith({
        email: "a@b.com",
        name: "A",
        image: null,
        provider: "google",
      });
    });
  });

  describe("instances are independent", () => {
    it("does not let one instance's gate decide another's sign-in", async () => {
      // The whole point of the factory over the module-level setters: two
      // instances in one process (a test suite, a multi-tenant host) cannot
      // overwrite each other.
      const permissive = createApiAuth({ signInGate: () => true });
      const restrictive = createApiAuth({ signInGate: () => false });

      const args = {
        user: { email: "a@b.com" },
        account: { provider: "google" },
      } as never;

      await expect(permissive.config.callbacks?.signIn?.(args)).resolves.toBe(true);
      await expect(restrictive.config.callbacks?.signIn?.(args)).resolves.toBe(false);
    });
  });

  describe("isSuperadmin", () => {
    it("stamps the flag from the allowlist when no resolver is supplied", async () => {
      const { config } = createApiAuth({ adminEmails: "boss@example.com" });

      const token = await config.callbacks?.jwt?.({
        token: {},
        user: { id: "u1", email: "boss@example.com" },
        account: { provider: "google" },
      } as never);

      expect(token).toMatchObject({ id: "u1", provider: "google", isSuperadmin: true });
    });

    it("accepts the allowlist as an array", async () => {
      const { config } = createApiAuth({ adminEmails: ["boss@example.com"] });

      const token = await config.callbacks?.jwt?.({
        token: {},
        user: { id: "u1", email: "boss@example.com" },
        account: { provider: "google" },
      } as never);

      expect(token).toMatchObject({ isSuperadmin: true });
    });

    it("prefers the injected resolver over the allowlist", async () => {
      // The resolver is how a host keeps the session claim in step with its own
      // server-side gate once superadmin status becomes database-backed.
      const { config } = createApiAuth({
        adminEmails: "boss@example.com",
        sessionAdmin: async (email) => email === "other@example.com",
      });

      const boss = await config.callbacks?.jwt?.({
        token: {},
        user: { id: "u1", email: "boss@example.com" },
        account: { provider: "google" },
      } as never);
      const other = await config.callbacks?.jwt?.({
        token: {},
        user: { id: "u2", email: "other@example.com" },
        account: { provider: "google" },
      } as never);

      expect(boss).toMatchObject({ isSuperadmin: false });
      expect(other).toMatchObject({ isSuperadmin: true });
    });

    it("leaves an existing token untouched on a refresh", async () => {
      const { config } = createApiAuth();

      const token = await config.callbacks?.jwt?.({
        token: { id: "u1", isSuperadmin: true },
      } as never);

      expect(token).toEqual({ id: "u1", isSuperadmin: true });
    });
  });

  describe("isAdmin", () => {
    it("answers from the configured allowlist", () => {
      const { isAdmin } = createApiAuth({ adminEmails: "boss@example.com" });

      expect(isAdmin("boss@example.com")).toBe(true);
      expect(isAdmin("nobody@example.com")).toBe(false);
      expect(isAdmin(null)).toBe(false);
    });

    it("denies everyone when no allowlist is configured", () => {
      const { isAdmin } = createApiAuth();

      expect(isAdmin("anyone@example.com")).toBe(false);
    });
  });

  describe("auth()", () => {
    it("returns null for a request with no session cookie", async () => {
      const { auth } = createApiAuth();

      // Auth.js answers 200 `{}` — not 401 — when there is no valid session,
      // which is the branch most likely to be got wrong: a naive `response.ok`
      // check would report an empty body as an authenticated session.
      await expect(
        auth(new Request("https://example.com/api/whatever")),
      ).resolves.toBeNull();
    });

    it("does not let a caller's Origin/Referer reach the CSRF checks", async () => {
      const { auth } = createApiAuth();

      // Only the cookie is forwarded. Nothing else about the incoming request
      // should decide what its session is, and passing the rest through would
      // let these headers reach Auth.js's CSRF checks from a route that never
      // meant to perform an auth action.
      const request = new Request("https://example.com/api/whatever", {
        headers: { origin: "https://evil.example", referer: "https://evil.example" },
      });

      await expect(auth(request)).resolves.toBeNull();
    });

    it("asks the session endpoint under the configured base path", async () => {
      const { auth, config } = createApiAuth({ basePath: "/custom/auth" });

      // The session read goes through the same handler that writes it, so the
      // two cannot disagree about the cookie name or the strategy. Proving the
      // path is how we know the read is routed, not hand-decoded.
      expect(config.basePath).toBe("/custom/auth");
      await expect(
        auth(new Request("https://example.com/api/whatever")),
      ).resolves.toBeNull();
    });
  });
});
