import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../../password";
import { createEmailCredentials, type EmailCredentials } from "../index";
import type { EmailAuthSettings } from "../types";
import { FakeHost } from "./fake-host";

/**
 * The flow's contract, exercised against an in-memory host.
 *
 * Several of these assert an ABSENCE — that a refusal says nothing about
 * whether an address is registered — and those are the ones to be most careful
 * about weakening. A test that asserts a distinguishable answer is asserting
 * the enumeration bug back into existence.
 */

const APP_URL = "https://app.example.com";
const GOOD_PASSWORD = "uma senha boa 42";

function setup(overrides: Partial<EmailAuthSettings> = {}): {
  host: FakeHost;
  flow: EmailCredentials;
  settings: EmailAuthSettings;
} {
  const host = new FakeHost();
  // A mutable object, not a snapshot: a superadmin flips these mid-session and
  // the next call must obey, which is the behaviour the settings port exists for.
  const settings: EmailAuthSettings = {
    enabled: true,
    requireEmailVerification: true,
    ...overrides,
  };
  const flow = createEmailCredentials({
    store: host,
    mailer: host,
    settings: () => settings,
    appUrl: APP_URL,
  });
  return { host, flow, settings };
}

/** Pull the token out of the last link of a kind, as a recipient's click would. */
function tokenFromLink(host: FakeHost, kind: Parameters<FakeHost["lastEmail"]>[0]): string {
  const message = host.lastEmail(kind);
  if (!message?.link) throw new Error(`no ${kind} email was sent`);
  return new URL(message.link).searchParams.get("token") ?? "";
}

describe("signUp", () => {
  it("creates an unverified account and mails it a verification link", async () => {
    const { host, flow } = setup();
    const result = await flow.signUp({ email: "Ana@Example.com ", password: GOOD_PASSWORD });

    expect(result).toEqual({ ok: true, status: "verification-sent" });
    const user = await host.findByEmail("ana@example.com");
    expect(user).toBeTruthy();
    expect(user?.emailVerifiedAt).toBeNull();
    expect(host.lastEmail("verification")?.to).toBe("ana@example.com");
    expect(host.lastEmail("verification")?.link).toContain(`${APP_URL}/verify-email?token=`);
  });

  it("stores a hash, never the password", async () => {
    const { host, flow } = setup();
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    const user = await host.findByEmail("ana@example.com");
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toContain(GOOD_PASSWORD);
    await expect(verifyPassword(GOOD_PASSWORD, user?.passwordHash)).resolves.toBe(true);
  });

  it("answers a TAKEN address exactly as it answers a free one", async () => {
    const { host, flow } = setup();
    host.seed({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });

    const taken = await flow.signUp({ email: "ana@example.com", password: "outra senha 7" });
    const free = await flow.signUp({ email: "bia@example.com", password: "outra senha 7" });

    // Byte-identical. This is the anti-enumeration property; if these ever
    // differ, sign-up has become a directory of who banks here.
    expect(taken).toEqual(free);
    expect(taken).toEqual({ ok: true, status: "verification-sent" });
  });

  it("tells the ADDRESS ITSELF that somebody tried, with a way back in", async () => {
    const { host, flow } = setup();
    host.seed({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });

    await flow.signUp({ email: "ana@example.com", password: "outra senha 7" });

    expect(host.lastEmail("verification")).toBeUndefined();
    expect(host.lastEmail("account-exists")?.link).toContain("/reset-password?token=");
  });

  it("never overwrites the existing password of a taken address", async () => {
    const { host, flow } = setup();
    const original = await hashPassword(GOOD_PASSWORD);
    host.seed({ email: "ana@example.com", passwordHash: original });

    await flow.signUp({ email: "ana@example.com", password: "hijack me 11" });

    expect((await host.findByEmail("ana@example.com"))?.passwordHash).toBe(original);
  });

  it("signs in immediately, and CAN refuse a taken address, when verification is off", async () => {
    const { host, flow } = setup({ requireEmailVerification: false });

    const created = await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    expect(created).toMatchObject({ ok: true, status: "signed-up" });
    expect((await host.findByEmail("ana@example.com"))?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(host.sent).toHaveLength(0);

    // The deployment traded anti-enumeration for the shorter funnel — see
    // `requireEmailVerification`. Saying so is the whole point of the branch.
    await expect(
      flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "email-taken" });
  });

  it("refuses a weak password and names the rules it broke", async () => {
    const { host, flow } = setup();
    const result = await flow.signUp({ email: "ana@example.com", password: "abc" });
    expect(result).toEqual({
      ok: false,
      reason: "weak-password",
      violations: ["too-short", "needs-number"],
    });
    expect(host.users.size).toBe(0);
  });

  it("refuses something that is not an address", async () => {
    const { flow } = setup();
    await expect(flow.signUp({ email: "ana", password: GOOD_PASSWORD })).resolves.toEqual({
      ok: false,
      reason: "invalid-email",
    });
  });

  it("refuses everything while the method is switched off", async () => {
    const { host, flow } = setup({ enabled: false });
    await expect(
      flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "method-disabled" });
    expect(host.users.size).toBe(0);
  });

  it("obeys a switch flipped after it was built", async () => {
    const { flow, settings } = setup();
    settings.enabled = false;
    await expect(
      flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "method-disabled" });
  });
});

