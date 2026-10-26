import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EmailCredentials } from "../../email-credentials";
import { checkPasswordPolicy } from "../../password";
import { emailAuthRoutes } from "../../server/email-routes";
import { EN_US_MESSAGES } from "../../server/en-US";
import type { EmailAuthMessages } from "../../server/messages";
import { PT_BR_MESSAGES } from "../../server/pt-BR";
import { createEmailAuth, type EmailAuth } from "../create-email-auth";
import { createWebEmailAuth } from "../create-web-email-auth";
import { EN_US_PAGES } from "../pages/en-US";
import { PT_BR_PAGES } from "../pages/pt-BR";
import type { EmailAuthCopy } from "../screens/copy";
import { EN_US } from "../screens/en-US";
import { PT_BR } from "../screens/pt-BR";

/**
 * Every sentence that states the password rule agrees with the rule the server
 * enforces (FUT-2396).
 *
 * `abc12345` has eight characters, a letter and a number, so the old hint —
 * "at least 8 characters, a letter and a number" — promised it would be
 * accepted, and the server refused it as `too-common`. The sentences now name
 * that rule, and a refusal for it is one plain sentence.
 */

const PASSWORD = "abc12345";

interface Pack {
  name: string;
  copy: EmailAuthCopy;
  pages: typeof PT_BR_PAGES;
  messages: EmailAuthMessages;
  /** The word that names the common-password rule in this language. */
  common: RegExp;
  /** The three other rules the hint and the reset intro state. */
  others: { length: RegExp; letter: RegExp; number: RegExp };
  /** The refusal, as ONE sentence. */
  tooCommonSentence: string;
  /** What the banner used to put in front of it. */
  oldPrefix: string;
}

const PACKS: Pack[] = [
  {
    name: "pt-BR",
    copy: PT_BR,
    pages: PT_BR_PAGES,
    messages: PT_BR_MESSAGES,
    common: /senha comum/,
    others: { length: /8 caracteres/, letter: /uma letra/, number: /um número/ },
    tooCommonSentence: "Essa senha é muito comum. Escolha outra.",
    oldPrefix: "Escolha uma senha mais forte.",
  },
  {
    name: "en-US",
    copy: EN_US,
    pages: EN_US_PAGES,
    messages: EN_US_MESSAGES,
    common: /common password/,
    others: { length: /8 characters/, letter: /a letter/, number: /a number/ },
    tooCommonSentence: "That password is too common. Choose another one.",
    oldPrefix: "Choose a stronger password.",
  },
];

const useSession = (): ReturnType<Parameters<typeof createWebEmailAuth>[0]["useSession"]> =>
  ({ status: "unauthenticated", refresh: async () => {} }) as never;

/** The wire body the real server routes answer a sign-up for `PASSWORD` with. */
async function serverRefusal(messages: EmailAuthMessages): Promise<{
  violations: string[];
  violationCodes?: string[];
}> {
  const credentials = {
    signUp: vi.fn(async () => ({
      ok: false as const,
      reason: "weak-password" as const,
      violations: checkPasswordPolicy(PASSWORD),
    })),
  } as unknown as EmailCredentials;
  const signup = emailAuthRoutes({ credentials, messages }).find(
    (entry) => entry.method === "POST" && entry.path === "/signup",
  );
  const response = await signup?.handle({ body: { email: "a@b.co", password: PASSWORD }, userId: null });
  return response?.body as { violations: string[]; violationCodes?: string[] };
}

/** The whole wire body, for the fields `serverRefusal` does not narrow to. */
async function serverBody(messages: EmailAuthMessages): Promise<{ error: string }> {
  return (await serverRefusal(messages)) as unknown as { error: string };
}

afterEach(cleanup);

