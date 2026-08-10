// @vitest-environment jsdom
/**
 * FUT-472 — the Apple Pay fast lane of the CARD pane.
 *
 * `ApplePaySession` is faked at the seam Safari provides it (the window
 * global), so these drive the real session wiring: feature-detect gates
 * rendering, the payment request pins Visa/Mastercard ONLY (PagBank's
 * constraint — a network the gateway would refuse must never be offered on
 * the sheet), merchant validation goes through the host's port or aborts
 * honestly, and an authorized payment's `token.paymentData` reaches the
 * charge serialized verbatim, with the sheet completed on the charge's real
 * outcome. The card form is the tested fallback in every refusal direction.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok } from "../../../result";
import type { ApplePayPaymentRequest } from "../apple-pay-button";
import { CheckoutClientProvider } from "../client-context";
import type { CheckoutClient } from "../transport";
import type {
  ChargeWalletInput,
  CheckoutOrder,
  CheckoutProviderConfig,
  OrderStatus,
} from "../types";
import { WalletCardPane } from "../wallet-pane";

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
        checkoutScreen: "pix-and-card",
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

/** A bound client whose wallet charges are recorded and scripted. */
function fakeClient(chargeResult?: Awaited<ReturnType<CheckoutClient["chargeWallet"]>>) {
  const walletCharges: ChargeWalletInput[] = [];
  const client: CheckoutClient = {
    getConfig: async () => err("not in this test"),
    getStatus: async () => ok<OrderStatus>("PAID"),
    charge: async () => err("not in this test"),
    chargeWallet: async (input) => {
      walletCharges.push(input);
      return chargeResult ?? ok({ status: "PAID" as OrderStatus });
    },
    listInstruments: async () => [],
    beginVault: async () => err("not in this test"),
    completeVault: async () => err("not in this test"),
    refreshBrowserKey: async () => ok({ publicKey: null }),
  };
  return { client, walletCharges };
}

function renderPane(
  client: CheckoutClient,
  config: CheckoutProviderConfig,
  options: {
    onResolved?: (status: OrderStatus) => void;
    validateMerchant?: (validationURL: string) => Promise<unknown>;
  } = {},
): void {
  render(
    <CheckoutClientProvider client={client}>
      <WalletCardPane
        order={ORDER}
        buyer={{ taxId: "529.982.247-25" }}
        config={config}
        method="CARD"
        onResolved={options.onResolved ?? (() => undefined)}
        pollIntervalMs={5}
        validateApplePayMerchant={options.validateMerchant}
      />
    </CheckoutClientProvider>,
  );
}

describe("ApplePayButton — the gates", () => {
  it("renders Apple's button beside the card form on a capable device", async () => {
    installApplePay(true);
    renderPane(fakeClient().client, appleConfig());

    await screen.findByTestId("apple-pay-button");
    // The card form is the fallback and stays offered next to the wallet.
    expect(screen.getByTestId("card-view")).toBeTruthy();
  });

  it("a device without Apple Pay gets no button — and keeps the card form", async () => {
    // THE FALLBACK, explicit: no ApplePaySession at all (every non-Safari
    // browser). The buyer loses a shortcut, never the ability to pay.
    renderPane(fakeClient().client, appleConfig());

    await screen.findByTestId("card-view");
    await waitFor(() => expect(screen.queryByTestId("apple-pay-button")).toBeNull());
  });

  it("a device that reports canMakePayments false gets no button either", async () => {
    installApplePay(false);
    renderPane(fakeClient().client, appleConfig());

    await screen.findByTestId("card-view");
    await waitFor(() => expect(screen.queryByTestId("apple-pay-button")).toBeNull());
  });

  it("a chain head that never declared the wallet gets no button on a capable device", async () => {
    installApplePay(true);
    renderPane(fakeClient().client, appleConfig({ wallets: [] }));

    await screen.findByTestId("card-view");
    await waitFor(() => expect(screen.queryByTestId("apple-pay-button")).toBeNull());
  });
});

