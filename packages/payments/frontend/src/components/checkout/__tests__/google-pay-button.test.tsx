// @vitest-environment jsdom
/**
 * FUT-471 — the Google Pay fast lane of the CARD pane.
 *
 * The pay.js surface is faked at the same seam the real page uses (the
 * `google.payments.api` global), so these drive the four steps of Google's
 * guide in order: `isReadyToPay` gates rendering, `createButton` supplies the
 * element, `loadPaymentData` yields the token, and the token reaches the
 * charge call with the buyer's CPF. The charge itself goes through a fake
 * `CheckoutClient`, which is the seam the wire contract suite pins from both
 * ends.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { err, ok } from "../../../result";
import { CheckoutClientProvider } from "../client-context";
import { UNRESOLVED_CODE } from "../failure-codes";
import type { GooglePayApi } from "../google-pay-button";
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
  token?: string;
  rejectWith?: unknown;
}

/** The pay.js surface, recorded: environments, load requests, all of it. */
function installFakeApi(options: FakeApiOptions = {}) {
  const calls = {
    environments: [] as string[],
    loadRequests: [] as Record<string, unknown>[],
  };
  class PaymentsClient {
    constructor(clientOptions: { environment: "TEST" | "PRODUCTION" }) {
      calls.environments.push(clientOptions.environment);
    }
    async isReadyToPay(): Promise<{ result: boolean }> {
      return { result: options.ready ?? true };
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

interface FakeClientOptions {
  chargeResult?: Awaited<ReturnType<CheckoutClient["chargeWallet"]>>;
  statusResult?: OrderStatus;
}

/** A bound client whose wallet charges are recorded and scripted. */
function fakeClient(options: FakeClientOptions = {}) {
  const walletCharges: ChargeWalletInput[] = [];
  const client: CheckoutClient = {
    getConfig: async () => err("not in this test"),
    getStatus: async () => ok<OrderStatus>(options.statusResult ?? "PAID"),
    charge: async () => err("not in this test"),
    chargeWallet: async (input) => {
      walletCharges.push(input);
      return options.chargeResult ?? ok({ status: "AWAITING_PAYMENT" as OrderStatus });
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
  onResolved: (status: OrderStatus) => void = () => undefined,
): void {
  render(
    <CheckoutClientProvider client={client}>
      <WalletCardPane
        order={ORDER}
        buyer={{ taxId: "529.982.247-25" }}
        config={config}
        method="CARD"
        onResolved={onResolved}
        pollIntervalMs={5}
      />
    </CheckoutClientProvider>,
  );
}

describe("GooglePayButton — the four steps gate rendering", () => {
  it("renders Google's button beside the card form once isReadyToPay approves", async () => {
    const calls = installFakeApi({ ready: true });
    renderPane(fakeClient().client, walletConfig());

    await screen.findByTestId("google-pay-native");
    expect(screen.getByTestId("google-pay-button")).toBeTruthy();
    // The card form is the fallback and stays offered next to the wallet.
    expect(screen.getByTestId("card-view")).toBeTruthy();
    // Production requires Google's external registration; TEST is the default.
    expect(calls.environments).toEqual(["TEST"]);
  });

  it("renders no button when isReadyToPay refuses this browser", async () => {
    installFakeApi({ ready: false });
    renderPane(fakeClient().client, walletConfig());

    await screen.findByTestId("card-view");
    await waitFor(() => expect(screen.queryByTestId("google-pay-button")).toBeNull());
  });

  it("renders no button for a chain head that never declared the wallet", async () => {
    installFakeApi({ ready: true });
    renderPane(fakeClient().client, walletConfig({ wallets: [], googlePay: null }));

    await screen.findByTestId("card-view");
    await waitFor(() => expect(screen.queryByTestId("google-pay-button")).toBeNull());
  });

  it("renders no button when the connection carries no gatewayMerchantId", async () => {
    // A token minted against a missing merchant id charges nobody — fail
    // CLOSED, unlike the picker's fail-open method reads.
    installFakeApi({ ready: true });
    renderPane(
      fakeClient().client,
      walletConfig({ googlePay: { gateway: "pagbank", gatewayMerchantId: null } }),
    );

    await screen.findByTestId("card-view");
    await waitFor(() => expect(screen.queryByTestId("google-pay-button")).toBeNull());
  });
});

describe("GooglePayButton — the token becomes the charge", () => {
  it("charges the wallet key with the buyer's CPF and the published gateway params", async () => {
    const calls = installFakeApi({ token: "gp_tok_42" });
    const { client, walletCharges } = fakeClient({
      chargeResult: ok({ status: "FAILED" as OrderStatus }),
    });
    const resolved: OrderStatus[] = [];
    renderPane(client, walletConfig(), (status) => resolved.push(status));

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    await waitFor(() => expect(walletCharges).toHaveLength(1));
    expect(walletCharges[0]).toEqual({
      orderId: "order-1",
      wallet: { type: "GOOGLE_PAY", key: "gp_tok_42" },
      taxId: "529.982.247-25",
    });
    // The tokenizationSpecification came from the chain head, not a literal.
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
    // A business outcome (decline → FAILED) resolves the step immediately.
    await waitFor(() => expect(resolved).toEqual(["FAILED"]));
  });

  it("an accepted charge polls to confirmation, with every pay control gone", async () => {
    installFakeApi({});
    const { client } = fakeClient({
      chargeResult: ok({ status: "AWAITING_PAYMENT" as OrderStatus }),
      statusResult: "PAID",
    });
    const resolved: OrderStatus[] = [];
    renderPane(client, walletConfig(), (status) => resolved.push(status));

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    // While confirming, neither the wallet button nor the card form may offer
    // a second payment.
    await waitFor(() => expect(screen.queryByTestId("card-view")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("google-pay-button")).toBeNull());
    await waitFor(() => expect(resolved).toEqual(["PAID"]));
  });

  it("an unresolved refusal removes every pay control and warns, not blames", async () => {
    installFakeApi({});
    const { client } = fakeClient({
      chargeResult: err("Estamos confirmando seu pagamento.", UNRESOLVED_CODE),
    });
    renderPane(client, walletConfig());

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    await screen.findByTestId("wallet-unresolved");
    await waitFor(() => expect(screen.queryByTestId("card-view")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("google-pay-button")).toBeNull());
  });

  it("a refused charge returns to the form with the refusal shown", async () => {
    installFakeApi({});
    const { client } = fakeClient({ chargeResult: err("Cartão recusado.") });
    renderPane(client, walletConfig());

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    await screen.findByTestId("wallet-error");
    // Not unresolved — the buyer may try again, so the controls stay.
    expect(screen.getByTestId("card-view")).toBeTruthy();
    expect(screen.getByTestId("google-pay-button")).toBeTruthy();
  });

  it("a dismissed sheet charges nothing and says nothing", async () => {
    installFakeApi({ rejectWith: { statusCode: "CANCELED" } });
    const { client, walletCharges } = fakeClient();
    renderPane(client, walletConfig());

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    // Closing the sheet is a choice, not a failure to report.
    await screen.findByTestId("card-view");
    expect(walletCharges).toHaveLength(0);
    await waitFor(() => expect(screen.queryByTestId("wallet-sheet-error")).toBeNull());
    await waitFor(() => expect(screen.queryByTestId("wallet-error")).toBeNull());
  });

  it("a sheet failure is reported while the card form stays usable", async () => {
    installFakeApi({ rejectWith: { statusCode: "DEVELOPER_ERROR" } });
    const { client, walletCharges } = fakeClient();
    renderPane(client, walletConfig());

    fireEvent.click(await screen.findByTestId("google-pay-native"));

    await screen.findByTestId("wallet-sheet-error");
    expect(walletCharges).toHaveLength(0);
    expect(screen.getByTestId("card-view")).toBeTruthy();
  });
});
