import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EmailAuth } from "../create-email-auth";
import { createEmailAuthScreens, type ScreensSession } from "../screens";
import { inboxLink } from "../screens/inbox-link";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";

/**
 * "Confira seu e-mail" opens the person's webmail on the message, when the
 * address says which webmail that is.
 */

describe("inboxLink", () => {
  it("searches Gmail for the sender, in every folder, in the account the address names", () => {
    const link = inboxLink("Ana@Gmail.com", "Paladira");
    expect(link?.provider).toBe("Gmail");
    expect(link?.href).toMatch(/^https:\/\/mail\.google\.com\/mail\/u\/Ana%40Gmail\.com\/#search\//);
    expect(decodeURIComponent(link?.href.split("#search/")[1] ?? "")).toBe(
      "from:Paladira in:anywhere newer_than:1h",
    );
  });

  it("opens the Gmail account unfiltered without a sender", () => {
    expect(inboxLink("ana@googlemail.com")?.href).toBe("https://mail.google.com/mail/u/ana%40googlemail.com/");
  });

  it.each(["hotmail.com", "hotmail.com.br", "outlook.com", "outlook.com.br", "live.com", "msn.com"])(
    "opens Outlook for @%s, signed in as the address",
    (domain) => {
      const link = inboxLink(`ana@${domain}`, "Paladira");
      expect(link?.provider).toBe("Outlook");
      const url = new URL(link?.href ?? "");
      expect(url.origin + url.pathname).toBe("https://outlook.live.com/mail/0/");
      expect(url.searchParams.get("login_hint")).toBe(`ana@${domain}`);
    },
  );

  it("searches Yahoo for the sender", () => {
    expect(inboxLink("ana@yahoo.com.br", "Paladira")?.href).toBe(
      "https://mail.yahoo.com/d/search/keyword=from%253APaladira",
    );
  });

  it.each(["ana@empresa.com.br", "ana@uol.com.br", "not-an-address"])("offers nothing for %s", (email) => {
    expect(inboxLink(email, "Paladira")).toBeNull();
  });
});

const session: ScreensSession = {
  signInWithPassword: vi.fn(async () => ({ ok: false as const, reason: "unknown" as const })),
};

function client(): EmailAuth {
  return {
    signUp: vi.fn(async () => ({ ok: true as const, data: { status: "verification-sent" as const } })),
  } as unknown as EmailAuth;
}

async function signUp(email: string, inboxSender?: string) {
  const { EmailSignupForm } = createEmailAuthScreens({
    client: client(),
    copy: SCREEN_COPY,
    useSession: () => session,
    ...(inboxSender === undefined ? {} : { inboxSender }),
  });
  render(<EmailSignupForm callbackUrl="/" onBeforeSubmit={async () => {}} onSignedIn={() => {}} />);
  fireEvent.change(document.getElementById("signup-email") as HTMLInputElement, { target: { value: email } });
  fireEvent.change(document.getElementById("signup-password") as HTMLInputElement, {
    target: { value: "senha1234" },
  });
  fireEvent.submit(screen.getByTestId("email-signup-form"));
  await screen.findByTestId("signup-verification-sent");
}

describe("the account-created screen", () => {
  it("offers to open Gmail on the confirmation, in a new tab", async () => {
    await signUp("ana@gmail.com", "Paladira");

    const button = screen.getByTestId("signup-open-inbox");
    expect(button.textContent).toBe("Abrir o Gmail");
    expect(button.getAttribute("href")).toContain("#search/from%3APaladira");
    expect(button.getAttribute("target")).toBe("_blank");
    expect(button.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("offers to open Outlook for a Hotmail address", async () => {
    await signUp("ana@hotmail.com", "Paladira");

    expect(screen.getByTestId("signup-open-inbox").textContent).toBe("Abrir o Outlook");
  });

  it("offers no button for an address whose webmail it cannot tell", async () => {
    await signUp("ana@empresa.com.br", "Paladira");

    await waitFor(() => expect(screen.queryByTestId("signup-open-inbox")).toBeNull());
  });
});
