/* eslint-disable test-flakiness/no-test-isolation --
   the rule flags every method call on `host` / `flow` / `settings`, which it
   reads as mutating shared state. They are not shared: `beforeEach` rebuilds
   all three from scratch, so each case gets its own in-memory store, its own
   mailer and its own settings object, and no case can observe another's
   writes. The rule's own remedy — "initialize in beforeEach" — is exactly what
   this file does; it fires on the CALLS regardless, because a flow whose whole
   job is to write to a store cannot be exercised without calling it. */
import { beforeEach, describe, expect, it } from "vitest";

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
/** A fixed moment; these tests only need "already verified, at some point". */
const VERIFIED_AT = new Date("2026-01-01T00:00:00.000Z");

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

/** Pull the token out of the last link of a kind, as a recipient's click would. */
function tokenFromLink(host: FakeHost, kind: Parameters<FakeHost["lastEmail"]>[0]): string {
  const message = host.lastEmail(kind);
  if (!message?.link) throw new Error(`no ${kind} email was sent`);
  return new URL(message.link).searchParams.get("token") ?? "";
}

describe("signUp", () => {
  it("creates an unverified account and mails it a verification link", async () => {
    const result = await flow.signUp({ email: "Ana@Example.com ", password: GOOD_PASSWORD });

    expect(result).toEqual({ ok: true, status: "verification-sent" });
    const user = await host.findByEmail("ana@example.com");
    expect(user).toBeTruthy();
    expect(user?.emailVerifiedAt).toBeNull();
    expect(host.lastEmail("verification")?.to).toBe("ana@example.com");
    expect(host.lastEmail("verification")?.link).toContain(`${APP_URL}/verify-email?token=`);
  });

  it("refuses, and creates NOTHING, when the deployment cannot send the link", async () => {
    // The failure this replaces: the mailer's unconfigured driver accepts the
    // call, logs, and delivers nothing — so sign-up succeeded, the screen said
    // "confira seu e-mail", and the account sat unverifiable forever because
    // the only way to verify it was never sent.
    host.deliverable = false;

    const result = await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });

    expect(result).toEqual({ ok: false, reason: "verification-unavailable" });
    // The account is the part that matters: a created-but-unverifiable user
    // also blocks the address from being registered again once mail is fixed.
    expect(await host.findByEmail("ana@example.com")).toBeFalsy();
    expect(host.lastEmail("verification")).toBeUndefined();
  });

  it("still signs up with mail down when verification is not required", async () => {
    // Delivery is only load-bearing when a link is the ONLY way in. With
    // verification off the credentials work immediately, so refusing here
    // would take sign-up down over a mail path nothing was going to use.
    host.deliverable = false;
    settings.requireEmailVerification = false;

    const result = await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });

    expect(result.ok).toBe(true);
    expect(await host.findByEmail("ana@example.com")).toBeTruthy();
  });

  it("stores a hash, never the password", async () => {
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    const user = await host.findByEmail("ana@example.com");
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toContain(GOOD_PASSWORD);
    await expect(verifyPassword(GOOD_PASSWORD, user?.passwordHash)).resolves.toBe(true);
  });

  it("answers a TAKEN address exactly as it answers a free one", async () => {
    host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });

    const taken = await flow.signUp({ email: "ana@example.com", password: "outra senha 7" });
    const free = await flow.signUp({ email: "bia@example.com", password: "outra senha 7" });

    // Byte-identical. This is the anti-enumeration property; if these ever
    // differ, sign-up has become a directory of who banks here.
    expect(taken).toEqual(free);
    expect(taken).toEqual({ ok: true, status: "verification-sent" });
  });

  it("tells the ADDRESS ITSELF that somebody tried, with a way back in", async () => {
    host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });

    await flow.signUp({ email: "ana@example.com", password: "outra senha 7" });

    expect(host.lastEmail("verification")).toBeUndefined();
    expect(host.lastEmail("account-exists")?.link).toContain("/reset-password?token=");
  });

  it("never overwrites the existing password of a taken address", async () => {
    const original = await hashPassword(GOOD_PASSWORD);
    host.withUser({ email: "ana@example.com", passwordHash: original });

    await flow.signUp({ email: "ana@example.com", password: "hijack me 11" });

    expect((await host.findByEmail("ana@example.com"))?.passwordHash).toBe(original);
  });

  it("signs in immediately, and CAN refuse a taken address, when verification is off", async () => {
    settings.requireEmailVerification = false;

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
    const result = await flow.signUp({ email: "ana@example.com", password: "abc" });
    expect(result).toEqual({
      ok: false,
      reason: "weak-password",
      violations: ["too-short", "needs-number"],
    });
    expect(host.users.size).toBe(0);
  });

  it("refuses something that is not an address", async () => {
    await expect(flow.signUp({ email: "ana", password: GOOD_PASSWORD })).resolves.toEqual({
      ok: false,
      reason: "invalid-email",
    });
  });

  it("refuses everything while the method is switched off", async () => {
    settings.enabled = false;
    await expect(
      flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "method-disabled" });
    expect(host.users.size).toBe(0);
  });

  it("obeys a switch flipped after it was built", async () => {
    settings.enabled = false;
    await expect(
      flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD }),
    ).resolves.toEqual({ ok: false, reason: "method-disabled" });
  });
});

describe("verifyEmail", () => {
  it("marks the address verified when the link is spent", async () => {
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });

    await expect(flow.verifyEmail(tokenFromLink(host, "verification"))).resolves.toEqual({
      ok: true,
    });
    expect((await host.findByEmail("ana@example.com"))?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("works exactly once", async () => {
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    const token = tokenFromLink(host, "verification");

    await expect(flow.verifyEmail(token)).resolves.toEqual({ ok: true });
    await expect(flow.verifyEmail(token)).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });

  it("lets exactly one of two simultaneous clicks win", async () => {
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    const token = tokenFromLink(host, "verification");

    const results = await Promise.all([flow.verifyEmail(token), flow.verifyEmail(token)]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });

  it("refuses an unknown token", async () => {
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
    host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });
    await flow.requestPasswordReset("ana@example.com");

    await expect(flow.verifyEmail(tokenFromLink(host, "reset-link"))).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });
});

describe("resendVerification", () => {
  it("sends again for an unverified account", async () => {
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });

    await expect(flow.resendVerification("ana@example.com")).resolves.toEqual({ ok: true });
    expect(host.sent.filter((message) => message.kind === "verification")).toHaveLength(2);
  });

  it("acknowledges an unknown address without sending anything", async () => {
    await expect(flow.resendVerification("nobody@example.com")).resolves.toEqual({ ok: true });
    expect(host.sent).toHaveLength(0);
  });

  it("refuses rather than acknowledging when it cannot send", async () => {
    // The uniform `{ ok: true }` above exists to hide whether an address is
    // registered. It must not also hide that the resend is impossible for
    // everybody — that turns "peça um novo link" into a button that reports
    // success and does nothing, forever.
    await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD });
    host.sent.length = 0;
    host.deliverable = false;

    await expect(flow.resendVerification("ana@example.com")).resolves.toEqual({
      ok: false,
      reason: "verification-unavailable",
    });
    expect(host.sent).toHaveLength(0);
  });

  it("sends nothing to an already-verified account", async () => {
    host.withUser({
      email: "ana@example.com",
      passwordHash: await hashPassword(GOOD_PASSWORD),
      emailVerifiedAt: VERIFIED_AT,
    });
    await expect(flow.resendVerification("ana@example.com")).resolves.toEqual({ ok: true });
    expect(host.sent).toHaveLength(0);
  });
});
