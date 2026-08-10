/**
 * THE PROVIDER HALF of a story store (FUT-742): one local, vendor-free adapter
 * per declared entry, plus the pt-BR copy table a buyer reads.
 *
 * ## Why this is not a mock
 *
 * A story that stubs `globalThis.fetch` and answers `{ data: … }` recreates the
 * FUT-740 failure exactly: both halves green, the wire dead. All three
 * criticals that review found lived in the seam between the published client
 * and the published mount — a CARD charge settling a PIX payable, a `/charge`
 * body the shipped client never sends, a CPF the payable could not carry — and
 * not one of them is visible to a test that builds the other side's body by
 * hand.
 *
 * So every story below runs a REAL `createPaymentFlowsBE` mount, in the page,
 * behind a `fetch` handed to `createPaymentFlows({ transport })`. The bytes
 * that cross are the bytes production sends. What is stubbed is only what a
 * browser genuinely cannot have: the merchant's stored credentials, and the
 * provider at the other end of them.
 *
 * ## No vendor subpaths
 *
 * Only `@12-apps/payments-backend`'s ROOT entry is imported. The adapter
 * subpaths (`./providers/*`) reach for `node:crypto` and would not survive
 * bundling; the adapters here are local stubs declared per story instead, which
 * is also what keeps a story about `tokenization: 'REDIRECT'` a story about the
 * DECLARATION rather than about one vendor.
 */
import {
  ProviderRequestError,
  type ChargeInput,
  type ChargeSnapshot,
  type CheckoutCopy,
  type ClientTokenization,
  type CustomerFieldSpec,
  type MerchantRef,
  type Money,
  type PaymentMethodKind,
  type PaymentProviderAdapter,
  type VaultBeginInput,
  type VaultCompleteInput,
} from "@12-apps/payments-backend";

/**
 * The wallet vocabulary, read off the adapter's own capability table — the
 * backend's root entry exports no standalone name for it here, and restating
 * the union would be the copy that drifts.
 */
type WalletKind = NonNullable<PaymentProviderAdapter["capabilities"]["wallets"]>[number];

/** The one merchant every story is set at. */
export const MERCHANT: MerchantRef = { kind: "TENANT", id: "loja-1" };
/** Money, in the only currency these stories deal in. */
export const BRL = (amountCents: number): Money => ({ amountCents, currency: "BRL" });

/**
 * What a Brazilian card/PIX provider asks for, and the default a story gets.
 *
 * Stated rather than omitted, because omission is NOT the same thing at this
 * layer: an adapter that declares nothing publishes `customerSchema: []`, and
 * the server then genuinely asks the buyer for nothing. The frontend's
 * "degrade to CPF-required" rule is for a config where the FIELD IS ABSENT — an
 * older host — which no live mount produces. `buyer-fields.test.ts` covers that
 * case directly; a story cannot stage it without lying about the server.
 */
const CPF_REQUIRED: CustomerFieldSpec[] = [{ key: "taxId", type: "CPF", required: true }];

