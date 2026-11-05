// @vitest-environment jsdom
/**
 * FUT-472 — the Apple Pay button, on its own.
 *
 * `ApplePaySession` is faked at the seam Safari provides it (the window
 * global), so these drive the real session wiring: feature-detect gates
 * rendering, the payment request pins Visa/Mastercard ONLY (PagBank's
 * constraint — a network the gateway would refuse must never be offered on
 * the sheet), merchant validation goes through the host's port or aborts
 * honestly, and an authorized payment's `token.paymentData` reaches the
 * caller serialized verbatim, with the sheet completed on the caller's real
 * outcome. The one list's charge behind it is pinned in
 * `payment-list-wallet.test.tsx`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplePayButton, type ApplePayPaymentRequest } from "../apple-pay-button";
import { applePayDeclared } from "../method-capability";
import type { CheckoutOrder, CheckoutProviderConfig } from "../types";

afterEach(() => {
  cleanup();
  delete (window as { ApplePaySession?: unknown }).ApplePaySession;
});

const ORDER: CheckoutOrder = {
  orderId: "order-1",
  status: "AWAITING_PAYMENT",
  method: "CARD",
  totalCents: 7500,
  subtotalCents: null,
  discountTotalCents: 0,
  appliedDiscounts: [],
  totalLabel: "R$ 75,00",
};

/** A chain whose head declares Apple Pay (and nothing Google). */
function appleConfig(overrides: Record<string, unknown> = {}): CheckoutProviderConfig {
  return {
    provider: "pagbank",
    tokenization: "PUBLIC_KEY",
    publicKey: "pk",
    mockTokenization: true,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "pagbank",
        tokenization: "PUBLIC_KEY",
        publicKey: "pk",
        mockTokenization: true,
        methods: ["PIX", "CARD"],
        wallets: ["APPLE_PAY"],
        ...overrides,
      },
    ],
  };
}

/** The session world: every constructed session, inspectable. */
interface SessionWorld {
  requests: ApplePayPaymentRequest[];
  sessions: FakeSession[];
}

/** One faked ApplePaySession run. Fields are containers, never rebound. */
class FakeSession {
  onvalidatemerchant: ((event: { validationURL: string }) => void) | null = null;
  onpaymentauthorized:
    | ((event: { payment: { token: { paymentData: unknown } } }) => void)
    | null = null;
  oncancel: (() => void) | null = null;
  begun = false;
  aborted = false;
  merchantSessions: unknown[] = [];
  completions: { status: number }[] = [];

  begin(): void {
    this.begun = true;
    // The real session validates the merchant as soon as the sheet shows.
    this.onvalidatemerchant?.({ validationURL: "https://apple.example/validate" });
  }
  abort(): void {
    this.aborted = true;
  }
  completeMerchantValidation(merchantSession: unknown): void {
    this.merchantSessions.push(merchantSession);
    // Merchant validated ⇒ the buyer confirms on the sheet.
    this.onpaymentauthorized?.({
      payment: { token: { paymentData: { data: "opaque", signature: "sig" } } },
    });
  }
  completePayment(result: { status: number }): void {
    this.completions.push(result);
  }
}

/** Install a fake `window.ApplePaySession`; answer whether the device can pay. */
function installApplePay(canPay = true): SessionWorld {
  const world: SessionWorld = { requests: [], sessions: [] };
  class Session extends FakeSession {
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    static canMakePayments(): boolean {
      return canPay;
    }
    constructor(_version: number, request: ApplePayPaymentRequest) {
      super();
      world.requests.push(request);
      world.sessions.push(this);
    }
  }
  (window as { ApplePaySession?: unknown }).ApplePaySession = Session;
  return world;
}

/** The button for {@link ORDER}, its caller's answer scripted. */
function renderButton(options: { accepted?: boolean; validateMerchant?: (validationURL: string) => Promise<unknown> } = {}) {
  const keys: string[] = [];
  const onError = vi.fn();
  render(
    <ApplePayButton
      order={ORDER}
      onAuthorized={async (key) => {
        keys.push(key);
        return options.accepted ?? true;
      }}
      onError={onError}
      validateMerchant={options.validateMerchant}
    />,
  );
  return { keys, onError };
}

