// @vitest-environment jsdom
/**
 * FUT-471 — the Google Pay button, on its own.
 *
 * The pay.js surface is faked at the same seam the real page uses (the
 * `google.payments.api` global), so these drive the four steps of Google's
 * guide in order: `isReadyToPay` gates rendering, `createButton` supplies the
 * element, `loadPaymentData` yields the token, and the token is handed to the
 * caller. What the caller does with it — the one list's charge — is pinned in
 * `payment-list-wallet.test.tsx`.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "./test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GooglePayButton, paymentDataRequest, useGooglePayClient, type GooglePayApi, type GooglePaymentsClient } from "../google-pay-button";
import { googlePayConfig } from "../method-capability";
import type { CheckoutOrder, CheckoutProviderConfig } from "../types";

afterEach(() => {
  cleanup();
  delete (window as { google?: unknown }).google;
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

/** A chain whose head declares Google Pay, parameters and all. */
function walletConfig(overrides: Record<string, unknown> = {}): CheckoutProviderConfig {
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
        wallets: ["GOOGLE_PAY"],
        googlePay: { gateway: "pagbank", gatewayMerchantId: "MID_1" },
        checkoutScreen: "pix-and-card",
        ...overrides,
      },
    ],
  };
}

interface FakeApiOptions {
  ready?: boolean;
  /** Google's `paymentMethodPresent`; absent from the answer when omitted. */
  present?: boolean;
  token?: string;
  rejectWith?: unknown;
}

/** The pay.js surface, recorded: environments, load requests, all of it. */
function installFakeApi(options: FakeApiOptions = {}) {
  const calls = {
    environments: [] as string[],
    loadRequests: [] as Record<string, unknown>[],
    readyRequests: [] as Record<string, unknown>[],
  };
  class PaymentsClient {
    constructor(clientOptions: { environment: "TEST" | "PRODUCTION" }) {
      calls.environments.push(clientOptions.environment);
    }
    async isReadyToPay(request: Record<string, unknown>): Promise<{ result: boolean; paymentMethodPresent?: boolean }> {
      calls.readyRequests.push(request);
      return { result: options.ready ?? true, ...(options.present === undefined ? {} : { paymentMethodPresent: options.present }) };
    }
    createButton({ onClick }: { onClick: () => void }): HTMLElement {
      const button = document.createElement("button");
      button.textContent = "Pagar com Google Pay";
      button.setAttribute("data-testid", "google-pay-native");
      button.addEventListener("click", onClick);
      return button;
    }
    async loadPaymentData(request: Record<string, unknown>) {
      calls.loadRequests.push(request);
      if (options.rejectWith !== undefined) throw options.rejectWith;
      return {
        paymentMethodData: { tokenizationData: { token: options.token ?? "gp_tok" } },
      };
    }
  }
  (window as { google?: unknown }).google = {
    payments: { api: { PaymentsClient } satisfies GooglePayApi },
  };
  return calls;
}

const PARAMS = { gateway: "pagbank", gatewayMerchantId: "MID_1" };

function renderButton() {
  const onKey = vi.fn();
  const onError = vi.fn();
  render(<GooglePayButton order={ORDER} params={PARAMS} onKey={onKey} onError={onError} />);
  return { onKey, onError };
}

describe("GooglePayButton — the four steps gate rendering", () => {
  it("renders Google's button once isReadyToPay approves", async () => {
    const calls = installFakeApi({ ready: true });
    renderButton();

    await screen.findByTestId("google-pay-native");
    expect(screen.getByTestId("google-pay-button")).toBeTruthy();
    // Production requires Google's external registration; TEST is the default.
    expect(calls.environments).toEqual(["TEST"]);
  });

  it("renders no button when isReadyToPay refuses this browser", async () => {
    const calls = installFakeApi({ ready: false });
    renderButton();

    await waitFor(() => expect(calls.environments).toEqual(["TEST"]));
    await waitFor(() => expect(screen.queryByTestId("google-pay-button")).toBeNull());
  });
});