/** How one provider in the story's chain behaves. */
export interface StoryProvider {
  /** Opaque key. The factory never types one; a story does, as a host would. */
  name: string;
  tokenization?: ClientTokenization;
  methods?: PaymentMethodKind[];
  /**
   * What this provider needs to know about the buyer (FUT-595). Omitted ⇒ the
   * CPF, which is what every provider in this market actually asks for; pass
   * `[]` for the store that asks nothing.
   */
  customerSchema?: CustomerFieldSpec[];
  /** A PUBLIC browser key. `null` + `stub` is the mock-tokenization grant. */
  publicKey?: string | null;
  /** The connection runs the deterministic stub ⇒ `mockTokenization`. */
  stub?: boolean;
  /** The issuer refuses. A real decline, not an outage. */
  declines?: boolean;
  /** Provably nothing left the building — the walk may advance. */
  unreachable?: boolean;
  /**
   * The provider failed in a way NOBODY can classify, and cannot answer a
   * probe either — so the walk stops rather than risk a second charge. This is
   * the `PAYMENT_UNRESOLVED` state, and the one outcome where offering a retry
   * is actively harmful.
   */
  ambiguous?: boolean;
  /** Answers with a hosted page instead of a payload or a tokenizable form. */
  hosted?: boolean;
  /**
   * The buyer screen this provider's flow needs (FUT-596). Omitted ⇒ declares
   * none, which is the capability-default path.
   *
   * This is what lets a story render a REAL provider screen without importing
   * a vendor adapter — impossible here by design (see the header). Because the
   * id names the shape rather than the vendor, a story's fictional `aurora`
   * declares `'pix-and-card'` and gets exactly the component a PagBank store
   * would. A vendor-keyed registry would have needed a story adapter literally
   * named for the vendor, which this file refuses.
   */
  checkoutScreen?: string;
  /**
   * The digital wallets this provider's card charge accepts (FUT-471/472) —
   * declared exactly as a real adapter declares them (and as the harness's
   * `HarnessProvider` does), so the gateway's capability stamp and the buttons'
   * fail-closed gates run for real on a story store. Omitted ⇒ `[]` on the
   * published chain, which is exactly the no-wallet store.
   */
  wallets?: WalletKind[];
  /**
   * Google Pay's `gatewayMerchantId` for this connection (FUT-471). Present ⇒
   * `clientConfig` publishes the PAYMENT_GATEWAY parameters, with the
   * provider's own (fictional) name as the gateway id.
   */
  googlePayMerchantId?: string;
  /**
   * The provider can VAULT a card outside a purchase (FUT-478/FUT-183) —
   * declares the adapter's `vault` seam, so `/cards/begin` + `/cards/complete`
   * answer for real. Omitted ⇒ no seam, which is exactly the store whose buyer
   * reads "not enabled here".
   */
  vaultable?: boolean;
  /** The provider refuses the card at vault time — a validation 400. */
  vaultDeclines?: boolean;
}

/** Everything the vault seam was handed — the stories' assertion surface. */
export interface VaultSeamLog {
  begin: VaultBeginInput[];
  complete: VaultCompleteInput[];
}

/**
 * The vendor-free vault seam a `vaultable` story provider declares. Mirrors
 * the shape a sessionless PUBLIC_KEY provider answers: `begin` merely equips
 * the browser (key when the connection holds one, a session id to echo), and
 * `complete` mints the instrument the host must store. `vaultDeclines` throws
 * the validation 400 the host's `mapProviderError` words with a field-level
 * reason — the same seam a charge decline is worded through.
 */
function vaultSeam(
  spec: StoryProvider,
  seam: VaultSeamLog,
): NonNullable<PaymentProviderAdapter["vault"]> {
  return {
    begin: async (input) => {
      seam.begin.push(input);
      return {
        provider: spec.name,
        tokenization: spec.tokenization ?? "PUBLIC_KEY",
        publicKey: spec.publicKey ?? undefined,
        customerRef: "cus_story_7",
        sessionId: `vs_${spec.name}_1`,
      };
    },
    complete: async (input) => {
      seam.complete.push(input);
      if (spec.vaultDeclines) {
        throw new ProviderRequestError(spec.name, "card_number is not a valid card", {
          httpStatus: 400,
          retriable: false,
        });
      }
      return {
        provider: spec.name,
        instrumentId: `vault_tok_${input.reference}`,
        customerRef: "cus_story_7",
        brand: "visa",
        last4: "4242",
        expMonth: 12,
        expYear: 2031,
      };
    },
  };
}

