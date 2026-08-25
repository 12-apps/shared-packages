import { describe, expect, it } from "vitest";

import type { AuthEmailMessage } from "../../email-credentials/types";
import { AUTH_MAIL } from "../../locales";
import { renderAuthMail } from "../mail-templates";
import { EN_US_MAIL } from "../mail-templates.en-US";
import { PT_BR_MAIL } from "../mail-templates.pt-BR";

/**
 * The four auth e-mails: one layout, a pack of words per language.
 *
 * What is worth testing here is not the prose — that is product voice and
 * changes — but the two things a wrong e-mail costs a real person: a button
 * that does not do what it says, and an unescaped display name.
 */

const NOW = Date.parse("2026-08-19T12:00:00Z");

function message(overrides: Partial<AuthEmailMessage> = {}): AuthEmailMessage {
  return {
    to: "ana@example.test",
    name: "Ana",
    link: "https://loja.example.test/x?token=abc",
    token: "abc",
    expiresAt: new Date(NOW + 3_600_000),
    ...overrides,
  };
}

describe("renderAuthMail", () => {
  it("labels the already-registered button for the RESET page it opens", () => {
    /**
     * The regression this exists for.
     *
     * `signUp` sends this message with a PASSWORD_RESET link — see
     * `signup.ts`: the overwhelmingly common cause of somebody signing up
     * twice is a returning user who forgot they had an account, and the second
     * most common is one who forgot the password. The pack shipped with "Entrar"
     * on that button, which would have walked a person expecting a sign-in form
     * into a choose-a-new-password one.
     *
     * Asserted against the pack's own string rather than a literal, so
     * rewording stays free; what is pinned is that the button is NOT the
     * sign-in one.
     */
    const mail = renderAuthMail(PT_BR_MAIL, "alreadyRegistered", message(), NOW);

    expect(mail.html).toContain(PT_BR_MAIL.alreadyRegistered.cta);
    expect(mail.html).not.toContain(`>${PT_BR_MAIL.passwordChanged.cta}<`);
    // And it words the lifetime, because the link it carries does expire.
    expect(mail.text).toContain("1 hora");
  });

  it("escapes a display name, which is user input", () => {
    // A name is typed by whoever signed up, and it lands in an HTML body.
    const mail = renderAuthMail(
      PT_BR_MAIL,
      "verification",
      message({ name: '<script>alert("x")</script>' }),
      NOW,
    );

    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });

  it("ships a plain-text twin carrying the same link", () => {
    // Some clients show only this, and some people prefer it. A link that
    // existed solely in the HTML half would be invisible to both.
    const mail = renderAuthMail(PT_BR_MAIL, "passwordReset", message(), NOW);

    expect(mail.text).toContain("https://loja.example.test/x?token=abc");
    expect(mail.html).toContain("https://loja.example.test/x?token=abc");
  });

  it("words a lifetime from the token's own expiry", () => {
    // A reset link lasts an hour and a verification link a day. A mail that
    // said the wrong one sends people back for a link they did not need, or
    // lets them trust one that has already died.
    const day = renderAuthMail(
      PT_BR_MAIL,
      "verification",
      message({ expiresAt: new Date(NOW + 24 * 3_600_000) }),
      NOW,
    );

    expect(day.text).toContain("24 horas");
  });

  it("greets without a name when there is none", () => {
    const mail = renderAuthMail(PT_BR_MAIL, "verification", message({ name: null }), NOW);

    // "Olá," rather than "Olá, null," — the branch exists for social sign-ups
    // that never supplied one.
    expect(mail.text.startsWith("Olá,")).toBe(true);
    expect(mail.text).not.toContain("null");
  });
});

describe("renderAuthMail, when the pack is a resolver", () => {
  /**
   * A host whose recipients do not share one language hands a RESOLVER rather
   * than a pack, and each message is written for whoever receives it.
   *
   * The locale is the RECIPIENT's, off their own row — never the request's.
   * On `alreadyRegistered` and `passwordChanged` the caller may be an attacker,
   * and negotiating from their `Accept-Language` would let them pick the
   * language the victim is warned in.
   */
  const resolver = ({ locale }: { readonly locale?: string | null }) =>
    locale === "en-US" ? EN_US_MAIL : PT_BR_MAIL;

  it("writes each message in its own recipient's language", () => {
    const english = renderAuthMail(resolver, "verification", message({ locale: "en-US" }), NOW);
    const portuguese = renderAuthMail(resolver, "verification", message({ locale: "pt-BR" }), NOW);

    expect(english.subject).toBe(EN_US_MAIL.verification.subject);
    expect(portuguese.subject).toBe(PT_BR_MAIL.verification.subject);
    // The chrome follows too — the fallback hint lives on the pack, not the
    // message, so a half-resolved render would mix the two languages.
    expect(english.html).toContain(EN_US_MAIL.fallbackHint);
    expect(portuguese.html).toContain(PT_BR_MAIL.fallbackHint);
  });

  it("resolves per message rather than once", () => {
    /**
     * Rule B, and the only failure here a single-locale host could not see: a
     * `renderAuthMail` that resolved at import — or a mailer that resolved at
     * its mount and closed over the result — would answer both of these with
     * whichever language it happened to see first, and every existing test
     * would still pass.
     */
    const asked: Array<string | null | undefined> = [];
    const recording = ({ locale }: { readonly locale?: string | null }) => {
      asked.push(locale);
      return locale === "en-US" ? EN_US_MAIL : PT_BR_MAIL;
    };

    renderAuthMail(recording, "passwordReset", message({ locale: "pt-BR" }), NOW);
    renderAuthMail(recording, "passwordReset", message({ locale: "en-US" }), NOW);

    expect(asked).toEqual(["pt-BR", "en-US"]);
  });

  it("treats a recipient with no stored language as 'nobody said'", () => {
    // Absent is not an assertion of pt-BR — it is the resolver that decides,
    // in one place, rather than this module inventing a fallback.
    const seen: Array<string | null | undefined> = [];
    renderAuthMail(
      ({ locale }) => {
        seen.push(locale);
        return PT_BR_MAIL;
      },
      "verification",
      message({ locale: null }),
      NOW,
    );

    expect(seen).toEqual([undefined]);
  });

  it("still takes a plain pack, so a single-audience host changes nothing", () => {
    const mail = renderAuthMail(PT_BR_MAIL, "verification", message(), NOW);

    expect(mail.subject).toBe(PT_BR_MAIL.verification.subject);
  });

  it("pairs both languages under one tag-keyed pack", () => {
    // What a host actually hands `localeCopy` — proving the export exists in
    // the shape the adoption line assumes.
    expect(AUTH_MAIL["pt-BR"]).toBe(PT_BR_MAIL);
    expect(AUTH_MAIL["en-US"]).toBe(EN_US_MAIL);
  });
});
