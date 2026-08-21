import { describe, expect, it } from "vitest";

import type { EmailDriver, EmailMessage } from "@12-apps/notifications/server";

import type { AuthEmailMessage } from "../../email-credentials/types";
import { PT_BR_MAIL } from "../../server/mail-templates.pt-BR";
import { createAuthMailer } from "../index";

/**
 * The adapter between the two packages that already own a half each:
 * `@12-apps/auth` renders, `@12-apps/notifications` delivers.
 *
 * What is worth testing is exactly the seam — that a rendered auth mail reaches
 * the driver in the shape `EmailDriver` declares, and that the address it goes
 * to is the recipient's rather than anything else in scope.
 */

/** A driver that keeps what it was handed. The vendor seam, stood still. */
function recordingDriver(): EmailDriver & { sent: { to: string; message: EmailMessage }[] } {
  const sent: { to: string; message: EmailMessage }[] = [];
  return {
    sent,
    send: (to, message) => {
      sent.push({ to, message });
      return Promise.resolve();
    },
  };
}

const NOW = Date.parse("2026-08-19T12:00:00Z");

function message(overrides: Partial<AuthEmailMessage> = {}): AuthEmailMessage {
  return {
    to: "ana@example.test",
    name: "Ana",
    link: "https://loja.example.test/verify?token=abc",
    token: "abc",
    expiresAt: new Date(NOW + 24 * 3_600_000),
    ...overrides,
  };
}

describe("createAuthMailer", () => {
  it("delivers through the notifications driver rather than a mailer of its own", async () => {
    const driver = recordingDriver();
    const mailer = createAuthMailer({ driver, pack: PT_BR_MAIL, now: () => NOW });

    await mailer.sendVerification(message());

    expect(driver.sent).toHaveLength(1);
    expect(driver.sent[0]?.to).toBe("ana@example.test");
    // `EmailMessage` is exactly these three keys — the shape the transport,
    // its Resend driver and its log driver all already speak.
    expect(Object.keys(driver.sent[0]?.message ?? {}).sort()).toEqual([
      "html",
      "subject",
      "text",
    ]);
  });

  it("sends each of the four with its own subject, so an inbox can tell them apart", async () => {
    const driver = recordingDriver();
    const mailer = createAuthMailer({ driver, pack: PT_BR_MAIL, now: () => NOW });

    await mailer.sendVerification(message());
    await mailer.sendPasswordReset(message());
    await mailer.sendAccountExists(message());
    await mailer.sendPasswordChanged?.({ to: "ana@example.test", name: "Ana" });

    expect(driver.sent.map((entry) => entry.message.subject)).toEqual([
      PT_BR_MAIL.verification.subject,
      PT_BR_MAIL.passwordReset.subject,
      PT_BR_MAIL.alreadyRegistered.subject,
      PT_BR_MAIL.passwordChanged.subject,
    ]);
  });

  it("puts the login URL in the password-changed notice, which carries no token", async () => {
    const driver = recordingDriver();
    const mailer = createAuthMailer({
      pack: PT_BR_MAIL,
      driver,
      now: () => NOW,
      loginUrl: "https://loja.example.test/entrar",
    });

    await mailer.sendPasswordChanged?.({ to: "ana@example.test", name: "Ana" });

    // The whole point of the notice is that somebody who did NOT change their
    // password can act on it, so its one link has to go somewhere.
    expect(driver.sent[0]?.message.text).toContain("https://loja.example.test/entrar");
  });

  it("takes a different pack without touching the layout", async () => {
    const driver = recordingDriver();
    const mailer = createAuthMailer({
      driver,
      now: () => NOW,
      pack: { ...PT_BR_MAIL, verification: { ...PT_BR_MAIL.verification, subject: "Confirm your e-mail" } },
    });

    await mailer.sendVerification(message());

    expect(driver.sent[0]?.message.subject).toBe("Confirm your e-mail");
    // Still the package's skeleton: the words moved, the link did not.
    expect(driver.sent[0]?.message.html).toContain("https://loja.example.test/verify?token=abc");
  });

  it("words the lifetime from the token's own expiry, not from a constant", async () => {
    const driver = recordingDriver();
    const mailer = createAuthMailer({ driver, pack: PT_BR_MAIL, now: () => NOW });

    await mailer.sendPasswordReset(message({ expiresAt: new Date(NOW + 3_600_000) }));

    // A reset link lasts an hour and a verification link a day; a mail that
    // said the wrong one would send people back for a second link they did not
    // need, or let them trust one that had already died.
    expect(driver.sent[0]?.message.text).toContain("1 hora");
  });
});
