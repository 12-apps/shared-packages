import {
  createMemoryAttemptLedger,
  createMemoryChargeStore,
  createMemoryCredentialStore,
  createMemoryProviderConfigStore,
  createMemoryWebhookInbox,
  createPaymentFlowsBE,
  createPaymentsGateway,
  defineProviders,
  type ChargeInput,
  type ChargeSnapshot,
  type CheckoutCopy,
  type MerchantRef,
  type Payable,
  type PaymentProviderAdapter,
} from "@12-apps/payments-backend";
import { afterEach, describe, expect, it, vi } from "vitest";

import { chargeWallet } from "../client";

/**
 * THE WALLET WIRE, DRIVEN FROM BOTH ENDS (FUT-471) — `charge-wire.contract`'s
 * sibling for the wallet body. The published `chargeWallet` posts the flat
 * `{ orderId, wallet: { type, key }, taxId }` shape; this proves the real
 * mount reads it, the walk honours the wallet capability, and the provider
 * receives `card.wallet` verbatim — nothing built by hand on either side.
 */

const MERCHANT: MerchantRef = { kind: "TENANT", id: "merchant-1" };
const REF = "inv_2024_0044";
const BRL = (amountCents: number): { amountCents: number; currency: string } => ({
  amountCents,
  currency: "BRL",
});

/** The smallest wallet-capable adapter. No vendor named anywhere in it. */
function adapter(name: string, seen: ChargeInput[]): PaymentProviderAdapter {
  return {
    name,
    displayName: name,
    capabilities: {
      methods: ["PIX", "CARD"],
      wallets: ["GOOGLE_PAY", "APPLE_PAY"],
      savedCards: true,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: "PUBLIC_KEY",
    },
    customerSchema: [{ key: "taxId", type: "CPF", required: true }],
    credentialSchema: [{ key: "secretKey", label: "Secret", secret: true, required: true }],
    async verifyCredentials() {
      return { ok: true };
    },
    async createCharge(input) {
      seen.push(input);
      const snapshot: ChargeSnapshot = {
        provider: name,
        providerChargeId: `stub_${name}_${input.reference}`,
        reference: input.reference,
        status: "PAID",
        amount: input.amount,
        method: input.method,
      };
      return snapshot;
    },
    async getCharge(providerChargeId) {
      return {
        provider: name,
        providerChargeId,
        status: "PENDING",
        amount: BRL(0),
        method: "CARD",
      };
    },
    webhook: {
      async verify() {
        return true;
      },
      async parse() {
        return [];
      },
    },
    clientConfig: () => ({ provider: name, tokenization: "PUBLIC_KEY" }),
  };
}

/** Machine-readable sentinels — the RULE is under test, never the prose. */
const copy: CheckoutCopy = {
  notConfigured: "notConfigured",
  chainExhausted: (method) => `chainExhausted.${method}`,
  unresolvedCharge: "unresolvedCharge",
  chargeMismatch: "chargeMismatch",
  instrumentNotUsableHere: "instrumentNotUsableHere",
  payableNotFound: "payableNotFound",
  buyerFieldMissing: (fields) => `missing.${[...fields].join("+")}`,
  buyerFieldInvalid: (field) => `invalid.${field}`,
  fieldNameOf: (field) => (field === "taxId" ? "cpf" : field),
  genericProviderRefusal: "generic",
};

