import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EmailAuth } from "../create-email-auth";
import type { EmailAuthFailure } from "../../email-credentials";
import { createEmailAuthScreens, type ScreensSession } from "../screens";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";

/**
 * The two rough edges the FUT-3474 UI review left:
 *
 * - a sign-in that arrives with the address filled in starts on the password;
 * - a dead confirmation link offers the new one its copy promises, and only a
 *   dead link is titled "Link inválido".
 */

const session: ScreensSession = {
  signInWithPassword: vi.fn(async () => ({ ok: false as const, reason: "unknown" as const })),
};

function clientFailing(reason: EmailAuthFailure | "unknown") {
  const resendVerification = vi.fn(async () => ({ ok: true as const, data: null }));
  const client = {
    verifyEmail: vi.fn(async () => ({ ok: false as const, reason })),
    resendVerification,
  } as unknown as EmailAuth;
  return { client, resendVerification };
}

function renderVerify(client: EmailAuth) {
  const { VerifyEmailScreen } = createEmailAuthScreens({ client, copy: SCREEN_COPY, useSession: () => session });
  render(<VerifyEmailScreen token="tok" onContinue={() => {}} />);
}

describe("the sign-in form with an address handed over", () => {
  it("starts on the password field", async () => {
    const { EmailPasswordForm } = createEmailAuthScreens({
      client: {} as EmailAuth,
      copy: SCREEN_COPY,
      useSession: () => session,
    });
    render(
      <EmailPasswordForm
        callbackUrl="/"
        onSignedIn={() => {}}
        onForgotPassword={() => {}}
        initialEmail="ana@example.com"
      />,
    );

    expect(screen.getByTestId("login-email")).toHaveProperty("value", "ana@example.com");
    const password = document.getElementById("login-password");
    await waitFor(() => expect(password).toHaveFocus());
  });

  it("focuses nothing when it starts empty", async () => {
    const { EmailPasswordForm } = createEmailAuthScreens({
      client: {} as EmailAuth,
      copy: SCREEN_COPY,
      useSession: () => session,
    });
    render(<EmailPasswordForm callbackUrl="/" onSignedIn={() => {}} onForgotPassword={() => {}} />);

    const password = document.getElementById("login-password");
    await waitFor(() => expect(password).not.toHaveFocus());
  });
});

describe("a confirmation link that cannot be confirmed", () => {
  it("offers a new link for a dead one, and sends it to the address typed", async () => {
    const { client, resendVerification } = clientFailing("token-invalid");
    renderVerify(client);

    expect(await screen.findByText("Link inválido")).toBeTruthy();
    const button = screen.getByTestId("resend-verification");
    expect(button).toHaveProperty("disabled", true);

    fireEvent.change(document.getElementById("verify-resend-email") as HTMLInputElement, {
      target: { value: "ana@example.com" },
    });
    fireEvent.click(button);

    await waitFor(() => expect(resendVerification).toHaveBeenCalledWith("ana@example.com"));
    expect(await screen.findByTestId("verify-resent")).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("resend-verification")).toBeNull());
  });

  it("does not blame the link, nor offer a new one, for a server error", async () => {
    const { client } = clientFailing("unknown");
    renderVerify(client);

    const alert = await screen.findByTestId("verify-failed");
    expect(alert.getAttribute("data-reason")).toBe("unknown");
    expect(alert.textContent).not.toContain("Link inválido");
    await waitFor(() => expect(screen.queryByTestId("resend-verification")).toBeNull());
  });
});
