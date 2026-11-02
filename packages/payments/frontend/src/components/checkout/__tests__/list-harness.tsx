/**
 * A host for the one-list Pagamento step (FUT-3591/3592): `<CheckoutFlow
 * paymentList>` against a stubbed client, so the suites drive the real
 * controller, the real list and the real card path.
 */
import type { JSX, ReactNode } from "react";
import { vi } from "vitest";

import { render } from "@testing-library/react";

import { CheckoutClientProvider } from "../client-context";
import { CheckoutFlow } from "../checkout-flow";
import type { CheckoutPaymentList } from "../list/types";
import { PT_BR_PAYMENT_LIST_COPY } from "../list/pt-BR";
import { CheckoutNavigateProvider } from "../navigate-context";
import { PT_BR_CHECKOUT_VIEW_COPY } from "../pt-BR";
import type { CheckoutClient } from "../transport";
import type { CheckoutComponents } from "../ui";
import type {
  BuyerInfo,
  CheckoutCustomerField,
  CheckoutOrder,
  CheckoutProviderConfig,
  CreateOrderRequest,
  CreateOrderResult,
  PaymentMethod,
  SettlementCheckout,
} from "../types";

export const SAVED_VISA = { id: "vault-1", brand: "Visa", last4: "4242", expMonth: 11, expYear: 2032, holder: "ANA TESTE" };
export const SAVED_MASTER = { id: "vault-2", brand: "Mastercard", last4: "5454", expMonth: 1, expYear: 2031, holder: "ANA TESTE" };

/** A raised order, as the host's `createOrder` answers it. */
export function orderFor(method: PaymentMethod, extra: Partial<CheckoutOrder> = {}): CheckoutOrder {
  return {
    orderId: `o-${method.toLowerCase()}`,
    status: "AWAITING_PAYMENT",
    method,
    totalCents: 2700,
    subtotalCents: 2700,
    discountTotalCents: 0,
    appliedDiscounts: [],
    totalLabel: "R$ 27,00",
    ...(method === "PIX" ? { pix: { copyPaste: "00020126BR.GOV.BCB.PIX.o-pix", expiresAt: "2099-01-01T18:42:00.000Z" } } : {}),
    ...extra,
  };
}

const CPF_REQUIRED: CheckoutCustomerField[] = [{ key: "taxId", type: "CPF", required: true }];

/**
 * A store that takes Pix and the card on OUR page, named "PagBank" to the buyer
 * but minting through stub mode: a provider id no tokenizer knows, no key, and
 * the server's `mockTokenization` grant — so a typed card mints a fake token
 * here instead of loading a vendor SDK.
 */
export function onPageStore(options: { methods?: PaymentMethod[]; customerSchema?: CheckoutCustomerField[] } = {}): CheckoutProviderConfig {
  const methods = options.methods ?? ["PIX", "CARD"];
  return {
    provider: "stubpay",
    tokenization: "PUBLIC_KEY",
    publicKey: null,
    mockTokenization: true,
    methods,
    chain: [
      {
        provider: "stubpay",
        displayName: "PagBank",
        tokenization: "PUBLIC_KEY",
        publicKey: null,
        mockTokenization: true,
        methods,
        checkoutScreen: "pix-and-card",
        customerSchema: options.customerSchema ?? CPF_REQUIRED,
      },
    ],
  };
}

/** A store that finishes on the provider's own page (InfinitePay's shape). */
export function handOffStore(): CheckoutProviderConfig {
  return {
    provider: "infinitepay",
    tokenization: "REDIRECT",
    publicKey: null,
    mockTokenization: false,
    methods: ["PIX", "CARD"],
    chain: [
      {
        provider: "infinitepay",
        displayName: "InfinitePay",
        tokenization: "REDIRECT",
        publicKey: null,
        mockTokenization: false,
        methods: ["PIX", "CARD"],
        checkoutScreen: "hosted-link",
        customerSchema: [{ key: "phone", type: "MOBILE", required: true }],
      },
    ],
  };
}

/**
 * {@link onPageStore} whose chain head declares the wallets (FUT-3685):
 * Google Pay with its gateway parameters, Apple Pay, or both.
 */
export function walletStore(wallets: ("GOOGLE_PAY" | "APPLE_PAY")[] = ["GOOGLE_PAY"], options: Parameters<typeof onPageStore>[0] = {}): CheckoutProviderConfig {
  const base = onPageStore(options);
  const head = base.chain?.[0];
  if (!head) throw new Error("the store has a chain head");
  const google = wallets.includes("GOOGLE_PAY") ? { googlePay: { gateway: "pagbank", gatewayMerchantId: "MID_1" } } : {};
  return { ...base, chain: [{ ...head, wallets, ...google }] };
}

/** Google's `google.payments.api`, installed the way pay.js would; its button calls the press it was built with. */
export function installGoogle(load: () => Promise<unknown> = async () => ({ paymentMethodData: { tokenizationData: { token: "gpay-key" } } })) {
  const loadPaymentData = vi.fn(load);
  const createButton = vi.fn(({ onClick }: { onClick: () => void }) => {
    const button = document.createElement("button");
    button.setAttribute("data-testid", "google-pay-native");
    button.textContent = "Pagar com Google Pay";
    button.addEventListener("click", onClick);
    return button;
  });
  class PaymentsClient {
    isReadyToPay = async () => ({ result: true });
    createButton = createButton;
    loadPaymentData = loadPaymentData;
  }
  (window as { google?: unknown }).google = { payments: { api: { PaymentsClient } } };
  return { loadPaymentData, createButton };
}

