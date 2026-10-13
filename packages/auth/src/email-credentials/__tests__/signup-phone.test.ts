/* eslint-disable test-flakiness/no-test-isolation --
   the rule flags every method call on `host` / `flow`, which it reads as
   mutating shared state. They are not shared: `wire()` builds both from
   scratch inside each case, the same posture `email-credentials.test.ts`
   argues for its `beforeEach`. */
import { describe, expect, it, vi } from "vitest";

import { emailAuthRoutes, type EmailAuthRoute } from "../../server/email-routes";
import { PT_BR_MESSAGES } from "../../server/pt-BR";
import { createEmailCredentials, type EmailCredentials } from "../index";
import type { EmailAuthSettings } from "../types";
import { FakeHost } from "./fake-host";

/**
 * A phone asked for on the sign-up form reaches the host's store — and only
 * when the sign-up CREATES the account.
 *
 * The case worth guarding is the taken address. Sign-up answers it exactly as
 * a free one and writes nothing; a phone written there would let anybody set
 * the owner's number by "signing up" with their e-mail.
 */

const GOOD_PASSWORD = "uma senha boa 42";
const VERIFIED_AT = new Date("2026-01-01T00:00:00.000Z");

function wire(requireEmailVerification: boolean): { host: FakeHost; flow: EmailCredentials } {
  const host = new FakeHost();
  const settings: EmailAuthSettings = { enabled: true, requireEmailVerification };
  const flow = createEmailCredentials({
    store: host,
    mailer: host,
    settings: () => settings,
    appUrl: "https://app.example.com",
  });
  return { host, flow };
}

async function phoneOf(host: FakeHost, email: string): Promise<string | null | undefined> {
  const user = await host.findByEmail(email);
  return user ? host.phones.get(user.id) : undefined;
}

describe("a phone on sign-up", () => {
  it("is handed to the store with a new, unverified account", async () => {
    const { host, flow } = wire(true);
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD, phone: "(31) 99876-5432" });
    expect(await phoneOf(host, "ana@example.com")).toBe("(31) 99876-5432");
  });

  it("is handed to the store when verification is off, too", async () => {
    const { host, flow } = wire(false);
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD, phone: "(31) 99876-5432" });
    expect(await phoneOf(host, "ana@example.com")).toBe("(31) 99876-5432");
  });

  it("is never written over a taken address", async () => {
    const { host, flow } = wire(true);
    const owner = host.withUser({ email: "ana@example.com", passwordHash: "x", emailVerifiedAt: VERIFIED_AT });
    const createUser = vi.spyOn(host, "createUser");

    const result = await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD, phone: "(11) 91111-1111" });

    expect(result.ok).toBe(true);
    expect(createUser).not.toHaveBeenCalled();
    expect(host.phones.has(owner.id)).toBe(false);
  });

  it("is never written over a taken address with verification off, either", async () => {
    const { host, flow } = wire(false);
    host.withUser({ email: "ana@example.com", passwordHash: "x", emailVerifiedAt: VERIFIED_AT });
    const createUser = vi.spyOn(host, "createUser");

    const result = await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD, phone: "(11) 91111-1111" });

    expect(result).toMatchObject({ ok: false, reason: "email-taken" });
    expect(createUser).not.toHaveBeenCalled();
  });

  it("leaves the store's phone empty when the form asked for none", async () => {
    const { host, flow } = wire(true);
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    expect(await phoneOf(host, "ana@example.com")).toBeNull();
  });
});

function signupRoute(signUp: EmailCredentials["signUp"]): EmailAuthRoute {
  const credentials = { signUp } as EmailCredentials;
  const found = emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES }).find(
    (entry) => entry.method === "POST" && entry.path === "/signup",
  );
  if (!found) throw new Error("no POST /signup");
  return found;
}

describe("POST /signup and the phone", () => {
  it("passes the phone from the body to the flow, trimmed", async () => {
    const signUp = vi.fn().mockResolvedValue({ ok: true, status: "verification-sent", binding: "b" });
    await signupRoute(signUp).handle({
      body: { email: "a@b.co", password: GOOD_PASSWORD, phone: " (31) 99876-5432 " },
      userId: null,
    });
    expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ phone: "(31) 99876-5432" }));
  });

  it("passes no phone when the body carries none, or a blank one", async () => {
    const signUp = vi.fn().mockResolvedValue({ ok: true, status: "verification-sent", binding: "b" });
    await signupRoute(signUp).handle({ body: { email: "a@b.co", password: GOOD_PASSWORD, phone: "  " }, userId: null });
    expect(signUp.mock.calls[0]?.[0]?.phone).toBeUndefined();
  });
});
