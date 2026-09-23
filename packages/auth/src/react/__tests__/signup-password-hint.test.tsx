import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmailAuth, type EmailAuth } from "../create-email-auth";
import { createWebEmailAuth } from "../create-web-email-auth";
import { PT_BR_PAGES } from "../pages/pt-BR";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";

/**
 * The sign-up password hint, and the refusal banner it sits under, as the
 * product owner asked for them (FUT-2393).
 *
 * The hint states the rule: 8 characters, a letter and a number. It stays in the
 * secondary ink until the password has FAILED — the field was left with a
 * password outside the rule, or the server refused the password as weak — and
 * then it turns the error colour with the field's own outline, and back again
 * once the password is fixed. The refusal banner floats over the page instead
 * of sitting in the form's flow.
 */

const useSession = (): ReturnType<Parameters<typeof createWebEmailAuth>[0]["useSession"]> =>
  ({ status: "unauthenticated", refresh: async () => {} }) as never;

/** A transport whose sign-up refuses every password as weak. */
function refusingTransport(): EmailAuth {
  return {
    ...createEmailAuth({ basePath: "/api/auth/email" }),
    signUp: vi.fn(async () => ({
      ok: false as const,
      reason: "weak-password" as const,
      violations: ["too-common"],
    })),
  };
}

function renderSignup(): void {
  const { SignupPage } = createWebEmailAuth({
    basePath: "/api/auth/email",
    copy: SCREEN_COPY,
    pages: PT_BR_PAGES,
    useSession,
    transport: refusingTransport(),
  });
  render(
    <SignupPage callbackUrl="/" onBeforeSubmit={async () => {}} onSignedIn={() => {}} emailEnabled />,
  );
}

const hintColour = (): string => getComputedStyle(screen.getByTestId("signup-password-hint")).color;
const passwordInput = (): HTMLElement => screen.getByLabelText(SCREEN_COPY.signUp.passwordLabel);

/** Fill the e-mail and the password, and send the form. */
async function submitWith(password: string): Promise<void> {
  fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "ana@example.test" } });
  fireEvent.change(passwordInput(), { target: { value: password } });
  fireEvent.submit(screen.getByTestId("email-signup-form"));
  await screen.findByTestId("auth-failure");
}

afterEach(() => {
  cleanup();
});

describe("the sign-up password hint", () => {
  it("does not judge a password while it is being typed", () => {
    renderSignup();
    const idle = hintColour();

    fireEvent.change(passwordInput(), { target: { value: "abc" } });

    expect(hintColour()).toBe(idle);
    expect(passwordInput().getAttribute("aria-invalid")).toBe("false");
  });

  it("turns red when the field is left with a password outside the rule, and back once it fits", () => {
    renderSignup();
    const idle = hintColour();

    fireEvent.change(passwordInput(), { target: { value: "abc" } });
    fireEvent.blur(passwordInput());
    expect(hintColour()).not.toBe(idle);
    expect(passwordInput().getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(passwordInput(), { target: { value: "Tijolo-Verde-2026" } });
    expect(hintColour()).toBe(idle);
    expect(passwordInput().getAttribute("aria-invalid")).toBe("false");
  });

  it("leaves an empty field that was only passed through alone", () => {
    renderSignup();
    const idle = hintColour();

    fireEvent.blur(passwordInput());

    expect(hintColour()).toBe(idle);
  });

  it("turns red when the server refuses the password, even one that fits the stated rule", async () => {
    // "abc12345" has 8 characters, a letter and a number, and the server's
    // common-password list refuses it (FUT-2396). The refusal is what failed it.
    renderSignup();
    const idle = hintColour();

    await submitWith("abc12345");
    expect(hintColour()).not.toBe(idle);

    fireEvent.change(passwordInput(), { target: { value: "abc123456" } });
    expect(hintColour()).toBe(idle);
  });
});

describe("the refusal banner", () => {
  it("floats over the page on an opaque layer, above the host's header", async () => {
    renderSignup();

    await submitWith("abc12345");

    const layer = getComputedStyle(screen.getByTestId("auth-failure-layer"));
    expect(layer.position).toBe("fixed");
    // Opaque, so the fields it covers do not read through it.
    expect(["", "transparent", "rgba(0, 0, 0, 0)"]).not.toContain(layer.backgroundColor);
    // Over an app bar (MUI's 1100) and the sign-up actions block.
    expect(Number(layer.zIndex)).toBeGreaterThan(1100);
  });
});
