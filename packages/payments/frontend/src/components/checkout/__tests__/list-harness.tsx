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
import type {
  BuyerInfo,
  CheckoutCustomerField,
  CheckoutOrder,
  CheckoutProviderConfig,
  CreateOrderRequest,
  CreateOrderResult,
  PaymentMethod,
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
  buyer?: BuyerInfo;
  navigate?: (url: string) => void;
  orderNote?: ReactNode;
}

export function listFlow(host: ListHost): JSX.Element {
  const createOrder =
    host.createOrder ?? (async (input: CreateOrderRequest): Promise<CreateOrderResult> => ({ ok: true, data: orderFor(input.method) }));
  return (
    <CheckoutClientProvider client={host.client as unknown as CheckoutClient}>
      <CheckoutNavigateProvider navigate={host.navigate ?? vi.fn()}>
        <CheckoutFlow
          copy={PT_BR_CHECKOUT_VIEW_COPY}
          cart={{ empty: false, totalLabel: "R$ 27,00", totalItems: 2, orderNote: host.orderNote }}
          createOrder={createOrder}
          onExitToMenu={vi.fn()}
          providerConfig={host.config}
          tenantSlug="loja-1"
          taxIdOnFile={host.taxIdOnFile ?? true}
          defaultBuyer={host.buyer ?? { name: "Ana Teste" }}
          paymentList={{ copy: PT_BR_PAYMENT_LIST_COPY, ...host.list }}
        />
      </CheckoutNavigateProvider>
    </CheckoutClientProvider>
  );
}

export function renderList(host: ListHost) {
  return render(listFlow(host));
}
