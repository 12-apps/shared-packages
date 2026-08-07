/**
 * What the store's active provider lets THIS browser do (FUT-697/698) — the
 * capability reads the Pagamento step derives its picker and card path from.
 * Every rule here fails OPEN for the UI and CLOSED for the money: a missing
 * config renders everything, and the tokenizer/server still refuse a charge
 * they cannot honour.
 */
import { useEffect } from "react";

import { tokenizerFor, type CardTokenizationConfig } from "../../card";

import type { CheckoutChainLink, CheckoutProviderConfig, PaymentMethod } from "./types";

/**
 * Whether the store's CHAIN gives this browser a card path (FUT-697/563).
 *
 * Asked of the whole chain, for the same reason the server's
 * `usesHostedCheckout` is: the head no longer decides which surface the buyer
 * gets. A store where nobody tokenizes in the browser hands the buyer over at
 * order creation and the card is typed on the provider's own page — a card
 * path, so CARD stays offered. A store where somebody DOES tokenize gets our
 * form instead, and then the question is whether this browser can actually
 * mint for one of those entries: a scheme {@link tokenizerFor} knows, with a
 * key (or PagBank's on-demand refresh), or server-granted stub mode.
 *
 * Answering "yes, it is REDIRECT" off the head alone is what let the picker
 * offer a card the submit could never tokenize.
 *
 * Asked only of the entries that DECLARE `CARD` (FUT-747), for the same reason
 * the server's predicate is: tokenization is a card fact, so a PIX-only entry
 * has nothing to say about the card path and must not be read as "this store
 * hands the buyer over". A store with no card-capable entry at all has no card
 * path — `offeredMethods` is already not offering one, and saying so here is
 * what lets {@link usePreselectSoleMethod} pick the store's only method.
 *
 * `null` config (still loading / fetch blip) fails OPEN for the UI — the
 * tokenizer itself still fails CLOSED.
 */
export function cardPathAvailable(config: CheckoutProviderConfig | null): boolean {
  if (!config) return true;
  const chain = cardCapableChain(config);
  if (chain.length === 0) return false;
  if (!chain.some((link) => link.mintable)) return true;
  return chain.some(canMintFor);
}

/**
 * The published chain narrowed to the entries that declare `CARD` — the same
 * subset the server's walk will attempt, since it skips a provider whose
 * capabilities exclude the method.
 *
 * A store that served NO chain (an older host, or a mocked config) has no
 * per-entry `methods` to narrow on, so it degrades to {@link cardChain}'s head
 * triple and behaves exactly as it did before.
 */
function cardCapableChain(config: CheckoutProviderConfig): CardChainLink[] {
  const chain = config.chain;
  if (!chain || chain.length === 0) return cardChain(config);
  return chain.filter((link) => link.methods.includes("CARD")).map(toCardLink);
}

/** Whether this browser can really produce an instrument for ONE chain entry. */
function canMintFor(link: CardChainLink): boolean {
  if (!link.mintable) return false;
  if (link.mockTokenization) return true;
  const scheme = link.provider ? tokenizerFor(link.provider) : null;
  if (!scheme) return false;
  return link.publicKey !== null || scheme === "pagbank-sdk";
}

/**
 * The tokenization slice the card view consumes. A missing config degrades
 * to the legacy PagBank path — per-order key refresh, NO mock permission — so
 * a transient config failure never blocks a healthy PagBank store and never
 * mints a fake token anywhere.
 */
export function cardTokenization(config: CheckoutProviderConfig | null): CardTokenizationConfig {
  if (config) return config;
  return { provider: "pagbank", publicKey: null, mockTokenization: false };
}

/**
 * Tokenization schemes that give the BROWSER something to mint (FUT-563).
 * A `REDIRECT` provider's own page takes the card and a `NONE` one asks for no
 * instrument at all — asking either for a token would produce a fake one under
 * stub mode and an error everywhere else.
 */
const MINTABLE: ReadonlySet<string> = new Set(["PUBLIC_KEY", "SDK"]);

/**
 * ONE entry of the store's chain as the card path sees it (FUT-563): how to
 * mint an instrument for it, plus whether this browser is asked to mint at all.
 */
