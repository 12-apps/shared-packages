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

import { chargeCard } from "../client";

/**
 * THE WIRE, DRIVEN FROM BOTH ENDS (FUT-740).
 *
 * `createPaymentFlowsBE` is the backend every host is being asked to delete its
 * own checkout routes in favour of, and THIS package's `chargeCard` is what is
 * already running in buyers' browsers. Each half has its own suites and each
 * passed while the pair did not speak: the mount read the instrument out of a
 * nested `card` block, `chargeCard` sends it flat, and the provider was handed
 * `card: undefined` on every card checkout in production.
 *
 * That gap is not visible from either side alone, because a test on either side
 * builds the other side's body BY HAND. So this one builds nothing: the real
 * published client posts, through a fetch shim, into the real mount.
 */

const MERCHANT: MerchantRef = { kind: "TENANT", id: "merchant-1" };
const REF = "inv_2024_0043";
const BRL = (amountCents: number): { amountCents: number; currency: string } => ({
  amountCents,
  currency: "BRL",
});

/** The smallest adapter the gateway accepts. No vendor named anywhere in it. */
function adapter(name: string, seen: ChargeInput[]): PaymentProviderAdapter {
  return {
    name,
    displayName: name,
    capabilities: {
      methods: ["PIX", "CARD"],
      savedCards: true,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization: "PUBLIC_KEY",
    },
    // FUT-595 — this provider will not take a charge without the buyer's CPF,
    // which is the field the card form collects and the payable cannot keep.
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
        card: { last4: "4242", vaultToken: `vault_${input.card?.token ?? "none"}` },
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

interface Vaulted {
  provider: string;
  token: string;
  display: unknown;
}

/**
 * A mount, plus a `fetch` that routes `/api/checkout/**` straight into it. The
 * browser client is not adapted in any way — it posts what it posts.
 */
function mountBehindFetch() {
  const seen: ChargeInput[] = [];
  const vaulted: Vaulted[] = [];
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
  credentials.set(MERCHANT, "alpha", { environment: "SANDBOX", fields: {}, stub: true });

  // An INVOICE whose buyer identity has no CPF in it — the origin host's own order
  // row has no column for one, so this is the shape a real payable comes back
  // in and the CPF can only arrive with the charge.
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
    instruments: {
      list: async () => [],
      resolve: async () => ({ token: null, owned: false }),
      save: async (_caller, scope, token, display) => {
        vaulted.push({ provider: scope.provider, token, display });
      },
    },
    copy,
  });

  const fetchShim = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Named anything but `path` — a local called `path` reads as node:path to
    // the flakiness gate's unmocked-fs rule.
    const target = String(input);
    const [pathname = "", query] = target.replace("/api/checkout", "").split("?");
    const url = `https://shop.example/api/checkout${pathname}${query ? `?${query}` : ""}`;
    const request = new Request(url, init as RequestInit);
    const context = { params: { segments: pathname.split("/").filter(Boolean) } };
    const verb = (init?.method ?? "GET") as "GET" | "POST";
    return routes[verb](request, context);
  };

  return { seen, vaulted, fetchShim };
}

describe("@12-apps/payments-frontend's chargeCard against createPaymentFlowsBE", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets the buyer's card, opt-in and CPF to the provider", async () => {
    const { seen, vaulted, fetchShim } = mountBehindFetch();
    vi.stubGlobal("fetch", fetchShim);

    const charged = await chargeCard({
      orderId: REF,
      token: "tok_from_the_browser",
      tokensByProvider: { alpha: "tok_alpha" },
      saveCard: true,
      cardMeta: { brand: "visa", last4: "4242", expMonth: 12, expYear: 2030, holder: "ANA B" },
      taxId: "12345678909",
    });

    expect(charged.ok).toBe(true);
    expect(charged.ok && charged.data.status).toBe("PAID");

    // The instrument reached the provider. Before this it did not: the mount
    // looked for a nested `card` block, found none, and sent `{reference,
    // method:'CARD'}` with no instrument at all.
    expect(seen[0]?.card?.tokensByProvider).toEqual({ alpha: "tok_alpha" });
    expect(seen[0]?.card?.token).toBe("tok_alpha");
    // And so did the CPF, which this provider's schema makes non-negotiable —
    // sourced from the payable alone it is simply not there, and the buyer is
    // asked for the document they typed two screens earlier.
    expect(seen[0]?.customer).toEqual({
      name: "Ana Buyer",
      email: "ana@example.com",
      taxId: "12345678909",
    });
    // `saveCard` + `cardMeta` are the vaulting opt-in under their wire names.
    expect(vaulted).toEqual([
      {
        provider: "alpha",
        token: "vault_tok_alpha",
        display: {
          brand: "visa",
          last4: "4242",
          expMonth: 12,
          expYear: 2030,
          holder: "ANA B",
        },
      },
    ]);
  });

  it("refuses, naming the field, when the buyer sent no CPF", async () => {
    const { seen, fetchShim } = mountBehindFetch();
    vi.stubGlobal("fetch", fetchShim);

    const charged = await chargeCard({
      orderId: REF,
      token: "tok_from_the_browser",
      saveCard: false,
    });

    expect(charged.ok).toBe(false);
    expect(!charged.ok && charged.code).toBe("MISSING_BUYER_FIELD");
    // Nothing was sent anywhere, so this is not a decline and not an outage.
    expect(seen).toEqual([]);
  });
});
