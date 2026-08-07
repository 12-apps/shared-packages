/**
 * THE PROVIDER HALF of a harness store (FUT-743): one local, vendor-free
 * adapter per declared chain entry, plus the pt-BR copy a buyer reads.
 *
 * ## Why the harness owns its own adapters
 *
 * The package's Storybook has an equivalent fixture, but it lives at
 * `src/stories/` — excluded from the tarball by `files`. A consumer cannot
 * import it, which is precisely why it is re-stated here: this harness installs
 * the PUBLISHED tarballs, so everything it reaches for has to be something an
 * adopter could also reach for. If a future release stops exporting a type used
 * below, this file stops compiling — which is the whole point.
 *
 * ## No vendor subpaths
 *
 * Only `@12-apps/payments-backend`'s ROOT entry is imported. The adapter
 * subpaths (`./providers/*`) reach for `node:crypto` and would not survive
 * bundling into a browser. Declaring the behaviour locally also keeps a page
 * about `tokenization: 'REDIRECT'` a page about the DECLARATION rather than
 * about one vendor.
 *
 * ## Names are opaque
 *
 * Every provider here is called something no tokenizer recognises (`aurora`,
 * `boreal`, …). `tokenizerFor` answers `null` for them, so the browser takes
 * the server-granted stub path instead of injecting a real acquirer's SDK —
 * a harness page must not make a cross-origin call to Pagar.me to render.
 */
import type {
  ChargeInput,
  ChargeSnapshot,
  CheckoutCopy,
  ClientTokenization,
  CustomerFieldSpec,
  MerchantRef,
  Money,
  PaymentMethodKind,
  PaymentProviderAdapter,
} from '@12-apps/payments-backend';

/** The one merchant every harness page is set at. */
export const MERCHANT: MerchantRef = { kind: 'TENANT', id: 'loja-harness' };

/** Money, in the only currency these pages deal in. */
export const BRL = (amountCents: number): Money => ({ amountCents, currency: 'BRL' });

/** `R$ 75,00` — the pre-formatted grand total the pay bar shows. */
export function brlLabel(amountCents: number): string {
  return `R$ ${(amountCents / 100).toFixed(2).replace('.', ',')}`;
}

/**
 * What a Brazilian card/PIX provider asks for, and the default a page gets.
 *
 * Stated rather than omitted, because omission is NOT the same thing at this
 * layer: an adapter that declares nothing publishes `customerSchema: []`, and
 * the server then genuinely asks the buyer for nothing. The frontend's
 * "degrade to CPF-required" rule is for a config where the FIELD IS ABSENT —
 * an older host — which no live mount produces.
 */
const CPF_REQUIRED: CustomerFieldSpec[] = [{ key: 'taxId', type: 'CPF', required: true }];

/** How one provider in a page's chain behaves. */
export interface HarnessProvider {
  /** Opaque key. The factory never types one; a host does, as this page does. */
  name: string;
  tokenization?: ClientTokenization;
  methods?: PaymentMethodKind[];
  /** What this provider needs to know about the buyer (FUT-595). */
  customerSchema?: CustomerFieldSpec[];
  /** A PUBLIC browser key. */
  publicKey?: string | null;
  /** The connection runs the deterministic stub ⇒ `mockTokenization`. */
  stub?: boolean;
  /** The issuer refuses. A real decline, not an outage. */
  declines?: boolean;
  /** Provably nothing left the building — the walk may advance. */
  unreachable?: boolean;
  /**
   * The provider failed in a way NOBODY can classify and answers no probe, so
   * the walk stops rather than risk a second charge — `PAYMENT_UNRESOLVED`.
   */
  ambiguous?: boolean;
  /** Answers with a hosted page instead of a payload or a tokenizable form. */
  hosted?: boolean;
  /**
   * Whether a poll finds the money arrived. Default true — the provider says
   * PAID and the mount settles the payable through the host's own port.
   *
   * `false` is a PIX code NOBODY HAS PAID YET, which is the ordinary state a
   * buyer sits in while deciding. A page about switching methods needs it: with
   * the default the QR settles two and a half seconds in, the flow advances to
   * the confirmation screen, and the picker the page is about has unmounted
   * underneath the click.
   */
  settlesOnPoll?: boolean;
  /**
   * The buyer screen this provider's flow needs (FUT-596). Omitted ⇒ declares
   * none, and the checkout falls back to the capability default.
   *
   * A host declares this exactly as a real adapter does, which is what the
   * screen-resolution page exercises. Because the id names the SHAPE of the
   * flow rather than the vendor, this harness can prove resolution end to end
   * without a vendor name anywhere — which matters, since
   * `payments/no-provider-name-literal` makes one a hard error outside the
   * package, and every fixture here is already fictional for that reason.
   */
  checkoutScreen?: string;
}

/**
 * A charge as one provider received it, tagged with WHO received it.
 *
 * `ChargeInput` carries no provider — the gateway resolves that separately — so
 * the name is attached here. Without it a two-entry chain's charges are
 * indistinguishable in the log, which is exactly the fact a failover page has
 * to assert on.
 */
export type SeenCharge = ChargeInput & { provider: string };