describe("ApplePayButton — the session", () => {
  it("offers Visa and Mastercard ONLY — PagBank's processing constraint", async () => {
    const world = installApplePay(true);
    renderPane(fakeClient().client, appleConfig(), {
      validateMerchant: async () => ({ merchant: "session" }),
    });

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    // Pinned as the WHOLE list: adding a network PagBank would refuse must
    // fail here, not at the buyer's decline.
    expect(world.requests[0]?.supportedNetworks).toEqual(["visa", "masterCard"]);
    expect(world.requests[0]?.currencyCode).toBe("BRL");
    expect(world.requests[0]?.total.amount).toBe("75.00");
    expect(world.sessions[0]?.begun).toBe(true);
  });

  it("validates the merchant through the host's port and charges the serialized token", async () => {
    const world = installApplePay(true);
    const { client, walletCharges } = fakeClient(ok({ status: "PAID" as OrderStatus }));
    const resolved: OrderStatus[] = [];
    const validations: string[] = [];
    renderPane(client, appleConfig(), {
      onResolved: (status) => resolved.push(status),
      validateMerchant: async (url) => {
        validations.push(url);
        return { merchant: "session" };
      },
    });

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    await waitFor(() => expect(walletCharges).toHaveLength(1));
    expect(validations).toEqual(["https://apple.example/validate"]);
    expect(world.sessions[0]?.merchantSessions).toEqual([{ merchant: "session" }]);
    // Apple's token.paymentData, serialized verbatim — PagBank's `key`.
    expect(walletCharges[0]).toEqual({
      orderId: "order-1",
      wallet: { type: "APPLE_PAY", key: JSON.stringify({ data: "opaque", signature: "sig" }) },
      taxId: "529.982.247-25",
    });
    // The charge was accepted ⇒ the sheet completes SUCCESS.
    await waitFor(() => expect(world.sessions[0]?.completions).toEqual([{ status: 0 }]));
    await waitFor(() => expect(resolved).toEqual(["PAID"]));
  });

  it("completes the sheet with FAILURE when the charge is refused", async () => {
    const world = installApplePay(true);
    const { client } = fakeClient(err("Cartão recusado."));
    renderPane(client, appleConfig(), {
      validateMerchant: async () => ({ merchant: "session" }),
    });

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    await waitFor(() => expect(world.sessions[0]?.completions).toEqual([{ status: 1 }]));
    // Back on the form with the refusal shown — she may try again.
    await screen.findByTestId("wallet-error");
    expect(screen.getByTestId("card-view")).toBeTruthy();
  });

  it("aborts honestly when the host wired no merchant validation", async () => {
    // The external prerequisites (Apple Developer account, Merchant ID,
    // domain verification, the CSR→CER round-trip) are not done, or the host
    // has no validation endpoint yet: the sheet cannot start, the buyer is
    // told in pt-BR, and the card form stays the way to pay.
    const world = installApplePay(true);
    const { client, walletCharges } = fakeClient();
    renderPane(client, appleConfig());

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    await waitFor(() => expect(world.sessions[0]?.aborted).toBe(true));
    await screen.findByTestId("wallet-sheet-error");
    expect(walletCharges).toHaveLength(0);
    expect(screen.getByTestId("card-view")).toBeTruthy();
  });

  it("aborts and reports when merchant validation fails", async () => {
    const world = installApplePay(true);
    const { client, walletCharges } = fakeClient();
    renderPane(client, appleConfig(), {
      validateMerchant: async () => {
        throw new Error("apple said no");
      },
    });

    fireEvent.click(await screen.findByTestId("apple-pay-button"));

    await waitFor(() => expect(world.sessions[0]?.aborted).toBe(true));
    await screen.findByTestId("wallet-sheet-error");
    expect(walletCharges).toHaveLength(0);
  });
});
