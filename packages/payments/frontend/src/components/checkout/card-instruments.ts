import {
  tokenizeForCheckout,
  tokenizerFor,
  type CardDetails,
  type CardToken,
  type CardTokenizationConfig,
} from "../../card";
import { err, ok, type Result } from "../../result";

import { refreshCardPublicKey } from "./client";
import type { CardChainLink } from "./method-capability";
import type { SavedCardMeta } from "./types";
import type { CardCopy } from "../../card/copy";

/**
 * The order-scoped key refresh, as a parameter (FUT-741).
 *
 * The self-heal is a call to OUR OWN mount, so it has to go through whichever
 * transport the surrounding checkout was bound to. Defaulted to the unbound
 * module function, which is exactly what it always called.
 */
export type RefreshBrowserKey = (input: {
  orderId: string;
}) => Promise<Result<{ publicKey: string | null }>>;

/**
 * TOKENIZATION for the buyer's card — one instrument per provider the charge
 * may reach (FUT-563).
 *
 * A card token is bound to whoever minted it: the gateway refuses to hand
 * provider #2 provider #1's blob and skips it instead. So the checkout's whole
 * contribution to card failover is here — take the card the buyer typed ONCE,
 * and produce an instrument for each entry of the chain the server published.
 *
 * Split out of `use-card-checkout.ts` so the hook stays about SUBMIT state:
 * nothing in this module touches React.
 */

/**
 * Tokenize a new card in the ACTIVE provider's protocol (FUT-697), self-healing
 * a rotated public key (FUT-174): the card has already passed local validation,
 * so a real-key encryption failure most likely means the store's key rotated.
 * Refresh the store's key once and retry before surfacing the error;
 * `onKeyRefreshed` caches the new key for the session. The refresh is scoped to
 * the buyer's OWN `orderId` (the route derives the store from it server-side),
 * never a client-supplied store id — and only PagBank can mint a key on demand,
 * so the self-heal is gated on its scheme.
 */
async function tokenizeNewCard(
  card: CardDetails,
  config: CardTokenizationConfig,
  orderId: string,
  onKeyRefreshed: (key: string) => void,
  refreshKey: RefreshBrowserKey,
  copy: CardCopy,
): Promise<Result<CardToken>> {
  const first = await tokenizeForCheckout(card, config, copy);
  if (first.ok || !config.publicKey) return first;
  if (config.provider === null || tokenizerFor(config.provider) !== "pagbank-sdk") return first;

  const refreshed = await refreshKey({ orderId });
  if (refreshed.ok && refreshed.data.publicKey && refreshed.data.publicKey !== config.publicKey) {
    onKeyRefreshed(refreshed.data.publicKey);
    return tokenizeForCheckout(card, { ...config, publicKey: refreshed.data.publicKey }, copy);
  }
  return first;
}

/** Non-sensitive display metadata for saving a card (the PAN never leaves the form). */
function toCardMeta(card: CardDetails, token: CardToken): SavedCardMeta {
  const [mm = "", yy = ""] = card.expiry.split("/");
  return {
    brand: token.brand,
    last4: token.last4,
    expMonth: Number(mm),
    expYear: 2000 + Number(yy),
    holder: card.holder.trim(),
  };
}

/**
 * One instrument per provider in the chain (FUT-563), keyed by provider name.
 *
 * A card token is bound to whoever minted it, so a charge can only fail over
 * onto a provider the browser ALSO tokenized for. Every entry is attempted and
 * the failures are simply left out: a provider we could not mint for is one the
 * walk will skip, which is the honest outcome and strictly better than failing
 * the whole payment because the second acquirer's key was missing.
 *
 * Nothing is re-typed and nothing is asked of the buyer twice — the same
 * validated card fields are encrypted once per provider, in the browser.
 */
async function mintChainInstruments(
  card: CardDetails,
  chain: readonly CardChainLink[],
  timeoutMs: number,
  copy: CardCopy,
): Promise<Record<string, CardToken>> {
  const results = await Promise.all(
    chain.map(async (link) => {
      // A hosted page (`REDIRECT`) or an instrument-free provider (`NONE`) is
      // skipped, never mocked: minting for it would produce a FAKE token under
      // stub mode and an error everywhere else. It still travels in `chain`,
      // because the walk will reach it.
      if (!link.provider || !link.mintable) return null;
      const tokenized = await mintWithDeadline(card, link, timeoutMs, copy);
      return tokenized.ok ? ([link.provider, tokenized.data] as const) : null;
    }),
  );
  return Object.fromEntries(results.filter((entry) => entry !== null));
}

/**
 * How long ONE backup acquirer may hold the buyer's Pagar button.
 *
 * A tokenizer is a cross-origin POST to the acquirer (Pagar.me, Stripe) with
 * no deadline of its own, and browser `fetch` has none either: a middlebox that
 * accepts the socket and never answers leaves the promise pending for as long
 * as the OS keeps the connection, which the buyer sees as a spinning, disabled
 * "Pagar R$ …" with no cancel and no explanation. Bounding it degrades to what
 * this module already documents — a provider we could not mint for is one the
 * walk will skip.
 */
const MINT_TIMEOUT_MS = 8_000;

/** One tail mint, abandoned (and aborted) when the deadline passes. */
async function mintWithDeadline(
  card: CardDetails,
  link: CardChainLink,
  timeoutMs: number,
  copy: CardCopy,
): Promise<Result<CardToken>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // RACED as well as aborted: the abort ends a `fetch`, but the PagBank scheme
  // waits on an injected <script> that can hang with nothing to cancel.
  const deadline = new Promise<Result<CardToken>>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve(err(copy.tokenize.providerTimedOut));
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      tokenizeForCheckout(card, link, copy, controller.signal),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** What a submitted card charge carries: the head's token plus the chain's. */
export interface CardInstruments {
  token: string;
  tokensByProvider?: Record<string, string>;
  cardMeta?: SavedCardMeta;
}

