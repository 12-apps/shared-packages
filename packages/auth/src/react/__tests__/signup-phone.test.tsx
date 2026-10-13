import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createEmailAuth, type EmailAuth } from "../create-email-auth";
import { createWebEmailAuth } from "../create-web-email-auth";
import { PT_BR_PAGES } from "../pages/pt-BR";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";
import type { SignupPhoneField } from "../screens";

/**
 * The sign-up form asks for a phone when the host passes one (a store that
 * delivers asks at the door, not at the first order).
 *
 * The host owns the rules — the mask and what counts as a phone — and the form
 * owns the gate: the submit stays shut while the host has a problem with the
 * value, the problem shows once the field is left, and the value rides the
 * sign-up request. Without the prop nothing about the form changes.
 */

const useSession = (): ReturnType<Parameters<typeof createWebEmailAuth>[0]["useSession"]> =>
  ({ status: "unauthenticated", refresh: async () => {} }) as never;

/** A toy national rule: digits only, grouped 2-4-4, exactly ten of them. */
const PHONE: SignupPhoneField = {
  label: "Celular",
  hint: "Para o entregador falar com você.",
  format: (typed) => {
    const digits = typed.replace(/\D/g, "").slice(0, 10);
    return [digits.slice(0, 2), digits.slice(2, 6), digits.slice(6)].filter(Boolean).join(" ");
  },
  problem: (value) => (value.replace(/\D/g, "").length === 10 ? null : "Confira o número."),
};

function renderSignup(phone?: SignupPhoneField): EmailAuth["signUp"] {
  const signUp = vi.fn(async () => ({ ok: true as const, data: { status: "verification-sent" as const } }));
  const { SignupPage } = createWebEmailAuth({
    basePath: "/api/auth/email",
    copy: SCREEN_COPY,
    pages: PT_BR_PAGES,
    useSession,
    transport: { ...createEmailAuth({ basePath: "/api/auth/email" }), signUp },
  });
  render(
    <SignupPage
      callbackUrl="/"
      onBeforeSubmit={async () => {}}
      onSignedIn={() => {}}
      emailEnabled
      {...(phone ? { phone } : {})}
    />,
  );
  return signUp;
}

function fillAccount(): void {
  fireEvent.change(screen.getByLabelText(/E-mail/), { target: { value: "ana@example.test" } });
  fireEvent.change(screen.getByLabelText(SCREEN_COPY.signUp.passwordLabel), {
    target: { value: "uma senha boa 42" },
  });
}

const phoneInput = (): HTMLInputElement => screen.getByLabelText(PHONE.label) as HTMLInputElement;
const submit = (): HTMLButtonElement => screen.getByTestId("signup-submit") as HTMLButtonElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("the sign-up phone", () => {
  it("is not on the form unless the host asks for it", () => {
    renderSignup();
    const form = screen.getByTestId("email-signup-form");
    expect(Array.from(form.querySelectorAll("input"), (input) => input.name)).toEqual([
      "name",
      "email",
      "signup-password",
    ]);
    fillAccount();
    expect(submit().disabled).toBe(false);
  });

  it("masks as typed, with the host's rule", () => {
    renderSignup(PHONE);
    fireEvent.change(phoneInput(), { target: { value: "31a9876x5432" } });
    expect(phoneInput().value).toBe("31 9876 5432");
  });

  it("keeps the submit shut until the host accepts the number", () => {
    renderSignup(PHONE);
    fillAccount();
    expect(submit().disabled).toBe(true);
    fireEvent.change(phoneInput(), { target: { value: "3198" } });
    expect(submit().disabled).toBe(true);
    fireEvent.change(phoneInput(), { target: { value: "3198765432" } });
    expect(submit().disabled).toBe(false);
  });

  it("shows the hint while typing, and the problem once the field is left", async () => {
    renderSignup(PHONE);
    fireEvent.change(phoneInput(), { target: { value: "3198" } });
    expect(screen.getByText(PHONE.hint ?? "")).toBeTruthy();
    expect(phoneInput().getAttribute("aria-invalid")).toBe("false");

    fireEvent.blur(phoneInput());
    expect(screen.getByText("Confira o número.")).toBeTruthy();
    expect(phoneInput().getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(phoneInput(), { target: { value: "3198765432" } });
    await waitFor(() => expect(screen.queryByText("Confira o número.")).toBeNull());
  });

  it("does not send on Enter while the number is refused", async () => {
    const signUp = renderSignup(PHONE);
    fillAccount();
    fireEvent.change(phoneInput(), { target: { value: "3198" } });
    // Inside `act`, so the consent hook the submit awaits first has run and a
    // sign-up that was going to be sent has been.
    await act(async () => {
      fireEvent.submit(screen.getByTestId("email-signup-form"));
    });
    expect(signUp).not.toHaveBeenCalled();
  });

  it("sends the number with the sign-up", async () => {
    const signUp = renderSignup(PHONE);
    fillAccount();
    fireEvent.change(phoneInput(), { target: { value: "3198765432" } });
    fireEvent.submit(screen.getByTestId("email-signup-form"));
    await waitFor(() =>
      expect(signUp).toHaveBeenCalledWith(expect.objectContaining({ phone: "31 9876 5432" })),
    );
  });
});