describe("verifyEmail", () => {
  it("marks the address verified when the link is spent", async () => {
    const { host, flow } = setup();
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });

    await expect(flow.verifyEmail(tokenFromLink(host, "verification"))).resolves.toEqual({
      ok: true,
    });
    expect((await host.findByEmail("ana@example.com"))?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("works exactly once", async () => {
    const { host, flow } = setup();
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    const token = tokenFromLink(host, "verification");

    await expect(flow.verifyEmail(token)).resolves.toEqual({ ok: true });
    await expect(flow.verifyEmail(token)).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });

  it("lets exactly one of two simultaneous clicks win", async () => {
    const { host, flow } = setup();
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    const token = tokenFromLink(host, "verification");

    const results = await Promise.all([flow.verifyEmail(token), flow.verifyEmail(token)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("refuses an unknown token", async () => {
    const { flow } = setup();
    await expect(flow.verifyEmail("not-a-real-token")).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });

  it("refuses an expired token", async () => {
    const host = new FakeHost();
    const clock = { now: new Date("2026-01-01T00:00:00.000Z") };
    const flow = createEmailCredentials({
      store: host,
      mailer: host,
      settings: { enabled: true, requireEmailVerification: true },
      appUrl: APP_URL,
      now: () => clock.now,
    });
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    const token = tokenFromLink(host, "verification");

    clock.now = new Date("2026-01-03T00:00:00.000Z");
    await expect(flow.verifyEmail(token)).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });

  it("will not accept a RESET token — the two purposes do not share a namespace", async () => {
    const { host, flow } = setup();
    host.seed({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });
    await flow.requestPasswordReset("ana@example.com");

    await expect(flow.verifyEmail(tokenFromLink(host, "password-reset"))).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });
});

describe("resendVerification", () => {
  it("sends again for an unverified account", async () => {
    const { host, flow } = setup();
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });

    await expect(flow.resendVerification("ana@example.com")).resolves.toEqual({ ok: true });
    expect(host.sent.filter((message) => message.kind === "verification")).toHaveLength(2);
  });

  it("acknowledges an unknown address without sending anything", async () => {
    const { host, flow } = setup();
    await expect(flow.resendVerification("nobody@example.com")).resolves.toEqual({ ok: true });
    expect(host.sent).toHaveLength(0);
  });

  it("sends nothing to an already-verified account", async () => {
    const { host, flow } = setup();
    host.seed({
      email: "ana@example.com",
      passwordHash: await hashPassword(GOOD_PASSWORD),
      emailVerifiedAt: new Date(),
    });
    await expect(flow.resendVerification("ana@example.com")).resolves.toEqual({ ok: true });
    expect(host.sent).toHaveLength(0);
  });
});