export interface CardChainLink extends CardTokenizationConfig {
  /**
   * The entry declares an in-browser scheme (`PUBLIC_KEY` / `SDK`).
   *
   * `false` entries are NOT dropped from the list, and that is the point: the
   * charge still WALKS them, and how many providers the walk may reach is what
   * decides whether the card charge has to carry `tokensByProvider` at all. A
   * chain counted by "how many instruments the browser happened to mint" hides
   * a hosted-page provider from the server, which then reads the bare token as
   * the head's and skips the one entry that needed no instrument.
   */
  mintable: boolean;
}

/**
 * The store's chain as one tokenization config per entry, in the merchant's
 * order (FUT-563) — what the card path mints `tokensByProvider` from.
 *
 * A card instrument is bound to whoever minted it, so a charge can only fail
 * over onto a provider the browser also tokenized for. Entries with no
 * in-browser scheme are carried but marked {@link CardChainLink.mintable}
 * false rather than mocked: they need no instrument, and the gateway passes an
 * unattributed charge straight to them.
 *
 * Falls back to the HEAD triple when the host served no chain, which is exactly
 * the pre-FUT-563 behaviour — one instrument, for the active provider.
 */
export function cardChain(config: CheckoutProviderConfig | null): CardChainLink[] {
  if (!config) return [];
  const chain = config.chain;
  if (!chain || chain.length === 0) {
    // No `tokenization` served either (an older host) ⇒ assume the head mints,
    // which is what this checkout did before there was a chain to read.
    const mintable = config.tokenization === null || MINTABLE.has(config.tokenization);
    return [{ ...cardTokenization(config), mintable }];
  }
  return chain.map(toCardLink);
}

/** ONE published chain entry, as the card path sees it. */
function toCardLink(link: CheckoutChainLink): CardChainLink {
  return {
    provider: link.provider,
    publicKey: link.publicKey,
    mockTokenization: link.mockTokenization,
    mintable: MINTABLE.has(link.tokenization),
  };
}

/**
 * The methods the picker may offer, from the chain's declared capabilities
 * (FUT-698). `null` config — still loading, or a fetch blip — fails OPEN like
 * {@link cardPathAvailable}: the picker renders everything and the server
 * still refuses the charge closed. Narrowed to the methods this checkout can
 * actually drive (PIX and CARD; BOLETO is declared by some adapters but has
 * no buyer UI yet), so a capability the UI cannot honour is never offered.
 */
export function offeredMethods(config: CheckoutProviderConfig | null): PaymentMethod[] | null {
  if (!config?.methods) return null;
  return config.methods.filter(
    (method): method is PaymentMethod => method === "PIX" || method === "CARD",
  );
}

/**
 * The methods a buyer can actually pick right now.
 *
 * `null` offered — still loading, or a fetch blip — fails OPEN and offers both;
 * the server still refuses the charge closed. A CARD tile with no in-browser
 * path is not selectable, so it does not count towards a "sole" method either.
 */
export function selectableMethods(
  offered: PaymentMethod[] | null,
  cardUnavailable: boolean,
): PaymentMethod[] {
  return (offered ?? ["PIX", "CARD"]).filter(
    (method) => !(method === "CARD" && cardUnavailable),
  );
}

/**
 * A SOLE remaining method is not a choice — take it (FUT-697 review, widened by
 * FUT-741).
 *
 * A one-option radiogroup that still demands a tap is a click that buys the
 * buyer nothing. It used to fire only when the CARD tile was disabled, which
 * missed the other shape entirely: a store whose chain declares PIX alone
 * renders one tile, nothing preselects it, and the buyer sits on a picker with
 * a single option and no payment below it.
 */
export function usePreselectSoleMethod(
  selectable: readonly PaymentMethod[],
  method: PaymentMethod | null,
  onMethodChange: (method: PaymentMethod) => void,
): void {
  const sole = selectable.length === 1 ? selectable[0] : undefined;
  useEffect(() => {
    if (method === null && sole) onMethodChange(sole);
  }, [sole, method, onMethodChange]);
}
