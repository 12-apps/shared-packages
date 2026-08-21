import { describe, expect, it, vi } from "vitest";

import type { EmailCredentials } from "../../email-credentials";
import { PT_BR_MESSAGES } from "../../server/pt-BR";
import { mountEmailAuth, mountEmailAuthSettings } from "../mount";

/**
 * The MOUNT — the router seen through HTTP, which is the only altitude where
 * some of these properties are visible at all.
 *
 * `email-routes.test.ts` asserts the descriptors: what `handle` returns for a
 * given request. What it cannot reach is everything the adapter does around
 * them — the status actually written to the wire, the 401 that fires before
 * `handle` runs, the body parse that tolerates garbage, and which verbs a route
 * file ends up exporting.
 *
 * Those were being asserted in a HOST, against its own `route.ts`. They are not
 * that host's behaviour: the paths, the statuses and the envelope are all built
 * to match the packaged browser client, so a host asserting them is asserting
 * this package's contract on this package's behalf — and only for as long as
 * that one repo keeps the test.
 */

/** Only the methods a test actually reaches; the rest throw if touched. */
function credentialsStub(overrides: Partial<EmailCredentials>): EmailCredentials {
  const refuse = (name: string) => (): never => {
    throw new Error(`${name} was not expected in this test`);
  };
  return {
    signUp: refuse("signUp"),
    verifyEmail: refuse("verifyEmail"),
    resendVerification: refuse("resendVerification"),
    requestPasswordReset: refuse("requestPasswordReset"),
    resetPassword: refuse("resetPassword"),
    setPassword: refuse("setPassword"),
    hasPassword: refuse("hasPassword"),
    accountSecurity: refuse("accountSecurity"),
    authenticate: refuse("authenticate"),
    readSettings: refuse("readSettings"),
    ...overrides,
  } as EmailCredentials;
}

const PREFIX = "/api/auth/email";

function post(path: string, body?: unknown): Request {
  return new Request(`http://host${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("mountEmailAuth", () => {
  it("reports the verification-sent status", async () => {
    // The two sign-up outcomes are DIFFERENT sentences on the screen — "check
    // your inbox" versus "you're in" — so the status has to survive the trip
    // through the adapter, not just be returned by the flow.
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({
        signUp: vi.fn(async () => ({ ok: true as const, status: "verification-sent" as const })),
      }),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    const response = await POST(post(`${PREFIX}/signup`, { email: "a@b.test", password: "Sufficient1!" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: "verification-sent" } });
  });

  it("reports the signed-up status when verification is off", async () => {
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({
        signUp: vi.fn(async () => ({ ok: true as const, status: "signed-up" as const })),
      }),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    const response = await POST(post(`${PREFIX}/signup`, { email: "a@b.test", password: "Sufficient1!" }));

    expect(await response.json()).toMatchObject({ data: { status: "signed-up" } });
  });

  it("passes the optional name through to the flow", async () => {
    const signUp = vi.fn(async () => ({ ok: true as const, status: "signed-up" as const }));
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({ signUp }),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    await POST(post(`${PREFIX}/signup`, { email: "a@b.test", password: "Sufficient1!", name: "Ana" }));

    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ name: "Ana" }));
  });

  it("maps a weak password to 400 with the rules that were broken", async () => {
    // The screen lists the unmet rules under the field. A bare 400 would leave
    // it saying "invalid" with nothing to act on.
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({
        signUp: vi.fn(async () => ({
          ok: false as const,
          reason: "weak-password" as const,
          violations: ["too-short", "no-digit"],
        })),
      }),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    const response = await POST(post(`${PREFIX}/signup`, { email: "a@b.test", password: "x" }));

    expect(response.status).toBe(400);
    const body = (await response.json()) as { reason: string; violations: string[] };
    expect(body.reason).toBe("weak-password");
    expect(body.violations).toHaveLength(2);
  });

  it("maps the disabled method to 403", async () => {
    // Not 404. The endpoint exists and the platform has switched the METHOD
    // off — a 404 would read as "wrong URL" and send somebody debugging their
    // client instead of looking at the switch.
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({
        signUp: vi.fn(async () => ({ ok: false as const, reason: "method-disabled" as const })),
      }),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    const response = await POST(post(`${PREFIX}/signup`, { email: "a@b.test", password: "Sufficient1!" }));

    expect(response.status).toBe(403);
  });

  it("hands a body missing the password to the FLOW, rather than schema-rejecting it", async () => {
    // The refusals are deliberately indistinguishable, and a schema that
    // rejected a missing field before the flow saw it would answer a different
    // shape — and a different TIMING — than a wrong password does.
    const signUp = vi.fn(async () => ({ ok: false as const, reason: "invalid-email" as const }));
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({ signUp }),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    await POST(post(`${PREFIX}/signup`, { email: "a@b.test" }));

    expect(signUp).toHaveBeenCalled();
  });

  it("hands a malformed body to the flow as an empty object", async () => {
    const signUp = vi.fn(async () => ({ ok: false as const, reason: "invalid-email" as const }));
    const { POST } = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({ signUp }),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    const response = await POST(
      new Request(`http://host${PREFIX}/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{not json",
      }),
    );

    expect(response.status).toBe(400);
    expect(signUp).toHaveBeenCalled();
  });

  it("401s a session-gated route before the flow is reached", async () => {
    const setPassword = vi.fn();
    const { PUT } = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({ setPassword }),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    const response = await PUT(
      new Request(`http://host${PREFIX}/password`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "Sufficient1!" }),
      }),
    );

    expect(response.status).toBe(401);
    expect(setPassword).not.toHaveBeenCalled();
  });

  it("answers an unknown sub-path with the host's own 404 body", async () => {
    // Hono's default is plain text. An API whose every other unknown path
    // answers `{ error }` must not have one prefix that answers differently.
    const { POST } = mountEmailAuth({
      path: PREFIX,
      notFound: () => Response.json({ error: "Not found." }, { status: 404 }),
      credentials: credentialsStub({}),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    const response = await POST(post(`${PREFIX}/no-such-thing`, {}));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found." });
  });

  it("exports every verb the descriptors use, so no route is reachable-but-405", async () => {
    // The failure this replaces: a host hand-writing the verb exports forgets
    // PUT, the reset endpoint answers 405, and nothing is red because no test
    // drives a verb the file does not export.
    const handlers = mountEmailAuth({
      path: PREFIX,
      credentials: credentialsStub({}),
      messages: PT_BR_MESSAGES,
      resolveUserId: () => null,
    });

    expect(typeof handlers.GET).toBe("function");
    expect(typeof handlers.POST).toBe("function");
    expect(typeof handlers.PUT).toBe("function");
  });
});

