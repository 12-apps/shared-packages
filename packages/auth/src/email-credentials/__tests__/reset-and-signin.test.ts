/* eslint-disable test-flakiness/no-test-isolation --
   the rule flags every method call on `host` / `flow` / `settings`, which it
   reads as mutating shared state. They are not shared: `beforeEach` rebuilds
   all three from scratch, so each case gets its own in-memory store, its own
   mailer and its own settings object, and no case can observe another's
   writes. The rule's own remedy — "initialize in beforeEach" — is exactly what
   this file does; it fires on the CALLS regardless, because a flow whose whole
   job is to write to a store cannot be exercised without calling it. */
import { randomBytes, scryptSync } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "../../password";
import { createEmailCredentials, type EmailCredentials } from "../index";
import type { EmailAuthSettings } from "../types";
import { FakeHost } from "./fake-host";

/**
 * Forgetting a password, resetting one, and the case this feature was asked
 * for: an account that exists only because somebody clicked "Continue with
 * Google" and now wants a password as well.
 */

const APP_URL = "https://app.example.com";
const GOOD_PASSWORD = "uma senha boa 42";
/** A fixed moment; these tests only need "already verified, at some point". */
const VERIFIED_AT = new Date("2026-01-01T00:00:00.000Z");
const NEW_PASSWORD = "outra senha boa 77";

/**
 * A fresh host and flow per test, wired in `beforeEach`.
 *
 * `settings` is a MUTABLE object the flow reads through a getter, not a
 * snapshot — a superadmin flips these mid-session and the next call must obey,
 * which is the behaviour the settings port exists for. A test that wants the
 * other posture assigns to it directly, which is also how the real thing
 * changes.
 */
let host: FakeHost;
let flow: EmailCredentials;
let settings: EmailAuthSettings;

beforeEach(() => {
  host = new FakeHost();
  settings = { enabled: true, requireEmailVerification: true };
  flow = createEmailCredentials({
    store: host,
    mailer: host,
    settings: () => settings,
    appUrl: APP_URL,
  });
});

/**
 * A hash genuinely derived at an older cost, in the stored format.
 *
 * This is what a row written years ago looks like, and it is the only way to
 * exercise the silent upgrade — `hashPassword` can only produce the current
 * parameters, by design.
 */
function legacyHash(password: string, cost: number): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, 64, { N: cost, r: 8, p: 1 });
  return ["scrypt", cost, 8, 1, salt.toString("base64"), derived.toString("base64")].join("$");
}

function tokenFromLink(host: FakeHost, kind: Parameters<FakeHost["lastEmail"]>[0]): string {
  const message = host.lastEmail(kind);
  if (!message?.link) throw new Error(`no ${kind} email was sent`);
  return new URL(message.link).searchParams.get("token") ?? "";
}

/** The account this whole feature is about: created by Google, no password. */
async function seedGoogleUser(host: FakeHost): Promise<string> {
  const user = host.withUser({
    email: "ana@example.com",
    name: "Ana",
    passwordHash: null,
    emailVerifiedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  return user.id;
}

describe("requestPasswordReset", () => {
  it("mails a reset link to an account that has one", async () => {
    host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });

    await expect(flow.requestPasswordReset("Ana@Example.com")).resolves.toEqual({ ok: true });
    expect(host.lastEmail("password-reset")?.link).toContain(`${APP_URL}/reset-password?token=`);
  });

  it("answers an UNKNOWN address exactly as a known one, and mails nothing", async () => {
    host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });

    const known = await flow.requestPasswordReset("ana@example.com");
    const unknown = await flow.requestPasswordReset("nobody@example.com");

    expect(known).toEqual(unknown);
    expect(host.sent.filter((message) => message.kind === "password-reset")).toHaveLength(1);
  });

  it("mails a Google-only account too — the link is how it gets its first password", async () => {
    await seedGoogleUser(host);

    await expect(flow.requestPasswordReset("ana@example.com")).resolves.toEqual({ ok: true });
    expect(host.lastEmail("password-reset")).toBeTruthy();
  });
});

