// @vitest-environment jsdom
/**
 * Screen resolution (FUT-596).
 *
 * The claims under test are the three acceptance criteria that can be stated
 * without a browser: a declared id reaches its own screen, an UNDECLARED or
 * UNKNOWN id reaches the capability default rather than a blank pane, and no
 * screen carries a branch for another provider's flow.
 *
 * The unknown-id case is the one that matters most in production and is the
 * easiest to lose: `@12-apps/payments-backend` and `@12-apps/payments-frontend`
 * version independently, so a host running a newer server than bundle publishes
 * ids this table has never seen. If that resolved to nothing, every buyer of
 * that store would see an empty pane — a total checkout outage produced by an
 * ordinary version skew, with a clean build log.
 */
import { render, screen } from "@testing-library/react";
import type { JSX } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CheckoutProviderConfig } from "../../types";
import { CapabilityDefaultScreen } from "../capability-default";
import { HostedLinkScreen } from "../hosted-link";
import { PixAndCardScreen } from "../pix-and-card";
import { resolveCheckoutScreen, screenFor } from "../registry";
import type { ProviderCheckoutScreenProps } from "../types";

// The card view reaches for a provider SDK and the vault; neither is the
// subject here, and both would make this a network test.
vi.mock("../../card-view", () => ({
  CardView: (): JSX.Element => <div data-testid="stub-card-view" />,
}));
vi.mock("../../pix-view", () => ({
  PixView: (): JSX.Element => <div data-testid="stub-pix-view" />,
}));

const BUYER = { name: "Ana", email: "ana@example.com", phone: "", taxId: "" };

function props(over: Partial<ProviderCheckoutScreenProps> = {}): ProviderCheckoutScreenProps {
  return {
    order: null,
    buyer: BUYER,
    config: null,
    method: null,
    onResolved: vi.fn(),
    ...over,
  };
}

/** A store whose chain head declares `screen`, with an in-browser card path. */
function storeWith(screenId: string | null): CheckoutProviderConfig {
  return {
    provider: "acme",
    tokenization: "PUBLIC_KEY",
    publicKey: "pk_test",
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "acme",
        tokenization: "PUBLIC_KEY",
        publicKey: "pk_test",
        mockTokenization: false,
        methods: ["PIX", "CARD"],
        checkoutScreen: screenId,
      },
    ],
  };
}

describe("screenFor", () => {
  it("resolves each id this bundle ships", () => {
    expect(screenFor("pix-and-card")).toBe(PixAndCardScreen);
    expect(screenFor("hosted-link")).toBe(HostedLinkScreen);
  });

  it("answers null for nothing declared", () => {
    expect(screenFor(null)).toBeNull();
    expect(screenFor(undefined)).toBeNull();
    expect(screenFor("")).toBeNull();
  });

  it("answers null for an id it does not know, rather than throwing", () => {
    // The version-skew case: a newer backend declaring a screen this bundle
    // has not shipped yet.
    expect(screenFor("boleto-and-wallet")).toBeNull();
  });

  it("does not resolve inherited Object properties as screens", () => {
    // A plain-record lookup keyed by a server-supplied string: `constructor`
    // and `toString` are attacker-reachable ids that must not become
    // components.
    expect(screenFor("constructor")).toBeNull();
    expect(screenFor("toString")).toBeNull();
    expect(screenFor("__proto__")).toBeNull();
  });
});

describe("resolveCheckoutScreen", () => {
  it("returns the declared screen", () => {
    expect(resolveCheckoutScreen("hosted-link")).toBe(HostedLinkScreen);
    expect(resolveCheckoutScreen("pix-and-card")).toBe(PixAndCardScreen);
  });

  it("falls back to the capability default when nothing is declared (AC3)", () => {
    expect(resolveCheckoutScreen(null)).toBe(CapabilityDefaultScreen);
    expect(resolveCheckoutScreen(undefined)).toBe(CapabilityDefaultScreen);
  });

  it("falls back to the capability default for an UNKNOWN id (AC3)", () => {
    expect(resolveCheckoutScreen("a-screen-from-a-newer-server")).toBe(CapabilityDefaultScreen);
  });

  it("never returns null — every id resolves to something renderable", () => {
    for (const id of [null, undefined, "", "pix-and-card", "hosted-link", "nonsense"]) {
      expect(resolveCheckoutScreen(id)).toBeTruthy();
    }
  });
});