/** The PIX payload a stub provider hands back — a payload, never an image. */
function pixPayload(reference: string): { qrText: string; expiresAt: string } {
  return {
    qrText: `00020126580014BR.GOV.BCB.PIX0136${reference}5204000053039865802BR6009SAO PAULO62070503***6304ABCD`,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

/**
 * What one declared provider answers a CARD charge with.
 *
 * NO INSTRUMENT IS REFUSED, FIRST. A card request with nothing to charge is not
 * something an acquirer can evaluate, so it does not approve one — and a stub
 * that approved it anyway is what hid FUT-740's second critical: a mount that
 * stopped reading the flat body's `token` sent exactly this charge, and the
 * buyer still reached `payment-paid`, with `(no-instrument)` printed in a probe
 * nobody was asserting on. The provider refusing is what makes that a red run.
 */
function cardAnswer(
  spec: HarnessProvider,
  input: ChargeInput,
  base: ChargeSnapshot,
): ChargeSnapshot {
  const card = input.card;
  if (!card?.token && !card?.savedCardToken) {
    return { ...base, status: 'DECLINED', declineReason: 'INVALID_CARD', declineRetriable: false };
  }
  if (spec.declines) return { ...base, status: 'DECLINED', declineReason: 'CARD_DECLINED' };
  return { ...base, card: { last4: '4242', vaultToken: `vault_${card.token ?? 'none'}` } };
}

/** What one declared provider answers a charge with. */
function chargeAnswer(spec: HarnessProvider, input: ChargeInput): ChargeSnapshot {
  if (spec.unreachable) {
    // A PROVABLY pre-send failure: the connection was refused, so nothing
    // reached the provider and the walk is entitled to advance.
    throw new TypeError(`fetch failed: ${spec.name} is down`, { cause: { code: 'ECONNREFUSED' } });
  }
  if (spec.ambiguous) {
    // Deliberately NOT a pre-send network error: nothing can be proven about
    // whether the provider took the money, and `getCharge` answers no probe.
    throw new Error(`${spec.name} did not answer`);
  }
  const base: ChargeSnapshot = {
    provider: spec.name,
    providerChargeId: `stub_${spec.name}_${input.reference}`,
    reference: input.reference,
    status: 'PAID',
    amount: input.amount,
    method: input.method,
  };
  if (spec.hosted) {
    return {
      ...base,
      status: 'PENDING',
      hostedCheckoutUrl: `https://${spec.name}.example/checkout/${base.providerChargeId}`,
    };
  }
  if (input.method === 'PIX') return { ...base, status: 'PENDING', pix: pixPayload(input.reference) };
  return cardAnswer(spec, input, base);
}

/**
 * A local, vendor-free adapter that behaves as the page declared.
 *
 * `getCharge` answers PAID for a charge this adapter itself raised. That is
 * what makes a PIX page settle: the poll asks the provider, the provider says
 * paid, and `getStatus` applies it through the host's own `correlation.settle`
 * — the real reconcile path, not an offline timer. An `ambiguous` provider
 * answers no probe at all, which is what leaves its charge unresolved.
 */
export function harnessAdapter(spec: HarnessProvider, seen: SeenCharge[]): PaymentProviderAdapter {
  const tokenization = spec.tokenization ?? 'PUBLIC_KEY';
  const raised = new Map<string, ChargeSnapshot>();
  return {
    name: spec.name,
    displayName: spec.name,
    capabilities: {
      methods: spec.methods ?? ['PIX', 'CARD'],
      savedCards: true,
      refunds: false,
      partialRefunds: false,
      splits: false,
      webhooks: true,
      tokenization,
    },
    customerSchema: spec.customerSchema ?? CPF_REQUIRED,
    // Undefined when the host declares none — the gateway normalizes that to
    // `null` on the published chain, which is the capability-default path.
    checkoutScreen: spec.checkoutScreen,
    credentialSchema: [{ key: 'secretKey', label: 'Secret', secret: true, required: true }],
    async verifyCredentials() {
      return { ok: true };
    },
    async createCharge(input) {
      seen.push({ ...input, provider: spec.name });
      const snapshot = chargeAnswer(spec, input);
      raised.set(snapshot.providerChargeId, snapshot);
      return snapshot;
    },
    async getCharge(providerChargeId) {
      const known = raised.get(providerChargeId);
      if (!known) {
        return {
          provider: spec.name,
          providerChargeId,
          status: 'PENDING',
          amount: BRL(0),
          method: 'CARD',
        };
      }
      // The provider now says the money arrived — the answer `reconcile` turns
      // into the host's settlement. Unless this provider was declared as one
      // nobody has paid yet, in which case the poll finds it exactly as raised.
      return spec.settlesOnPoll === false ? known : { ...known, status: 'PAID' };
    },
    webhook: {
      async verify() {
        return true;
      },
      async parse() {
        return [];
      },
    },
    clientConfig: () => ({ provider: spec.name, tokenization }),
  };
}

/** Machine-free product copy: a buyer reads these, so they are pt-BR. */
export const harnessCopy: CheckoutCopy = {
  notConfigured: 'Esta loja não está aceitando pagamentos online no momento.',
  chainExhausted: (method) =>
    method === 'PIX'
      ? 'Não foi possível gerar o PIX agora. Tente novamente em instantes.'
      : 'Não foi possível pagar com cartão agora. Você pode tentar com PIX.',
  unresolvedCharge:
    'Estamos confirmando seu pagamento com o banco. NÃO pague de novo — avisaremos assim que confirmar.',
  chargeMismatch: 'Não foi possível confirmar este pagamento. Fale com a loja.',
  instrumentNotUsableHere:
    'Este cartão salvo não pode ser usado nesta loja. Informe os dados do cartão novamente.',
  payableNotFound: 'Não encontramos este pedido.',
  buyerFieldMissing: (fields) => `Informe: ${[...fields].join(', ')}.`,
  buyerFieldInvalid: (field) => `O campo ${field} está inválido.`,
  fieldNameOf: (field) => (field === 'taxId' ? 'cpf' : field),
  genericProviderRefusal: 'Não foi possível concluir o pagamento. Tente novamente.',
};