describe("GooglePayButton — only buyers who can actually pay (FUT-4399)", () => {
  const renderIn = (environment: "TEST" | "PRODUCTION") =>
    render(<GooglePayButton order={ORDER} params={PARAMS} onKey={vi.fn()} onError={vi.fn()} environment={environment} />);

  it("asks for an existing payment method in PRODUCTION, and draws for a buyer who has one", async () => {
    const calls = installFakeApi({ present: true });
    renderIn("PRODUCTION");
    await screen.findByTestId("google-pay-native");
    expect(calls.readyRequests[0]).toMatchObject({ existingPaymentMethodRequired: true });
  });

  it("draws nothing in PRODUCTION when the buyer has no card in Google Pay", async () => {
    const calls = installFakeApi({ present: false });
    renderIn("PRODUCTION");
    await waitFor(() => expect(calls.readyRequests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("google-pay-button")).toBeNull());
  });

  it("draws nothing in PRODUCTION when Google's answer carries no paymentMethodPresent", async () => {
    const calls = installFakeApi({});
    renderIn("PRODUCTION");
    await waitFor(() => expect(calls.readyRequests).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId("google-pay-button")).toBeNull());
  });

  it("changes nothing in TEST: the bare probe, and the button draws on result alone", async () => {
    const calls = installFakeApi({ present: false });
    renderIn("TEST");
    await screen.findByTestId("google-pay-native");
    expect(calls.readyRequests[0]).not.toHaveProperty("existingPaymentMethodRequired");
  });
});

describe("googlePayConfig — the store's half of the gate, fail-closed", () => {
  it("publishes the head's parameters when it declares the wallet", () => {
    expect(googlePayConfig(walletConfig())).toMatchObject(PARAMS);
  });

  it("is null for a chain head that never declared the wallet", () => {
    expect(googlePayConfig(walletConfig({ wallets: [], googlePay: null }))).toBeNull();
  });

  it("is null when the connection carries no gatewayMerchantId", () => {
    // A token minted against a missing merchant id charges nobody.
    expect(googlePayConfig(walletConfig({ googlePay: { gateway: "pagbank", gatewayMerchantId: null } }))).toBeNull();
  });
});

describe("GooglePayButton — the sheet's answer", () => {
  it("hands over the token, from a request built on the published gateway params", async () => {
    const calls = installFakeApi({ token: "gp_tok_42" });
    const { onKey, onError } = renderButton();

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    await waitFor(() => expect(onKey).toHaveBeenCalledWith("gp_tok_42"));
    expect(onError).not.toHaveBeenCalled();
    expect(calls.loadRequests[0]).toMatchObject({
      allowedPaymentMethods: [
        {
          type: "CARD",
          tokenizationSpecification: {
            type: "PAYMENT_GATEWAY",
            parameters: { gateway: "pagbank", gatewayMerchantId: "MID_1" },
          },
        },
      ],
      transactionInfo: { totalPrice: "75.00", currencyCode: "BRL", totalPriceStatus: "FINAL" },
    });
  });

  it("a dismissed sheet hands over nothing and says nothing", async () => {
    const calls = installFakeApi({ rejectWith: { statusCode: "CANCELED" } });
    const { onKey, onError } = renderButton();

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    // Closing the sheet is a choice, not a failure to report.
    await waitFor(() => expect(calls.loadRequests).toHaveLength(1));
    await waitFor(() => expect(onError).not.toHaveBeenCalled());
    expect(onKey).not.toHaveBeenCalled();
  });

  it("a sheet failure is reported", async () => {
    installFakeApi({ rejectWith: { statusCode: "DEVELOPER_ERROR" } });
    const { onKey, onError } = renderButton();

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onKey).not.toHaveBeenCalled();
  });
});

describe("paymentDataRequest — Google's own merchant id", () => {
  it("sends merchantInfo when the platform configured one, as Google requires in PRODUCTION", () => {
    const request = paymentDataRequest(
      { gateway: "pagbank", gatewayMerchantId: "ACCO_1", merchantInfo: { merchantId: "BCR2DN_1", merchantName: "Paladira" } },
      { totalCents: 1250 },
    );
    expect(request.merchantInfo).toEqual({ merchantId: "BCR2DN_1", merchantName: "Paladira" });
  });

  it("sends none in TEST without one", () => {
    expect(paymentDataRequest({ gateway: "pagbank", gatewayMerchantId: "ACCO_1" }, { totalCents: 1250 })).not.toHaveProperty("merchantInfo");
  });
});

describe("the homologação evidence keeps the bare probe in PRODUCTION (FUT-4399)", () => {
  it("sends no existingPaymentMethodRequired and draws without paymentMethodPresent", async () => {
    const calls = installFakeApi({});
    let seen: GooglePaymentsClient | null = null;
    function Probe() {
      seen = useGooglePayClient(undefined, "PRODUCTION");
      return null;
    }
    render(<Probe />);
    await waitFor(() => expect(seen).not.toBeNull());
    expect(calls.readyRequests[0]).not.toHaveProperty("existingPaymentMethodRequired");
  });
});
