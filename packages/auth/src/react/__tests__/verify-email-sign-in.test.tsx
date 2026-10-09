import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EmailAuth, VerifyEmailClientData } from "../create-email-auth";
import type { PasswordSignInResult } from "../password-signin";
import { createEmailAuthScreens, type ScreensSession, type VerifiedOutcome } from "../screens";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";

/**
 * The verify screen's hand-over (FUT-3474): with `onVerified`, a verified link
 * in the browser that signed up becomes a session on the spot, and any other
 * browser is told the address so the host can prefill a sign-in.
 */

function clientVerifying(data: VerifyEmailClientData): EmailAuth {
  return {
    verifyEmail: vi.fn(async () => ({ ok: true as const, data })),
  } as unknown as EmailAuth;
}

function sessionAnswering(result: PasswordSignInResult) {
  const signInWithLink = vi.fn(async () => result);
  const session: ScreensSession = {
    signInWithPassword: vi.fn(async () => ({ ok: false as const, reason: "unknown" as const })),
    signInWithLink,
  };
  return { signInWithLink, useSession: () => session };
}

function renderScreen(client: EmailAuth, useSession: () => ScreensSession) {
  const outcomes: VerifiedOutcome[] = [];
  const { VerifyEmailScreen } = createEmailAuthScreens({ client, copy: SCREEN_COPY, useSession });
  render(
    <VerifyEmailScreen
      token="tok"
      callbackUrl="/aliment-sabor"
      onContinue={() => {}}
      onVerified={(outcome) => outcomes.push(outcome)}
    />,
  );
  return outcomes;
}

describe("VerifyEmailScreen with onVerified", () => {
  it("signs the bound browser in with the same link, then hands over", async () => {
    const { signInWithLink, useSession } = sessionAnswering({ ok: true, url: "/aliment-sabor" });
    const outcomes = renderScreen(clientVerifying({ email: "ana@example.com", canSignIn: true }), useSession);

    await waitFor(() => expect(outcomes).toEqual([{ email: "ana@example.com", signedIn: true }]));
    expect(signInWithLink).toHaveBeenCalledWith({ token: "tok", callbackUrl: "/aliment-sabor" });
  });

  it("signs nobody in from another browser, and reports the address", async () => {
    const { signInWithLink, useSession } = sessionAnswering({ ok: true, url: "/" });
    const outcomes = renderScreen(clientVerifying({ email: "ana@example.com", canSignIn: false }), useSession);

    await waitFor(() => expect(outcomes).toEqual([{ email: "ana@example.com", signedIn: false }]));
    expect(signInWithLink).not.toHaveBeenCalled();
  });

  it("reports a refused sign-in as verified but not signed in", async () => {
    const { useSession } = sessionAnswering({ ok: false, reason: "token-invalid" });
    const outcomes = renderScreen(clientVerifying({ email: "ana@example.com", canSignIn: true }), useSession);

    await waitFor(() => expect(outcomes).toEqual([{ email: "ana@example.com", signedIn: false }]));
  });

  it("keeps the failed screen for a spent link, and hands nothing over", async () => {
    const client = {
      verifyEmail: vi.fn(async () => ({ ok: false as const, reason: "token-invalid" as const })),
    } as unknown as EmailAuth;
    const { useSession } = sessionAnswering({ ok: true, url: "/" });
    const outcomes = renderScreen(client, useSession);

    expect(await screen.findByTestId("verify-failed")).toBeTruthy();
    expect(outcomes).toEqual([]);
  });
});