describe("the screens do not know about each other (AC2)", () => {
  it("pix-and-card renders the PIX pane for a PIX payable and no hand-off", () => {
    render(
      <PixAndCardScreen
        {...props({
          config: storeWith("pix-and-card"),
          method: "PIX",
          order: { orderId: "o1", status: "AWAITING_PAYMENT", method: "PIX", totalLabel: "R$ 10,00" } as never,
        })}
      />,
    );
    expect(screen.getByTestId("stub-pix-view")).toBeTruthy();
    expect(screen.queryByTestId("checkout-hosted-handoff")).toBeNull();
  });

  it("hosted-link renders the hand-off and never a card or PIX pane", () => {
    render(<HostedLinkScreen {...props({ config: storeWith("hosted-link"), method: "CARD" })} />);
    expect(screen.getByTestId("checkout-hosted-handoff")).toBeTruthy();
    expect(screen.queryByTestId("stub-card-view")).toBeNull();
    expect(screen.queryByTestId("stub-pix-view")).toBeNull();
  });

  it("hosted-link stays out of the way until a method is chosen", () => {
    const { container } = render(
      <HostedLinkScreen {...props({ config: storeWith("hosted-link"), method: null })} />,
    );
    expect(container.innerHTML).toBe("");
  });
});

describe("the capability default picks the shape from what the store can do", () => {
  it("sends an in-browser card store to the on-page screen", () => {
    render(
      <CapabilityDefaultScreen
        {...props({
          config: storeWith(null),
          method: "CARD",
          order: { orderId: "o1", status: "AWAITING_PAYMENT", method: "CARD", totalLabel: "R$ 10,00" } as never,
        })}
      />,
    );
    expect(screen.getByTestId("stub-card-view")).toBeTruthy();
  });

  it("sends a store that offers CARD but cannot mint to the hand-off", () => {
    const hosted: CheckoutProviderConfig = {
      provider: "acme",
      tokenization: "REDIRECT",
      publicKey: null,
      mockTokenization: false,
      methods: ["CARD"],
      chain: [
        {
          provider: "acme",
          tokenization: "REDIRECT",
          publicKey: null,
          mockTokenization: false,
          methods: ["CARD"],
          checkoutScreen: null,
        },
      ],
    };
    render(<CapabilityDefaultScreen {...props({ config: hosted, method: "CARD" })} />);
    expect(screen.getByTestId("checkout-hosted-handoff")).toBeTruthy();
  });

  it("does NOT read a PIX-only store as hosted (the FUT-747 correction)", () => {
    // A provider that honestly declares `NONE` tokenization has no card to
    // tokenize — that is not the same fact as "this checkout is hosted", and
    // conflating them routed the simplest store there is into a hand-off it
    // had no link for.
    const pixOnly: CheckoutProviderConfig = {
      provider: "acme",
      tokenization: "NONE",
      publicKey: null,
      mockTokenization: false,
      methods: ["PIX"],
      chain: [
        {
          provider: "acme",
          tokenization: "NONE",
          publicKey: null,
          mockTokenization: false,
          methods: ["PIX"],
          checkoutScreen: null,
        },
      ],
    };
    render(
      <CapabilityDefaultScreen
        {...props({
          config: pixOnly,
          method: "PIX",
          order: { orderId: "o1", status: "AWAITING_PAYMENT", method: "PIX", totalLabel: "R$ 10,00" } as never,
        })}
      />,
    );
    expect(screen.getByTestId("stub-pix-view")).toBeTruthy();
    expect(screen.queryByTestId("checkout-hosted-handoff")).toBeNull();
  });

  it("renders the on-page screen while the config is still loading", () => {
    // `null` config fails OPEN for the UI — the tokenizer still fails closed.
    render(<CapabilityDefaultScreen {...props({ config: null, method: null })} />);
    // No order and no method yet ⇒ the pane is legitimately empty, but it is
    // the on-page screen that decided so, not a missing component.
    expect(screen.queryByTestId("checkout-hosted-handoff")).toBeNull();
  });
});
