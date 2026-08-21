/**
 * The invite's two branches, and the three things that make the iOS one worth
 * showing at all.
 *
 * The iOS cases are the load-bearing ones. A one-tap button converts on its
 * own; a written instruction only works if somebody reads it, and each
 * assertion below is a claim about whether they will.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InstallInvite } from "../react/install-invite";
import { PT_BR_PWA_MESSAGES } from "../pt-BR";

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IOS_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0 Mobile/15E148 Safari/604.1";
const DESKTOP_CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

function setUserAgent(value: string): void {
  Object.defineProperty(navigator, "userAgent", { configurable: true, value });
}

/** Query-aware: `display-mode` and `pointer` must be answerable separately. */
function setEnvironment({ standalone = false, coarse = false } = {}): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("display-mode") ? standalone : query.includes("pointer: coarse") && coarse,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
}

beforeEach(() => {
  setEnvironment();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the iOS instruction", () => {
  it("leads with the REASON, not with the instruction", () => {
    setUserAgent(IOS_SAFARI);
    render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled />);

    // The first version opened with "Adicione à sua tela de início" and buried
    // the payoff in grey caption text. Nobody adds a site to their Home Screen
    // because they want to add a site to their Home Screen.
    const invite = screen.getByTestId("install-invite-ios");
    expect(invite.textContent).toMatch(/^Receba um aviso quando o pedido ficar pronto/);
    expect(invite.textContent).toContain("FutureDrink");
  });

  it("shows the share GLYPH rather than the word", () => {
    setUserAgent(IOS_SAFARI);
    const { container } = render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled />);

    // "Toque em Compartilhar" asks somebody to translate a word into a control.
    // The glyph is the same shape that is in the browser chrome.
    expect(container.querySelector("svg")).not.toBeNull();
    expect(screen.getByTestId("install-invite-ios").textContent).not.toContain("Compartilhar");
  });

  it("anchors to the bottom, where the share control actually is", () => {
    setUserAgent(IOS_SAFARI);
    render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled />);

    // A banner at the top of the page pointing at a control in the bottom bar
    // is pointing at nothing.
    const invite = screen.getByTestId("install-invite-ios");
    expect(invite.style.position).toBe("fixed");
    expect(invite.style.bottom).not.toBe("");
  });

  it("can be rendered inline when the host places it itself", () => {
    setUserAgent(IOS_SAFARI);
    render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled placement="inline" />);
    expect(screen.getByTestId("install-invite-ios").style.position).toBe("");
  });

  it("gives Chrome on iOS the SAME instruction — it can install too", () => {
    // iOS 16.4 put "Add to Home Screen" in every browser's share sheet.
    // Excluding CriOS told a large share of iPhone users nothing at all.
    setUserAgent(IOS_CHROME);
    render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled />);
    expect(screen.getByTestId("install-invite-ios")).toBeDefined();
  });
});

describe("the rest of the invite", () => {
  it("offers nothing on a desktop with no held prompt", () => {
    // No `beforeinstallprompt` means Chromium did not judge it installable.
    setUserAgent(DESKTOP_CHROME);
    const { container } = render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled />);
    // Nothing rendered at all — a stronger claim than "this test id is absent",
    // and the accurate one: the component returns null.
    expect(container.innerHTML).toBe("");
  });

  it("offers nothing to an already-installed app", () => {
    setUserAgent(IOS_SAFARI);
    setEnvironment({ standalone: true });
    const { container } = render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled />);
    expect(container.innerHTML).toBe("");
  });

  it("stays inert when the host's gate is closed", () => {
    setUserAgent(IOS_SAFARI);
    const { container } = render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("takes the host's own words", () => {
    setUserAgent(IOS_SAFARI);
    render(
      <InstallInvite
        what="Acme"
        enabled
        messages={{ ...PT_BR_PWA_MESSAGES, iosBenefit: (what) => `Get notified — install ${what}.`, dismiss: "Not now" }}
      />,
    );
    const invite = screen.getByTestId("install-invite-ios");
    expect(invite.textContent).toContain("Get notified — install Acme.");
    expect(invite.textContent).toContain("Not now");
  });

  it("says why it declined, so a broken invite is not a healthy-looking page", () => {
    setUserAgent(DESKTOP_CHROME);
    const onDiagnostic = vi.fn();
    render(<InstallInvite what="FutureDrink" messages={PT_BR_PWA_MESSAGES} enabled onDiagnostic={onDiagnostic} />);

    expect(onDiagnostic).toHaveBeenCalledWith(
      "install-invite: nothing to offer",
      expect.objectContaining({ iosInstallable: false, hasDeferred: false }),
    );
  });
});