/** The PIX payload a stub provider hands back — a payload, never an image. */
function pixPayload(reference: string): { qrText: string; expiresAt: string } {
  return {
    qrText: `00020126580014BR.GOV.BCB.PIX0136${reference}5204000053039865802BR6009SAO PAULO62070503***6304ABCD`,
    // Fixed offset from the render, so the "válido até" line reads sensibly in
    // a story without the story having to know what time it is.
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

/** A local, vendor-free adapter that behaves as the story declared. */
export function storyAdapter(
  spec: StoryProvider,
  seen: ChargeInput[],
  /** Records what the vault seam was shown; only read for `vaultable` specs. */
  vaultLog: VaultSeamLog = { begin: [], complete: [] },
): PaymentProviderAdapter {
  const tokenization = spec.tokenization ?? "PUBLIC_KEY";
  return {
    name: spec.name,
    displayName: spec.name,
    ...(spec.vaultable ? { vault: vaultSeam(spec, vaultLog) } : {}),
    capabilities: {
      methods: spec.methods ?? ["PIX", "CARD"],
      // Declared, not defaulted: the published chain carries the claim and the
      // wallet buttons fail CLOSED on its absence, so that gate runs for real.
      wallets: spec.wallets ?? [],
      savedCards: true,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization,
    },
    customerSchema: spec.customerSchema ?? CPF_REQUIRED,
    // Undefined when the story declares none — the gateway normalizes that to
    // `null` on the published chain, which is the capability-default path.
    checkoutScreen: spec.checkoutScreen,
    credentialSchema: [{ key: "secretKey", label: "Secret", secret: true, required: true }],
    async verifyCredentials() {
      return { ok: true };
    },
    async createCharge(input) {
      seen.push(input);
      return chargeAnswer(spec, input);
    },
    async getCharge(providerChargeId) {
      return {
        provider: spec.name,
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
    clientConfig: () => ({
      provider: spec.name,
      tokenization,
      // The PAYMENT_GATEWAY parameters, published exactly as a real adapter
      // publishes them (FUT-471) — a per-credential fact, so it rides on
      // `clientConfig` while `wallets` rides on `capabilities`.
      ...(spec.googlePayMerchantId
        ? { googlePay: { gateway: spec.name, gatewayMerchantId: spec.googlePayMerchantId } }
        : {}),
    }),
  };
}

/** What one declared provider answers a charge with. */
function chargeAnswer(spec: StoryProvider, input: ChargeInput): ChargeSnapshot {
  if (spec.unreachable) {
    // A PROVABLY pre-send failure: the connection was refused, so nothing
    // reached the provider and the walk is entitled to advance to the next one.
    throw new TypeError(`fetch failed: ${spec.name} is down`, {
      cause: { code: "ECONNREFUSED" },
    });
  }
  if (spec.ambiguous) {
    // Deliberately NOT a pre-send network error: `classifyFailure` can prove
    // nothing about whether the provider took the money, and the adapter below
    // answers no reference probe either.
    throw new Error(`${spec.name} did not answer`);
  }
  const base: ChargeSnapshot = {
    provider: spec.name,
    providerChargeId: `stub_${spec.name}_${input.reference}`,
    reference: input.reference,
    status: "PAID",
    amount: input.amount,
    method: input.method,
  };
  if (spec.hosted) {
    return {
      ...base,
      status: "PENDING",
      hostedCheckoutUrl: `https://${spec.name}.example/checkout/${base.providerChargeId}`,
    };
  }
  if (input.method === "PIX") {
    return { ...base, status: "PENDING", pix: pixPayload(input.reference) };
  }
  if (spec.declines) {
    return { ...base, status: "DECLINED", declineReason: "CARD_DECLINED" };
  }
  return { ...base, card: { last4: "4242", vaultToken: `vault_${input.card?.token ?? "none"}` } };
}

/** Machine-free product copy: a buyer reads these, so they are pt-BR. */
export const storyCopy: CheckoutCopy = {
  notConfigured: "Esta loja não está aceitando pagamentos online no momento.",
  chainExhausted: (method) =>
    method === "PIX"
      ? "Não foi possível gerar o PIX agora. Tente novamente em instantes."
      : "Não foi possível pagar com cartão agora. Você pode tentar com PIX.",
  unresolvedCharge:
    "Estamos confirmando seu pagamento com o banco. NÃO pague de novo — avisaremos assim que confirmar.",
  chargeMismatch: "Não foi possível confirmar este pagamento. Fale com a loja.",
  instrumentNotUsableHere:
    "Este cartão salvo não pode ser usado nesta loja. Informe os dados do cartão novamente.",
  payableNotFound: "Não encontramos este pedido.",
  buyerFieldMissing: (fields) => `Informe: ${[...fields].join(", ")}.`,
  buyerFieldInvalid: (field) => `O campo ${field} está inválido.`,
  fieldNameOf: (field) => (field === "taxId" ? "cpf" : field),
  genericProviderRefusal: "Não foi possível concluir o pagamento. Tente novamente.",
};