/** One `ApplePaySession` the button started, as the test drives it. */
interface StubAppleSession {
  request: { total: { amount: string } };
  begun: boolean;
  aborted: boolean;
  completed: number[];
  onvalidatemerchant: ((event: { validationURL: string }) => void) | null;
  onpaymentauthorized: ((event: { payment: { token: { paymentData: unknown } } }) => void) | null;
  oncancel: (() => void) | null;
}

/** Safari's `ApplePaySession`, installed on `window`; every session it makes is recorded in order. */
export function installApple(canPay = true): { sessions: StubAppleSession[] } {
  const sessions: StubAppleSession[] = [];
  class ApplePaySession {
    static STATUS_SUCCESS = 0;
    static STATUS_FAILURE = 1;
    static canMakePayments = () => canPay;
    request: { total: { amount: string } };
    begun = false;
    aborted = false;
    completed: number[] = [];
    onvalidatemerchant: StubAppleSession["onvalidatemerchant"] = null;
    onpaymentauthorized: StubAppleSession["onpaymentauthorized"] = null;
    oncancel: StubAppleSession["oncancel"] = null;
    constructor(_version: number, request: { total: { amount: string } }) {
      this.request = request;
      sessions.push(this);
    }
    begin() {
      this.begun = true;
    }
    abort() {
      this.aborted = true;
    }
    completeMerchantValidation() {}
    completePayment(result: { status: number }) {
      this.completed.push(result.status);
    }
  }
  (window as { ApplePaySession?: unknown }).ApplePaySession = ApplePaySession;
  return { sessions };
}

/** Take both wallets' globals away again. */
export function uninstallWallets(): void {
  delete (window as { google?: unknown }).google;
  delete (window as { ApplePaySession?: unknown }).ApplePaySession;
}

/** The wire, stubbed: every call recorded, every answer settable per test. */
export function stubClient(saved: (typeof SAVED_VISA)[] = []) {
  const client = {
    getConfig: vi.fn(),
    getStatus: vi.fn(async () => ({ ok: true as const, data: "AWAITING_PAYMENT" as const })),
    charge: vi.fn(async () => ({ ok: true as const, data: { status: "PAID" as const } })),
    chargeWallet: vi.fn(),
    listInstruments: vi.fn(async () => saved),
    releaseCheckout: vi.fn(),
    beginVault: vi.fn(),
    completeVault: vi.fn(),
    refreshBrowserKey: vi.fn(async () => ({ ok: true as const, data: { publicKey: "pk_test" } })),
  };
  return client;
}

interface ListHost {
  config: CheckoutProviderConfig;
  client: ReturnType<typeof stubClient>;
  createOrder?: (input: CreateOrderRequest) => Promise<CreateOrderResult>;
  list?: Partial<CheckoutPaymentList>;
  taxIdOnFile?: boolean;
  taxIdKindOnFile?: "CPF" | "CNPJ" | null;
  buyer?: BuyerInfo;
  navigate?: (url: string) => void;
  orderNote?: ReactNode;
  saveBuyerContact?: (contact: { name?: string; phone?: string; taxId?: string }) => void;
  /** The cart's total as the host shows it; defaults to "R$ 27,00". */
  cartTotal?: string;
  /** The basket signature, so a suite can change the cart under a raised order. */
  basket?: string;
  /** The host's Apple Pay merchant-validation port. */
  validateApplePayMerchant?: (validationURL: string) => Promise<unknown>;
  /** The cart's lines and money rows, for the computer's summary column. */
  lines?: { key: string; quantity: number; name: string; totalLabel: string }[];
  discountLines?: ReactNode;
  /** The host's slots — a suite fills `lazy` to hold or watch the list's deferred parts. */
  components?: Partial<CheckoutComponents>;
  /** A ready total the checkout settles instead of the cart's (a comanda's conta). */
  settlement?: SettlementCheckout;
  /** The host's "the order settled PAID" port. */
  onPaid?: () => void;
  /** `CheckoutFlow`'s `parkHostedOrders`; absent ⇒ the prop is not passed at all. */
  parkHostedOrders?: boolean;
}

export function listFlow(host: ListHost): JSX.Element {
  const createOrder =
    host.createOrder ?? (async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));
  return (
    <CheckoutClientProvider client={host.client as unknown as CheckoutClient}>
      <CheckoutNavigateProvider navigate={host.navigate ?? vi.fn()}>
        <CheckoutFlow
          copy={PT_BR_CHECKOUT_VIEW_COPY}
          cart={{
            empty: false,
            totalLabel: host.cartTotal ?? "R$ 27,00",
            totalItems: 2,
            orderNote: host.orderNote,
            lines: host.lines,
            discountLines: host.discountLines,
            ...(host.basket ? { identity: { signature: host.basket, ready: true } } : {}),
          }}
          saveBuyerContact={host.saveBuyerContact}
          createOrder={createOrder}
          onExitToMenu={vi.fn()}
          onPaid={host.onPaid}
          providerConfig={host.config}
          tenantSlug="loja-1"
          taxIdOnFile={host.taxIdOnFile ?? true}
          taxIdKindOnFile={host.taxIdKindOnFile}
          validateApplePayMerchant={host.validateApplePayMerchant}
          defaultBuyer={host.buyer ?? { name: "Ana Teste" }}
          paymentList={{ copy: PT_BR_PAYMENT_LIST_COPY, ...host.list }}
          components={host.components}
          settlement={host.settlement}
          {...(host.parkHostedOrders === undefined ? {} : { parkHostedOrders: host.parkHostedOrders })}
        />
      </CheckoutNavigateProvider>
    </CheckoutClientProvider>
  );
}

export function renderList(host: ListHost) {
  return render(listFlow(host));
}