/** A mount, plus a `fetch` that routes `/api/checkout/**` straight into it. */
function mountBehindFetch() {
  const seen: ChargeInput[] = [];
  const credentials = createMemoryCredentialStore();
  const charges = createMemoryChargeStore();
  const gateway = createPaymentsGateway({
    providers: defineProviders({ alpha: adapter("alpha", seen) }),
    credentials,
    charges,
    webhooks: createMemoryWebhookInbox(),
    attempts: createMemoryAttemptLedger(),
    onWebhookEvent: async () => undefined,
  });
  credentials.set(MERCHANT, "alpha", { environment: "SANDBOX", fields: {}, stub: false });

  const world = {
    payable: {
      ref: REF,
      merchant: MERCHANT,
      amount: BRL(7500),
      method: "CARD",
      customer: { name: "Ana Buyer", email: "ana@example.com" },
      state: "OPEN",
    } satisfies Payable as Payable,
  };

  const routes = createPaymentFlowsBE<{ id: string }, { invoice: string }>({
    gateway,
    charges,
    credentials,
    connections: createMemoryProviderConfigStore(),
    requireAuth: () => ({ id: "buyer-1" }),
    resolveMerchant: () => MERCHANT,
    payables: {
      load: async (_caller, ref) => (ref === REF ? world.payable : null),
      create: async () => ({ payable: world.payable, view: { invoice: REF } }),
      view: async () => ({ invoice: REF }),
      stateToken: (payable) => (payable.state === "OPEN" ? "AWAITING_PAYMENT" : "PAID"),
    },
    correlation: {
      attachPending: async () => undefined,
      recordCardOutcome: async ({ approved }) => (approved ? "PAID" : "FAILED"),
      settle: async () => "PAID",
    },
    copy,
  });

  const fetchShim = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const target = String(input);
    const [pathname = "", query] = target.replace("/api/checkout", "").split("?");
    const url = `https://shop.example/api/checkout${pathname}${query ? `?${query}` : ""}`;
    const request = new Request(url, init as RequestInit);
    const context = { params: { segments: pathname.split("/").filter(Boolean) } };
    const verb = (init?.method ?? "GET") as "GET" | "POST";
    return routes[verb](request, context);
  };

  return { seen, fetchShim };
}

describe("@12-apps/payments-frontend's chargeWallet against createPaymentFlowsBE", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets the wallet key and the buyer's CPF to the provider, and nothing else", async () => {
    const { seen, fetchShim } = mountBehindFetch();
    vi.stubGlobal("fetch", fetchShim);

    const charged = await chargeWallet({
      orderId: REF,
      wallet: { type: "GOOGLE_PAY", key: "gp_tok_from_the_sheet" },
      taxId: "12345678909",
    });

    expect(charged.ok).toBe(true);
    expect(charged.ok && charged.data.status).toBe("PAID");

    // The wallet reached the provider as the ONE instrument of the charge.
    expect(seen[0]?.card?.wallet).toEqual({ type: "GOOGLE_PAY", key: "gp_tok_from_the_sheet" });
    expect(seen[0]?.card?.token).toBeUndefined();
    expect(seen[0]?.card?.savedCardToken).toBeUndefined();
    // And so did the CPF the wallet sheet never asks for — collected on Dados,
    // carried by the charge, demanded by the provider's schema.
    expect(seen[0]?.customer).toEqual({
      name: "Ana Buyer",
      email: "ana@example.com",
      taxId: "12345678909",
    });
  });

  it("carries an Apple Pay key through the same wire, serialized verbatim (FUT-472)", async () => {
    const { seen, fetchShim } = mountBehindFetch();
    vi.stubGlobal("fetch", fetchShim);
    const paymentData = JSON.stringify({ data: "opaque", header: {}, signature: "sig" });

    const charged = await chargeWallet({
      orderId: REF,
      wallet: { type: "APPLE_PAY", key: paymentData },
      taxId: "12345678909",
    });

    expect(charged.ok).toBe(true);
    expect(seen[0]?.card?.wallet).toEqual({ type: "APPLE_PAY", key: paymentData });
  });

  it("refuses, naming the field, when the buyer sent no CPF", async () => {
    const { seen, fetchShim } = mountBehindFetch();
    vi.stubGlobal("fetch", fetchShim);

    const charged = await chargeWallet({
      orderId: REF,
      wallet: { type: "GOOGLE_PAY", key: "gp_tok" },
    });

    expect(charged.ok).toBe(false);
    expect(!charged.ok && charged.code).toBe("MISSING_BUYER_FIELD");
    // Nothing was sent anywhere, so this is not a decline and not an outage.
    expect(seen).toEqual([]);
  });
});
