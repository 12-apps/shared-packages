/* eslint-disable test-flakiness/no-test-isolation --
   as in `email-credentials.test.ts`: `beforeEach` rebuilds the host, the flow
   and the settings for every case, so the calls the rule flags never share
   state between cases. */
import { beforeEach, describe, expect, it } from "vitest";

import { hashPassword } from "../../password";
import { createEmailCredentials, type EmailCredentials } from "../index";
import { safeCallbackPath } from "../link-sign-in";
import type { EmailAuthSettings } from "../types";
import { FakeHost } from "./fake-host";

/**
 * The confirmation link that signs in — only in the browser that signed up
 * (FUT-3474).
 *
 * The cases that matter most are the refusals: a link opened anywhere else
 * must verify the address and open NO session, because sign-up lets a stranger
 * choose the password of an address they do not own.
 */

const APP_URL = "https://app.example.com";
const GOOD_PASSWORD = "uma senha boa 42";

let host: FakeHost;
let flow: EmailCredentials;
let settings: EmailAuthSettings;
let clock: { now: Date };

beforeEach(() => {
  host = new FakeHost();
  settings = { enabled: true, requireEmailVerification: true };
  clock = { now: new Date("2026-10-09T12:00:00.000Z") };
  flow = createEmailCredentials({
    store: host,
    mailer: host,
    settings: () => settings,
    appUrl: APP_URL,
    now: () => clock.now,
  });
});

/** The mailed verification link, as the recipient's click reads it. */
function mailedLink(): URL {
  const link = host.lastEmail("verification")?.link;
  if (!link) throw new Error("no verification email was sent");
  return new URL(link);
}

/** Sign up and return what the signing-up browser holds: its binding and the mailed token. */
async function signUpInBrowser(callbackUrl?: string): Promise<{ binding: string; token: string }> {
  const result = await flow.signUp({ email: "ana@example.com", password: GOOD_PASSWORD, callbackUrl });
  if (!result.ok || !result.binding) throw new Error("sign-up did not bind");
  return { binding: result.binding, token: mailedLink().searchParams.get("token") ?? "" };
}

describe("the confirmation link's destination", () => {
  it("carries a same-origin path as callbackUrl", async () => {
    await signUpInBrowser("/aliment-sabor/delivery?mesa=4");
    expect(mailedLink().searchParams.get("callbackUrl")).toBe("/aliment-sabor/delivery?mesa=4");
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "/\r\\evil.example",
    "lojas",
    "",
  ])(
    "drops %j",
    async (callbackUrl) => {
      await signUpInBrowser(callbackUrl);
      expect(mailedLink().searchParams.has("callbackUrl")).toBe(false);
    },
  );

  it("drops an over-long path rather than cutting it", () => {
    expect(safeCallbackPath(`/${"a".repeat(2048)}`)).toBeUndefined();
  });
});

describe("verifyEmail with a binding", () => {
  it("can sign in the browser that signed up", async () => {
    const { binding, token } = await signUpInBrowser();
    await expect(flow.verifyEmail(token, binding)).resolves.toEqual({
      ok: true,
      email: "ana@example.com",
      canSignIn: true,
    });
  });

  it("verifies, but cannot sign in, any other browser", async () => {
    const { token } = await signUpInBrowser();
    const other = await flow.signUp({ email: "bia@example.com", password: GOOD_PASSWORD });
    const otherBinding = other.ok ? other.binding : undefined;

    await expect(flow.verifyEmail(token, otherBinding)).resolves.toEqual({
      ok: true,
      email: "ana@example.com",
      canSignIn: false,
    });
    expect((await host.findByEmail("ana@example.com"))?.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it("still answers the bound browser after a scanner spent the link first", async () => {
    const { binding, token } = await signUpInBrowser();
    await flow.verifyEmail(token);

    await expect(flow.verifyEmail(token, binding)).resolves.toMatchObject({ ok: true, canSignIn: true });
    await expect(flow.verifyEmail(token)).resolves.toEqual({ ok: false, reason: "token-invalid" });
  });

  it("answers token-invalid once the link has expired, binding or not", async () => {
    const { binding, token } = await signUpInBrowser();
    clock.now = new Date(clock.now.getTime() + 25 * 60 * 60 * 1000);
    await expect(flow.verifyEmail(token, binding)).resolves.toEqual({ ok: false, reason: "token-invalid" });
  });
});

describe("signInWithLink", () => {
  it("opens a session once, in the bound browser, after verification", async () => {
    const { binding, token } = await signUpInBrowser();
    await flow.verifyEmail(token, binding);

    const first = await flow.signInWithLink(token, binding);
    expect(first).toMatchObject({ ok: true, user: { email: "ana@example.com" } });
    await expect(flow.signInWithLink(token, binding)).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });

  it("refuses before the address is verified", async () => {
    const { binding, token } = await signUpInBrowser();
    await expect(flow.signInWithLink(token, binding)).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });

  it("refuses the link without its binding, or with another browser's", async () => {
    const { token } = await signUpInBrowser();
    await flow.verifyEmail(token);
    const other = await flow.signUp({ email: "bia@example.com", password: GOOD_PASSWORD });

    await expect(flow.signInWithLink(token, undefined)).resolves.toEqual({ ok: false, reason: "token-invalid" });
    await expect(flow.signInWithLink(token, other.ok ? other.binding : "x")).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });

  it("refuses the binding without the link", async () => {
    const { binding, token } = await signUpInBrowser();
    await flow.verifyEmail(token, binding);
    await expect(flow.signInWithLink("not-the-link", binding)).resolves.toEqual({
      ok: false,
      reason: "token-invalid",
    });
  });

  it("refuses an expired grant", async () => {
    const { binding, token } = await signUpInBrowser();
    await flow.verifyEmail(token, binding);
    clock.now = new Date(clock.now.getTime() + 25 * 60 * 60 * 1000);
    await expect(flow.signInWithLink(token, binding)).resolves.toEqual({ ok: false, reason: "token-invalid" });
  });

  it("refuses while the method is switched off", async () => {
    const { binding, token } = await signUpInBrowser();
    await flow.verifyEmail(token, binding);
    settings.enabled = false;
    await expect(flow.signInWithLink(token, binding)).resolves.toEqual({
      ok: false,
      reason: "method-disabled",
    });
  });

  it("binds nothing on a taken address: no grant row, no session", async () => {
    host.withUser({ email: "ana@example.com", passwordHash: await hashPassword(GOOD_PASSWORD) });
    const taken = await flow.signUp({ email: "ana@example.com", password: "outra senha 7" });

    expect(taken).toMatchObject({ ok: true, status: "verification-sent" });
    expect(host.tokens.filter((row) => row.purpose === "SIGN_IN_GRANT")).toHaveLength(0);
  });
});