describe("resetPassword", () => {
  it("sets the new password and lets the old one stop working", async () => {
    host.withUser({
      email: "ana@example.com",
      passwordHash: await hashPassword(GOOD_PASSWORD),
      emailVerifiedAt: VERIFIED_AT,
    });
    await flow.requestPasswordReset("ana@example.com");

    await expect(
      flow.resetPassword({ token: tokenFromLink(host, "password-reset"), password: NEW_PASSWORD }),
    ).resolves.toEqual({ ok: true });

    const user = await host.findByEmail("ana@example.com");
    await expect(verifyPassword(NEW_PASSWORD, user?.passwordHash)).resolves.toBe(true);
    await expect(verifyPassword(GOOD_PASSWORD, user?.passwordHash)).resolves.toBe(false);
  });

  it("verifies the address, because clicking the link proved it", async () => {
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    await flow.requestPasswordReset("ana@example.com");
    expect((await host.findByEmail("ana@example.com"))?.emailVerifiedAt).toBeNull();

    await flow.resetPassword({
      token: tokenFromLink(host, "password-reset"),
      password: NEW_PASSWORD,
    });

    // Without this the account is in a dead end: right password, still refused.
    expect((await host.findByEmail("ana@example.com"))?.emailVerifiedAt).toBeInstanceOf(Date);
    await expect(
      flow.authenticate({ email: "ana@example.com", password: NEW_PASSWORD }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("works exactly once, and kills every other outstanding link", async () => {
    host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });
    await flow.requestPasswordReset("ana@example.com");
    const first = tokenFromLink(host, "password-reset");
    await flow.requestPasswordReset("ana@example.com");
    const second = tokenFromLink(host, "password-reset");

    await expect(flow.resetPassword({ token: second, password: NEW_PASSWORD })).resolves.toEqual({
      ok: true,
    });
    await expect(flow.resetPassword({ token: second, password: NEW_PASSWORD })).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
    // Whoever asked for the first link is not necessarily whoever used the second.
    await expect(flow.resetPassword({ token: first, password: "mais uma senha 3" })).resolves.toEqual(
      { ok: false, reason: "token-invalid" },
    );
  });

  it("checks the policy before spending the token, so a weak try is retryable", async () => {
    host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });
    await flow.requestPasswordReset("ana@example.com");
    const token = tokenFromLink(host, "password-reset");

    await expect(flow.resetPassword({ token, password: "abc" })).resolves.toMatchObject({
      ok: false,
      reason: "weak-password",
    });
    await expect(flow.resetPassword({ token, password: NEW_PASSWORD })).resolves.toEqual({
      ok: true,
    });
  });

  it("refuses an unknown token", async () => {
    await expect(
      flow.resetPassword({ token: "nope", password: NEW_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "token-invalid" });
  });
});

describe("setPassword — the Google account that wants a password", () => {
  it("adds the first password with NO current password, because there is none", async () => {
    const userId = await seedGoogleUser(host);

    await expect(flow.setPassword({ userId, password: NEW_PASSWORD })).resolves.toEqual({
      ok: true,
    });

    await expect(
      flow.authenticate({ email: "ana@example.com", password: NEW_PASSWORD }),
    ).resolves.toMatchObject({ ok: true, user: { id: userId } });
  });

  it("reports which of the two screens to show", async () => {
    const userId = await seedGoogleUser(host);

    await expect(flow.hasPassword(userId)).resolves.toBe(false);
    await flow.setPassword({ userId, password: NEW_PASSWORD });
    await expect(flow.hasPassword(userId)).resolves.toBe(true);
  });

  it("demands the current password once one exists", async () => {
    const user = host.withUser({
      email: "ana@example.com",
      passwordHash: await hashPassword(GOOD_PASSWORD),
    });

    await expect(flow.setPassword({ userId: user.id, password: NEW_PASSWORD })).resolves.toEqual({
      ok: false,
      reason: "current-password-required",
    });
    await expect(
      flow.setPassword({ userId: user.id, password: NEW_PASSWORD, currentPassword: "wrong 11" }),
    ).resolves.toEqual({ ok: false, reason: "current-password-invalid" });
    await expect(
      flow.setPassword({
        userId: user.id,
        password: NEW_PASSWORD,
        currentPassword: GOOD_PASSWORD,
      }),
    ).resolves.toEqual({ ok: true });
  });

  it("does not un-verify an address the provider already vouched for", async () => {
    const userId = await seedGoogleUser(host);

    await flow.setPassword({ userId, password: NEW_PASSWORD });

    expect((await host.findById(userId))?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("invalidates outstanding reset links — somebody else may hold one", async () => {
    const user = host.withUser({
      email: "ana@example.com",
      passwordHash: await hashPassword(GOOD_PASSWORD),
    });
    await flow.requestPasswordReset("ana@example.com");
    const stolen = tokenFromLink(host, "password-reset");

    await flow.setPassword({
      userId: user.id,
      password: NEW_PASSWORD,
      currentPassword: GOOD_PASSWORD,
    });

    await expect(
      flow.resetPassword({ token: stolen, password: "atacante 99" }),
    ).resolves.toEqual({ ok: false, reason: "token-invalid" });
  });

  it("refuses for an unknown user", async () => {
    await expect(
      flow.setPassword({ userId: "ghost", password: NEW_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "no-account" });
  });
});

describe("authenticate", () => {
  it("accepts the right password for a verified account", async () => {
    const user = host.withUser({
      email: "ana@example.com",
      passwordHash: await hashPassword(GOOD_PASSWORD),
      emailVerifiedAt: VERIFIED_AT,
    });

    await expect(
      flow.authenticate({ email: " Ana@Example.com ", password: GOOD_PASSWORD }),
    ).resolves.toMatchObject({ ok: true, user: { id: user.id } });
  });

  it("gives the SAME refusal for an unknown address, a Google-only account and a wrong password", async () => {
    host.withUser({
      email: "ana@example.com",
      passwordHash: await hashPassword(GOOD_PASSWORD),
      emailVerifiedAt: VERIFIED_AT,
    });
    await seedGoogleUser(host);
    host.users.forEach((user) => {
      if (user.email === "ana@example.com" && !user.passwordHash) user.email = "gugu@example.com";
    });

    const unknown = await flow.authenticate({ email: "nobody@example.com", password: "x1234567" });
    const googleOnly = await flow.authenticate({ email: "gugu@example.com", password: "x1234567" });
    const wrong = await flow.authenticate({ email: "ana@example.com", password: "x1234567" });

    expect(unknown).toEqual({ ok: false, reason: "invalid-credentials" });
    expect(googleOnly).toEqual(unknown);
    expect(wrong).toEqual(unknown);
  });

  it("distinguishes an unverified address — but only after the password was right", async () => {
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });

    await expect(
      flow.authenticate({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "email-not-verified" });
    // The wrong password on the same unverified account says nothing about it.
    await expect(
      flow.authenticate({ email: "ana@example.com", password: "errada 12" }),
    ).resolves.toEqual({ ok: false, reason: "invalid-credentials" });
  });

  it("lets an unverified account in once the switch is off", async () => {
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });

    settings.requireEmailVerification = false;
    await expect(
      flow.authenticate({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("refuses while the method is switched off, right password or not", async () => {
    host.withUser({
      email: "ana@example.com",
      passwordHash: await hashPassword(GOOD_PASSWORD),
      emailVerifiedAt: VERIFIED_AT,
    });

    settings.enabled = false;
    await expect(
      flow.authenticate({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "method-disabled" });
  });

  it("silently re-hashes a password stored at a lower cost", async () => {
    // Derived at the OLD cost for real. Rewriting the cost field of a modern
    // hash would not do: the key was derived at 16384, so it simply would not
    // verify at 1024, and the test would pass for the wrong reason.
    const legacy = legacyHash(GOOD_PASSWORD, 1024);
    const user = host.withUser({
      email: "ana@example.com",
      passwordHash: legacy,
      emailVerifiedAt: VERIFIED_AT,
    });

    await expect(
      flow.authenticate({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toMatchObject({ ok: true });

    const stored = (await host.findById(user.id))?.passwordHash ?? "";
    expect(stored).not.toBe(legacy);
    expect(stored.split("$")[1]).toBe("16384");
    await expect(verifyPassword(GOOD_PASSWORD, stored)).resolves.toBe(true);
  });
});

describe("rate limiting", () => {
  it("refuses once the host's limiter says the caller is over budget", async () => {
    const host = new FakeHost();
    const seen: string[] = [];
    const flow = createEmailCredentials({
      store: host,
      mailer: host,
      settings: { enabled: true, requireEmailVerification: true },
      appUrl: APP_URL,
      rateLimiter: {
        check: async (key) => {
          seen.push(key);
          return seen.length <= 1;
        },
      },
    });

    await expect(flow.requestPasswordReset("ana@example.com")).resolves.toEqual({ ok: true });
    await expect(flow.requestPasswordReset("ana@example.com")).resolves.toEqual({
      ok: false,
      reason: "rate-limited",
    });
    // Keyed by operation AND address, so one person's resets cannot exhaust
    // another's sign-in budget.
    expect(seen).toEqual(["reset:ana@example.com", "reset:ana@example.com"]);
  });
});