describe("mountEmailAuthSettings", () => {
  const SETTINGS_PREFIX = "/api/platform/auth-settings";

  function settingsStore() {
    return {
      read: vi.fn(async () => ({
        settings: { enabled: true, requireEmailVerification: false },
        audit: [],
      })),
      write: vi.fn(async () => undefined),
    };
  }

  it("lets the host's gate answer 403 before the router sees the request", async () => {
    // The property `resolveUserId` cannot express: it answers `string | null`,
    // and `null` is 401 for every refusal. A signed-in operator who is simply
    // not a superadmin is a 403, and bouncing them to a sign-in they are
    // already past is the bug this seam exists to prevent.
    const store = settingsStore();
    const { GET } = mountEmailAuthSettings<{ operator: string }>({
      path: SETTINGS_PREFIX,
      before: async () => Response.json({ error: "forbidden" }, { status: 403 }),
      resolveUserId: (c) => c.get("operator") ?? null,
      store,
    });

    const response = await GET(new Request(`http://host${SETTINGS_PREFIX}`));

    expect(response.status).toBe(403);
    expect(store.read).not.toHaveBeenCalled();
  });

  it("carries the acting operator from the gate to the store", async () => {
    // Per-REQUEST, through Hono's context. A module-level box would be shared
    // by every concurrent request, which is how one operator's e-mail ends up
    // stamped on another's change.
    const store = settingsStore();
    const { PUT } = mountEmailAuthSettings<{ operator: string }>({
      path: SETTINGS_PREFIX,
      before: async (c, next) => {
        c.set("operator", "ops@example.test");
        await next();
      },
      resolveUserId: (c) => c.get("operator") ?? null,
      store,
    });

    await PUT(
      new Request(`http://host${SETTINGS_PREFIX}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      }),
    );

    expect(store.write).toHaveBeenCalledWith({ enabled: false }, "ops@example.test");
  });
});