describe("ApplePayButton — the gates", () => {
  it("renders Apple's button on a capable device", async () => {
    installApplePay(true);
    renderButton();

    expect(await screen.findByTestId("apple-pay-button")).toBeTruthy();
  });

  it("a device without Apple Pay gets no button", () => {
    // THE FALLBACK, explicit: no ApplePaySession at all (every non-Safari
    // browser). The buyer loses a shortcut, never the ability to pay.
    renderButton();

    // No session to wait on: the button simply never renders.
    return waitFor(() => expect(screen.queryByTestId("apple-pay-button")).toBeNull());
  });

  it("a device that reports canMakePayments false gets no button either", () => {
    installApplePay(false);
    renderButton();

    return waitFor(() => expect(screen.queryByTestId("apple-pay-button")).toBeNull());
  });

  it("a chain head that never declared the wallet is not an Apple Pay store", () => {
    expect(applePayDeclared(appleConfig())).toBe(true);
    expect(applePayDeclared(appleConfig({ wallets: [] }))).toBe(false);
  });
});

describe("ApplePayButton — the session", () => {
  it("offers Visa and Mastercard ONLY — PagBank's processing constraint", async () => {
    const world = installApplePay(true);
    renderButton({ validateMerchant: async () => ({ merchant: "session" }) });

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    // Pinned as the WHOLE list: adding a network PagBank would refuse must
    // fail here, not at the buyer's decline.
    expect(world.requests[0]?.supportedNetworks).toEqual(["visa", "masterCard"]);
    expect(world.requests[0]?.currencyCode).toBe("BRL");
    expect(world.requests[0]?.total.amount).toBe("75.00");
    expect(world.sessions[0]?.begun).toBe(true);
  });

  it("validates the merchant through the host's port and hands over the serialized token", async () => {
    const world = installApplePay(true);
    const validations: string[] = [];
    const { keys } = renderButton({
      validateMerchant: async (url) => {
        validations.push(url);
        return { merchant: "session" };
      },
    });

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    await waitFor(() => expect(keys).toHaveLength(1));
    expect(validations).toEqual(["https://apple.example/validate"]);
    expect(world.sessions[0]?.merchantSessions).toEqual([{ merchant: "session" }]);
    // Apple's token.paymentData, serialized verbatim — PagBank's `key`.
    expect(keys[0]).toBe(JSON.stringify({ data: "opaque", signature: "sig" }));
    // The caller accepted ⇒ the sheet completes SUCCESS.
    await waitFor(() => expect(world.sessions[0]?.completions).toEqual([{ status: 0 }]));
  });

  it("completes the sheet with FAILURE when the caller's charge is refused", async () => {
    const world = installApplePay(true);
    renderButton({ accepted: false, validateMerchant: async () => ({ merchant: "session" }) });

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    await waitFor(() => expect(world.sessions[0]?.completions).toEqual([{ status: 1 }]));
  });

  it("aborts honestly when the host wired no merchant validation", async () => {
    // The external prerequisites (Apple Developer account, Merchant ID,
    // domain verification) are not done, or the host has no validation
    // endpoint yet: the sheet cannot start, and the buyer is told.
    const world = installApplePay(true);
    const { keys, onError } = renderButton();

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    await waitFor(() => expect(world.sessions[0]?.aborted).toBe(true));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(keys).toHaveLength(0);
  });

  it("aborts and reports when merchant validation fails", async () => {
    const world = installApplePay(true);
    const { keys, onError } = renderButton({
      validateMerchant: async () => {
        throw new Error("apple said no");
      },
    });

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    await waitFor(() => expect(world.sessions[0]?.aborted).toBe(true));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(keys).toHaveLength(0);
  });
});

describe("ApplePayButton — with no order yet (FUT-3685)", () => {
  it("is priced from `totalCents` and starts the session inside the click, before any order exists", async () => {
    const world = installApplePay(true);
    const authorized: string[] = [];
    render(
      <ApplePayButton
        totalCents={2200}
        onAuthorized={async (key) => {
          authorized.push(key);
          return true;
        }}
        onError={() => undefined}
        validateMerchant={async () => ({ merchant: "session" })}
      />,
    );
    fireEvent.click(await screen.findByTestId("apple-pay-button"));
    // Synchronous: no await stands between the click and the session.
    expect(world.sessions).toHaveLength(1);
    expect(world.sessions[0]?.begun).toBe(true);
    expect(world.requests[0]?.total.amount).toBe("22.00");
    await waitFor(() => expect(world.sessions[0]?.completions).toEqual([{ status: 0 }]));
    expect(authorized).toEqual([JSON.stringify({ data: "opaque", signature: "sig" })]);
  });
});