/**
 * The chain entry the bare `token` is minted from — NOT the chain head.
 *
 * `usesHostedCheckout` asks the WHOLE chain whether anybody tokenizes in the
 * browser, so a store headed by a hosted page whose NEXT provider does gets our
 * card form rather than the handover. The head then has no in-browser scheme at
 * all: minting against it returns "o pagamento com cartão está indisponível",
 * and the buyer who just typed a full PAN is refused while the mintable tail —
 * the very provider the form was shown for — is never asked. That is the whole
 * card path of every REDIRECT-headed store that adds a backup provider, and
 * enabling a provider APPENDS it, so the shape arises with no reordering.
 *
 * The ACTIVE provider still wins when it is itself mintable: only its config
 * carries the key this session may have self-healed (FUT-174).
 *
 * Falls back to the active config when nothing in the chain can be minted for
 * — the tokenizer then says so in the buyer's own words, which is the honest
 * answer for a store that has no in-browser card path at all.
 */
function mintingConfig(
  config: CardTokenizationConfig,
  chain: readonly CardChainLink[],
): CardTokenizationConfig {
  const mintable = chain.filter((link) => link.mintable && link.provider);
  if (mintable.length === 0) return config;
  return mintable.some((link) => link.provider === config.provider) ? config : mintable[0]!;
}

/**
 * Mint for the whole chain at once, and say which entry the bare token is from.
 *
 * Head and tail mint CONCURRENTLY. Sequentially, one unreachable backup
 * acquirer held a healthy head's charge for as long as the network stack
 * allowed — the failover feature blocking on the provider it exists to fall
 * back to. The head keeps no deadline: it is the provider being paid, and its
 * self-heal is a second round trip of our own. That self-heal also stays
 * PagBank-only — `tokenizeNewCard` gates on the scheme — so a chain headed
 * elsewhere cannot ask for somebody else's key.
 */
async function mintEveryEntry(input: {
  card: CardDetails;
  entries: readonly CardChainLink[];
  config: CardTokenizationConfig;
  orderId: string;
  onKeyRefreshed: (key: string) => void;
  refreshKey: RefreshBrowserKey;
  timeoutMs: number;
  copy: CardCopy;
}): Promise<{ headToken: Result<CardToken>; minted: Record<string, CardToken> }> {
  const head = mintingConfig(input.config, input.entries);
  const rest = input.entries.filter((link) => link.provider !== head.provider);
  const [headToken, tail] = await Promise.all([
    tokenizeNewCard(
      input.card,
      head,
      input.orderId,
      input.onKeyRefreshed,
      input.refreshKey,
      input.copy,
    ),
    mintChainInstruments(input.card, rest, input.timeoutMs, input.copy),
  ]);
  // A failure in the tail is not fatal: that provider is simply one the walk
  // will skip.
  const minted = { ...tail };
  if (headToken.ok && head.provider) minted[head.provider] = headToken.data;
  return { headToken, minted };
}

/** The instruments, reduced to the provider→token map the charge body carries. */
function tokenMapOf(minted: Record<string, CardToken>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(minted).map(([provider, instrument]) => [provider, instrument.token]),
  );
}

/** The charge token for a new card (tokenize + self-heal), plus optional save-meta. */
export async function resolveNewCardToken(
  card: CardDetails,
  config: CardTokenizationConfig,
  orderId: string,
  onKeyRefreshed: (key: string) => void,
  saveCard: boolean,
  chain: readonly CardChainLink[],
  /** The words a failed mint reports with — the host's (FUT-760). */
  copy: CardCopy,
  /** Per-entry mint deadline. Overridable so tests need not wait it out. */
  timeoutMs: number = MINT_TIMEOUT_MS,
  /** The bound key refresh (FUT-741); defaults to the unbound module call. */
  refreshKey: RefreshBrowserKey = refreshCardPublicKey,
): Promise<Result<CardInstruments>> {
  // No chain served (an older host, or a fetch blip): the active provider
  // alone, exactly the pre-FUT-563 behaviour.
  const entries = chain.length > 0 ? chain : [{ ...config, mintable: true }];
  const { headToken, minted } = await mintEveryEntry({
    card,
    entries,
    config,
    orderId,
    onKeyRefreshed,
    refreshKey,
    timeoutMs,
    copy,
  });

  // Refused only when NO entry could be minted for. While one still can, the
  // charge goes out and the entries we hold nothing for are skipped by name.
  const anyMinted = Object.values(minted);
  if (!headToken.ok && anyMinted.length === 0) return headToken;
  const primary = headToken.ok ? headToken.data : anyMinted[0]!;
  const tokensByProvider = tokenMapOf(minted);
  return ok({
    token: primary.token,
    // Sent whenever the WALK has more than one provider to reach — counted on
    // the chain the server published, never on how many instruments happened
    // to be minted (FUT-563). A hosted-page provider mints nothing by design,
    // so counting the map drops it for the two-provider store it exists for:
    // the bare token is then read as the chain HEAD's and every other entry is
    // refused as "holding someone else's instrument", including the one that
    // needed none. A genuinely single-provider store still sends exactly what
    // it sent before.
    ...(entries.length > 1 ? { tokensByProvider } : {}),
    ...(saveCard ? { cardMeta: toCardMeta(card, primary) } : {}),
  });
}
