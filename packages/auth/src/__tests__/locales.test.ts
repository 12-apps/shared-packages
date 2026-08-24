import { assertLocaleParity } from "@12-apps/i18n/testing";
import { describe, expect, it } from "vitest";

import {
  AUTH_ACCESS,
  AUTH_ERRORS,
  AUTH_MAIL,
  AUTH_MESSAGES,
  AUTH_PAGES,
  AUTH_SCREENS,
  AUTH_SETTINGS,
} from "../locales";

/**
 * `tsc` already refuses a MISSING key. This covers the three drifts it cannot
 * see, and the four properties on this surface that a translation could break
 * without breaking a type — all four of them security properties rather than
 * wording.
 *
 * `@12-apps/i18n` is a devDependency and this file never ships.
 */
describe("the locale packs", () => {
  it("speak both languages the same way", () => {
    assertLocaleParity("AUTH_MESSAGES", AUTH_MESSAGES);
    assertLocaleParity("AUTH_MAIL", AUTH_MAIL);
    assertLocaleParity("AUTH_SCREENS", AUTH_SCREENS);
    assertLocaleParity("AUTH_ACCESS", AUTH_ACCESS);
    assertLocaleParity("AUTH_SETTINGS", AUTH_SETTINGS);
    assertLocaleParity("AUTH_PAGES", AUTH_PAGES);
    assertLocaleParity("AUTH_ERRORS", AUTH_ERRORS);
  });

  it("keeps a wrong address and a wrong password one answer", () => {
    // Splitting them tells a prober which half was right.
    for (const messages of Object.values(AUTH_MESSAGES)) {
      expect(messages["invalid-credentials"]).toBeTruthy();
    }
    for (const copy of Object.values(AUTH_SCREENS)) {
      expect(copy.failures["invalid-credentials"]).toBeTruthy();
    }
  });

  it("keeps the forgotten-password answer conditional", () => {
    // "If an account exists…" is what stops reset from enumerating users. An
    // honest "we could not find that address" would let anyone check who has
    // an account here, so the conditional has to survive translation.
    for (const copy of Object.values(AUTH_SCREENS)) {
      const sent = copy.forgotPassword.sentDescription("a@b.test");
      expect(sent).toContain("a@b.test");
      expect(sent.length).toBeGreaterThan(40);
    }
  });

  it("says nothing about the deployment when verification is unavailable", () => {
    // A visitor cannot act on a missing provider, and naming a deployment's
    // absent credentials on a public sign-up screen tells an attacker which
    // box is half-built.
    for (const pack of [AUTH_MESSAGES, AUTH_SCREENS]) {
      for (const copy of Object.values(pack)) {
        const sentence =
          "verification-unavailable" in copy
            ? copy["verification-unavailable"]
            : copy.failures["verification-unavailable"];
        expect(sentence).not.toMatch(/SMTP|provider|provedor|credential|credencial/i);
      }
    }
  });

  it("points the already-registered mail at what its button actually does", () => {
    // The link is a RESET link, not a sign-in one. Calling it "Sign in" would
    // send somebody to a choose-a-new-password form expecting a sign-in.
    for (const mail of Object.values(AUTH_MAIL)) {
      expect(mail.alreadyRegistered.cta).not.toBe(mail.passwordChanged.cta);
      expect(mail.alreadyRegistered.lead({ validFor: mail.validFor(1) })).toContain(
        mail.validFor(1),
      );
    }
  });

  it("gives each language its own plural rule for a link lifetime", () => {
    for (const mail of Object.values(AUTH_MAIL)) {
      expect(mail.validFor(1)).not.toBe(mail.validFor(2));
      expect(mail.validFor(48)).not.toBe(mail.validFor(24));
    }
  });
});
