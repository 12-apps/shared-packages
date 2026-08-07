import type { ProviderConfigStore } from '../config/types';
import type { ClientProviderConfig } from '../core/client-view';
import type { PaymentsGateway } from '../core/gateway';
import type { CredentialStore } from '../core/ports';
import type { MerchantRef, PaymentMethodKind } from '../core/types';

import type { BrowserKeyPort, BuyerCheckoutConfig, BuyerProviderLink } from './types';

/**
 * THE BUYER-SAFE PROTOCOL READ (FUT-697 / FUT-563).
 *
 * A checkout can only speak a provider's protocol when it knows WHICH providers
 * are enabled, HOW each tokenizes, and with WHAT key. Before a host answered
 * that, the card path assumed one vendor: a merchant on any other got a
 * foreign-resolved `null` key and the mock tokenizer minted a fake token that
 * entered a real charge.
 *
 * It answers the whole enabled CHAIN, not one active provider. A card
 * instrument is bound to the provider that minted it, so a checkout told only
 * about the head produces something the rest of the chain cannot read and the
 * walk skips them rather than send it. Describing every entry is what makes the
 * buyer's card survive the first provider failing.
 *
 * The head fields are DERIVED from `chain[0]` rather than resolved separately,
 * so "the active provider" can never disagree with "the first provider a charge
 * will be attempted on" — they are the same row read once.
 */

export interface CheckoutConfigDeps {
  gateway: PaymentsGateway;
  credentials: CredentialStore;
  /** Read-only: the stub flag on a stored connection, for `mockTokenization`. */
  connections: Pick<ProviderConfigStore, 'get'>;
  browserKey?: BrowserKeyPort;
}

const NO_PROVIDER: BuyerCheckoutConfig = {
  provider: null,
  tokenization: null,
  publicKey: null,
  mockTokenization: false,
  methods: [],
  chain: [],
};

/**
 * The union of the chain's declared methods, in first-seen (failover) order.
 * The gateway stamps each entry's `methods` from its adapter's capability
 * table, so this never asks an adapter a second question it could answer
 * differently.
 */
function chainMethods(
  chain: readonly { methods: readonly PaymentMethodKind[] }[],
): PaymentMethodKind[] {
  return [...new Set(chain.flatMap((entry) => [...entry.methods]))];
}

/**
 * Lazily re-mint a key-less connection's PUBLIC browser key.
 *
 * ASKED OF THE CAPABILITY, NEVER OF THE NAME. The host's version of this was
 * `entry.provider === "pagbank"` — the last provider-name check on the checkout
 * path — and it is the one thing that made this module unportable. The question
 * the library is entitled to ask is "does this connection tokenize with a
 * PUBLIC_KEY, and is it not a stub"; WHICH vendors can actually mint one on
 * demand is the host's `browserKey` port to answer, and it answers `null` for
 * the ones that cannot.
 *
 * NEVER for a stub connection: a stub token cannot mint a real key, and the
 * doomed outbound call would run (with retries) on every checkout load of every
 * stub-mode merchant.
 */
async function backfillKey(
  deps: CheckoutConfigDeps,
  merchant: MerchantRef,
  entry: ClientProviderConfig,
  isStub: boolean,
): Promise<string | null> {
  if (!deps.browserKey || entry.tokenization !== 'PUBLIC_KEY' || isStub) return null;
  const credentials = await deps.credentials.getCredentials(merchant, entry.provider);
  if (!credentials) return null;
  return deps.browserKey(merchant, entry.provider, credentials);
}

/**
 * One chain entry's buyer-safe view: what the adapter declares, plus the two
 * facts only the stored row knows — whether this connection runs the stub, and
 * the lazily-backfilled key for a provider that can mint one on demand.
 */
async function toBuyerLink(
  deps: CheckoutConfigDeps,
  merchant: MerchantRef,
  entry: ClientProviderConfig,
): Promise<BuyerProviderLink> {
  const stored = await deps.connections.get(merchant, entry.provider);
  const isStub = stored?.stub === true;
  // A raw-seeded row can carry `""` — normalize to null so a blank never
  // defeats the mock gate here or the client's availability check.
  const publicKey =
    (entry.publicKey || null) ?? (await backfillKey(deps, merchant, entry, isStub));
  return {
    provider: entry.provider,
    tokenization: entry.tokenization,
    publicKey,
    mockTokenization: isStub && publicKey === null,
    methods: [...entry.methods],
    customerSchema: [...entry.customerSchema],
  };
}

/** Resolve the merchant's buyer-safe payment config. */
export async function buyerCheckoutConfig(
  deps: CheckoutConfigDeps,
  merchant: MerchantRef,
): Promise<BuyerCheckoutConfig> {
  const entries = await deps.gateway.clientConfigChain(merchant);
  // `clientConfigChain` is already the plan-limited, priority-ordered list.
  // Nothing here sorts, filters or reinterprets it: the order is the merchant's
  // decision and the storefront is a reader of it.
  const chain = await Promise.all(entries.map((entry) => toBuyerLink(deps, merchant, entry)));
  const head = chain[0];
  if (!head) return NO_PROVIDER;
  return {
    provider: head.provider,
    tokenization: head.tokenization,
    publicKey: head.publicKey,
    mockTokenization: head.mockTokenization,
    methods: chainMethods(entries),
    chain,
  };
}

/** Tokenization schemes that give the BROWSER a card form of its own. */
const IN_BROWSER_TOKENIZATION: ReadonlySet<string> = new Set(['PUBLIC_KEY', 'SDK']);

/**
 * Whether this merchant settles on the PROVIDER'S OWN page (FUT-556 / FUT-563).
 *
 * Asked of the adapters' declared `tokenization`, never of their names: a
 * REDIRECT provider hands back a `hostedCheckoutUrl` instead of a PIX payload or
 * a tokenizable card form, and the checkout has to know that BEFORE it decides
 * how to raise the charge.
 *
 * Asked of the WHOLE CHAIN, not the head. The question is "is there any
 * in-browser card path at this merchant at all?", and with a chain the head is
 * not entitled to answer it alone: a merchant whose head is a hosted page but
 * whose next provider tokenizes in the browser must still show the card form,
 * or the buyer is handed over before the chain has been walked and the failover
 * the merchant configured can never happen.
 *
 * Answers false for an empty chain. A merchant with no provider has already
 * been failed closed by the caller; there is no charge path to choose between.
 */
export function usesHostedCheckout(config: BuyerCheckoutConfig): boolean {
  if (config.chain.length === 0) return false;
  return !config.chain.some((entry) => IN_BROWSER_TOKENIZATION.has(entry.tokenization));
}