describe.each(PACKS)("the password rule in $name", (pack) => {
  it("is met by the example password on every rule except the common-password one", () => {
    const { length, letter, number } = pack.others;
    for (const sentence of [pack.copy.signUp.passwordHint, pack.copy.resetPassword.intro]) {
      expect(sentence).toMatch(length);
      expect(sentence).toMatch(letter);
      expect(sentence).toMatch(number);
    }
    expect(PASSWORD.length).toBeGreaterThanOrEqual(8);
    expect(PASSWORD).toMatch(/\p{L}/u);
    expect(PASSWORD).toMatch(/\d/u);
  });

  it("is refused by the server as too common, and only for that", () => {
    expect(checkPasswordPolicy(PASSWORD)).toEqual(["too-common"]);
  });

  it("is named, in plain words, by every sentence that states it", () => {
    expect(pack.copy.signUp.passwordHint).toMatch(pack.common);
    expect(pack.copy.resetPassword.intro).toMatch(pack.common);
  });

  it("shows the sign-up hint with the common-password rule on the real form", () => {
    const { SignupPage } = createWebEmailAuth({
      basePath: "/api/auth/email",
      copy: pack.copy,
      pages: pack.pages,
      useSession,
      transport: createEmailAuth({ basePath: "/api/auth/email" }),
    });
    render(
      <SignupPage callbackUrl="/" onBeforeSubmit={async () => {}} onSignedIn={() => {}} emailEnabled />,
    );

    expect(screen.getByTestId("signup-password-hint").textContent).toMatch(pack.common);
  });

  it("renders the too-common refusal as one sentence under the banner title", async () => {
    const body = await serverRefusal(pack.messages);
    expect(body.violationCodes).toEqual(["too-common"]);
    // The API's own `error` agrees with the banner: the same single sentence.
    expect((await serverBody(pack.messages)).error).toBe(pack.tooCommonSentence);

    const transport: EmailAuth = {
      ...createEmailAuth({ basePath: "/api/auth/email" }),
      signUp: vi.fn(async () => ({
        ok: false as const,
        reason: "weak-password" as const,
        violations: body.violations,
        violationCodes: body.violationCodes,
      })),
    };
    const { SignupPage } = createWebEmailAuth({
      basePath: "/api/auth/email",
      copy: pack.copy,
      pages: pack.pages,
      useSession,
      transport,
    });
    render(
      <SignupPage callbackUrl="/" onBeforeSubmit={async () => {}} onSignedIn={() => {}} emailEnabled />,
    );
    fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "ana@example.test" } });
    fireEvent.change(screen.getByLabelText(pack.copy.signUp.passwordLabel), {
      target: { value: PASSWORD },
    });
    fireEvent.submit(screen.getByTestId("email-signup-form"));

    const banner = await screen.findByTestId("auth-failure");
    expect(banner.textContent).toContain(pack.tooCommonSentence);
    expect(banner.textContent).not.toContain(pack.oldPrefix);
  });

  it("keeps the old wording for every other violation", async () => {
    const credentials = {
      signUp: vi.fn(async () => ({
        ok: false as const,
        reason: "weak-password" as const,
        violations: checkPasswordPolicy("abc"),
      })),
    } as unknown as EmailCredentials;
    const signup = emailAuthRoutes({ credentials, messages: pack.messages }).find(
      (entry) => entry.method === "POST" && entry.path === "/signup",
    );
    const response = await signup?.handle({ body: { email: "a@b.co", password: "abc" }, userId: null });
    const body = response?.body as { violations: string[]; violationCodes: string[] };

    expect(body.violationCodes).toEqual(["too-short", "needs-number"]);
    expect((response?.body as { error: string }).error).toBe(
      `${pack.messages["weak-password"]} ${body.violations.join(" ")}`,
    );
    const { failureMessage } = await import("../screens/copy");
    expect(failureMessage(pack.copy, "weak-password", body.violations, body.violationCodes)).toBe(
      `${pack.copy.failures["weak-password"]} ${body.violations.join(" ")}`,
    );
  });

  it("falls back to the old wording from a server that sends no codes", async () => {
    const { failureMessage } = await import("../screens/copy");
    expect(failureMessage(pack.copy, "weak-password", [pack.tooCommonSentence])).toBe(
      `${pack.copy.failures["weak-password"]} ${pack.tooCommonSentence}`,
    );
  });
});
