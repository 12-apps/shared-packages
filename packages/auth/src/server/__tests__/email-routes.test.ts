import { describe, expect, it, vi } from "vitest";

import type { EmailCredentials } from "../../email-credentials";
import { emailAuthRoutes, type EmailAuthRoute } from "../email-routes";
import { PT_BR_MESSAGES } from "../messages";

/**
 * The eight descriptors — the contract every host now mounts instead of writing.
 *
 * These assertions came WITH the code. They were eight `route.ts` files in one
 * host, each with its own test, and moving the handlers here without moving
 * the tests would have left the shared implementation less covered than the
 * copy it replaced. Every case below was earning its keep somewhere before.
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

function route(routes: EmailAuthRoute[], method: string, path: string): EmailAuthRoute {
  const found = routes.find((entry) => entry.method === method && entry.path === path);
  if (!found) throw new Error(`no ${method} ${path} among ${routes.length} routes`);
  return found;
}

describe("emailAuthRoutes", () => {
  describe("POST /signup", () => {
    it("answers a taken address exactly as a free one", async () => {
      // The anti-enumeration property, and the reason the flow reports
      // `verification-sent` for both. A "helpful" 409 on the taken branch would
      // quietly undo it and nothing else in the stack would notice.
      const credentials = credentialsStub({
        signUp: vi.fn().mockResolvedValue({ ok: true, status: "verification-sent" }),
      });
      const signup = route(emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES }), "POST", "/signup");

      const free = await signup.handle({ body: { email: "free@b.co", password: "uma senha boa 42" }, userId: null });
      const taken = await signup.handle({ body: { email: "taken@b.co", password: "uma senha boa 42" }, userId: null });

      // The 200 is asserted as well as the equality: two identical 500s are
      // also "the same answer", and that is not the property this is for.
      expect(free.status).toBe(200);
      expect(taken.status).toBe(200);
      expect(taken.body).toEqual(free.body);
    });

    it("drops `user` from the signed-up branch, so the two are not distinguishable by shape", async () => {
      const credentials = credentialsStub({
        signUp: vi.fn().mockResolvedValue({
          ok: true,
          status: "signed-up",
          user: { id: "u1", email: "a@b.co" },
        }),
      });
      const signup = route(emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES }), "POST", "/signup");

      const response = await signup.handle({ body: { email: "a@b.co", password: "uma senha boa 42" }, userId: null });

      expect(response.body).toEqual({ data: { status: "signed-up" } });
    });

    it("trims the display name, which is what every host's own schema did", async () => {
      const signUp = vi.fn().mockResolvedValue({ ok: true, status: "verification-sent" });
      const signup = route(
        emailAuthRoutes({ credentials: credentialsStub({ signUp }), messages: PT_BR_MESSAGES }),
        "POST",
        "/signup",
      );

      await signup.handle({ body: { email: "a@b.co", password: "uma senha boa 42", name: " Ana " }, userId: null });

      expect(signUp).toHaveBeenCalledWith({
        email: "a@b.co",
        password: "uma senha boa 42",
        name: "Ana",
      });
    });

    it("treats a whitespace-only name as no name at all", async () => {
      const signUp = vi.fn().mockResolvedValue({ ok: true, status: "verification-sent" });
      const signup = route(
        emailAuthRoutes({ credentials: credentialsStub({ signUp }), messages: PT_BR_MESSAGES }),
        "POST",
        "/signup",
      );

      await signup.handle({ body: { email: "a@b.co", password: "uma senha boa 42", name: "   " }, userId: null });

      expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ name: undefined }));
    });

    it("calls onSignedUp for BOTH branches, including the taken address", async () => {
      // Distinguishing them here would reintroduce, in timing and in side
      // effects, exactly the difference the response works to hide.
      const onSignedUp = vi.fn();
      const credentials = credentialsStub({
        signUp: vi.fn().mockResolvedValue({ ok: true, status: "verification-sent" }),
      });
      const signup = route(
        emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES, onSignedUp }),
        "POST",
        "/signup",
      );

      await signup.handle({ body: { email: "a@b.co", password: "uma senha boa 42", name: "Ana" }, userId: null });

      expect(onSignedUp).toHaveBeenCalledWith({ email: "a@b.co", name: "Ana" });
    });

    it("does not call onSignedUp when the sign-up was refused", async () => {
      const onSignedUp = vi.fn();
      const credentials = credentialsStub({
        signUp: vi.fn().mockResolvedValue({ ok: false, reason: "method-disabled" }),
      });
      const signup = route(
        emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES, onSignedUp }),
        "POST",
        "/signup",
      );

      const response = await signup.handle({ body: { email: "a@b.co", password: "x" }, userId: null });

      expect(response.status).toBe(403);
      expect(onSignedUp).not.toHaveBeenCalled();
    });
  });

  describe("refusals", () => {
    it("translates the broken password rules rather than sending their codes", async () => {
      // `checkPassword` answers in codes, which is what keeps the policy free
      // of any language. Sending them raw put `too-short` in front of a shopper.
      const credentials = credentialsStub({
        signUp: vi.fn().mockResolvedValue({
          ok: false,
          reason: "weak-password",
          violations: ["too-short", "needs-number"],
        }),
      });
      const signup = route(emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES }), "POST", "/signup");

      const response = await signup.handle({ body: { email: "a@b.co", password: "abc" }, userId: null });

      expect(response.status).toBe(400);
      expect(response.body).toMatchObject({
        reason: "weak-password",
        violations: [
          PT_BR_MESSAGES.violations["too-short"],
          PT_BR_MESSAGES.violations["needs-number"],
        ],
      });
    });

    it("passes an unrecognised violation code through rather than dropping it", async () => {
      // A policy this package gains a rule for, reaching a host whose pack was
      // written before it. Showing the code is poor; showing nothing is worse —
      // the person would be refused with no reason given at all.
      const credentials = credentialsStub({
        signUp: vi.fn().mockResolvedValue({ ok: false, reason: "weak-password", violations: ["from-the-future"] }),
      });
      const signup = route(emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES }), "POST", "/signup");

      const response = await signup.handle({ body: { email: "a@b.co", password: "abc" }, userId: null });

      expect(response.body).toMatchObject({ violations: ["from-the-future"] });
    });

    it("keeps `reason` a code, because the screen branches on it", async () => {
      const credentials = credentialsStub({
        verifyEmail: vi.fn().mockResolvedValue({ ok: false, reason: "token-invalid" }),
      });
      const verify = route(emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES }), "POST", "/verify");

      const response = await verify.handle({ body: { token: "spent" }, userId: null });

      expect(response.body).toMatchObject({ reason: "token-invalid" });
    });

    it("answers `no-account` with 200, so neither endpoint is a directory", async () => {
      const credentials = credentialsStub({
        requestPasswordReset: vi.fn().mockResolvedValue({ ok: false, reason: "no-account" }),
      });
      const forgot = route(emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES }), "POST", "/forgot-password");

      const response = await forgot.handle({ body: { email: "nobody@b.co" }, userId: null });

      expect(response.status).toBe(200);
    });

    it("answers a wrong CURRENT password with 403, not the 401 an SPA reads as a dead session", async () => {
      const credentials = credentialsStub({
        setPassword: vi.fn().mockResolvedValue({ ok: false, reason: "current-password-invalid" }),
      });
      const put = route(emailAuthRoutes({ credentials, messages: PT_BR_MESSAGES }), "PUT", "/password");

      const response = await put.handle({ body: { password: "nova senha 88", currentPassword: "errada" }, userId: "u1" });

      expect(response.status).toBe(403);
    });
  });

  describe("the session gate", () => {
    it("marks only the two account routes as needing one", () => {
      // `/settings` is public on purpose: the login screen reads it BEFORE
      // anyone is signed in, to decide whether to render the form at all.
      const routes = emailAuthRoutes({
        credentials: credentialsStub({}),
        messages: PT_BR_MESSAGES,
      });

      expect(
        routes.filter((entry) => entry.session).map((entry) => `${entry.method} ${entry.path}`).sort(),
      ).toEqual(["GET /password", "PUT /password"]);
    });
  });
});
