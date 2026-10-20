import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EmailAuth } from "../create-email-auth";
import { createEmailAuthScreens, type ScreensSession } from "../screens";
import { inboxLink } from "../screens/inbox-link";
import { PT_BR as SCREEN_COPY } from "../screens/pt-BR";

/**
 * "Confira seu e-mail" for an address whose webmail the address alone does not
 * name: the server read it off the domain's MX (`inbox` on the sign-up
 * answer), and the screen opens that webmail. Also the public domains added
 * with it.
 */

describe("inboxLink with the server's MX reading", () => {
  it.each([
    ["titan", "Titan", "https://app.titan.email/"],
    ["zoho", "Zoho", "https://mail.zoho.com/"],
    ["icloud", "iCloud", "https://www.icloud.com/mail/"],
    ["proton", "Proton", "https://mail.proton.me/"],
  ])("opens %s's webmail for a company domain", (host, provider, href) => {
    expect(inboxLink("thom@paladira.com", "Paladira", host)).toEqual({ provider, href });
  });

  it("opens Microsoft 365's Outlook, signed in as the address", () => {
    const link = inboxLink("ana@empresa.com.br", "Paladira", "microsoft");
    expect(link?.provider).toBe("Outlook");
    const url = new URL(link?.href ?? "");
    expect(url.origin + url.pathname).toBe("https://outlook.office.com/mail/");
    expect(url.searchParams.get("login_hint")).toBe("ana@empresa.com.br");
  });

  it("keeps Gmail's search, in the default account, for Google Workspace", () => {
    const href = inboxLink("ana@empresa.com.br", "Paladira", "google")?.href ?? "";
    expect(href.startsWith("https://mail.google.com/mail/u/0/#search/")).toBe(true);
    expect(href).not.toContain("empresa");
  });

  it("lets the address's own domain win over the MX reading", () => {
    expect(inboxLink("ana@gmail.com", "Paladira", "titan")?.provider).toBe("Gmail");
  });

  it.each(["unknown", "__proto__", "toString", ""])("ignores a key it does not know (%j)", (host) => {
    expect(inboxLink("ana@empresa.com.br", "Paladira", host)).toBeNull();
  });
});

describe("inboxLink for the public domains added with it", () => {
  it.each([
    ["ana@icloud.com", "iCloud", "https://www.icloud.com/mail/"],
    ["ana@me.com", "iCloud", "https://www.icloud.com/mail/"],
    ["ana@mac.com", "iCloud", "https://www.icloud.com/mail/"],
    ["ana@uol.com.br", "UOL", "https://email.uol.com.br/"],
    ["ana@bol.com.br", "BOL", "https://email.bol.uol.com.br/"],
    ["ana@proton.me", "Proton", "https://mail.proton.me/"],
    ["ana@protonmail.com", "Proton", "https://mail.proton.me/"],
    ["ana@pm.me", "Proton", "https://mail.proton.me/"],
    ["ana@aol.com", "AOL", "https://mail.aol.com/"],
  ])("opens %s in %s", (email, provider, href) => {
    expect(inboxLink(email, "Paladira")).toEqual({ provider, href });
  });
});

const session: ScreensSession = {
  signInWithPassword: vi.fn(async () => ({ ok: false as const, reason: "unknown" as const })),
};

async function signUp(email: string, inbox: unknown) {
  const client = {
    signUp: vi.fn(async () => ({ ok: true as const, data: { status: "verification-sent" as const, inbox } })),
  } as unknown as EmailAuth;
  const { EmailSignupForm } = createEmailAuthScreens({
    client,
    copy: SCREEN_COPY,
    useSession: () => session,
    inboxSender: "Paladira",
  });
  render(<EmailSignupForm callbackUrl="/" onBeforeSubmit={async () => {}} onSignedIn={() => {}} />);
  fireEvent.change(document.getElementById("signup-email") as HTMLInputElement, { target: { value: email } });
  fireEvent.change(document.getElementById("signup-password") as HTMLInputElement, {
    target: { value: "senha1234" },
  });
  fireEvent.submit(screen.getByTestId("email-signup-form"));
  await screen.findByTestId("signup-verification-sent");
}

describe("the account-created screen, for a company domain", () => {
  it("offers to open Titan when the server read it off the MX", async () => {
    await signUp("thom@paladira.com", "titan");

    const button = await screen.findByTestId("signup-open-inbox");
    expect(button.textContent).toBe("Abrir o Titan");
    expect(button.getAttribute("href")).toBe("https://app.titan.email/");
    expect(button.getAttribute("target")).toBe("_blank");
    expect(button.getAttribute("rel")).toBe("noopener noreferrer");
    expect(button.getAttribute("data-provider")).toBe("Titan");
  });

  it("offers no button when the server sent nothing, or something that is not a key", async () => {
    await signUp("thom@paladira.com", { href: "https://evil.example" });

    await waitFor(() =>
      expect(Array.from(document.querySelectorAll("[data-testid]"), (el) => el.getAttribute("data-testid"))).not.toContain(
        "signup-open-inbox",
      ),
    );
  });
});
