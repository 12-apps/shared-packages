import type { ChargeInput, ClientTokenization, ProviderCapabilities, ProviderName } from './types';

/**
 * CARD INSTRUMENTS ARE PROVIDER-BOUND.
 *
 * This is the constraint that decides whether a card charge can fail over at
 * all. Every tokenization scheme in use here produces something only its
 * issuer can read:
 *
 *   PUBLIC_KEY  the browser encrypts the PAN with THAT provider's public key
 *   SDK         the provider's own JS mints a token against its own account
 *   REDIRECT    there is no instrument; the buyer pays on the provider's page
 *
 * So handing provider #2 an instrument minted for provider #1 does not
 * degrade gracefully — it is garbage input. The provider rejects it as a
 * validation error, which classifies as DEFINITELY_NOT_CHARGED, and the walk
 * marches down the chain burning every remaining provider on the same
 * unusable token before failing. The buyer sees a generic decline for what
 * was really a routing mistake.
 *
 * The gateway therefore refuses to send an instrument to a provider it was
 * not minted for, and skips instead. Real card failover requires the checkout
 * to mint one instrument PER provider (`card.tokensByProvider`), which
 * `clientConfigChain()` exists to make possible.
 */

/** Why a provider cannot be attempted with the instrument we hold. */
interface NoInstrument {
  reason: string;
}

/**
 * The charge input to send to `provider`, with the card instrument that
 * actually belongs to it — or an explanation of why this provider cannot be
 * attempted.
 *
 * Non-card charges pass through untouched: PIX and boleto carry no
 * client-side instrument, which is exactly why they fail over cleanly today.
 */
/**
 * Who the bare instrument belongs to.
 *
 * The chain-head default applies ONLY to a one-time `token` or a WALLET key
 * (FUT-471), and only because either was minted moments ago from what
 * `clientConfig()` described to the browser — which is the head. A Google Pay
 * token is bound to the head's `gatewayMerchantId` and an Apple Pay payload to
 * its certificate, so a tail provider could no more read one than it could a
 * foreign encrypted blob. A `savedCardToken` has no such context: it names a
 * card in whichever provider's vault held it when the buyer saved it, possibly
 * long before the current chain existed. Defaulting a vault token to the head
 * would hand the head a foreign token AND skip the provider that can actually
 * charge it, breaking a saved-card payment that used to work.
 *
 * So an unattributed vault token is `undefined` here — unknown, not assumed.
 */
function ownerOf(
  card: NonNullable<ChargeInput['card']>,
  chainHead: ProviderName | undefined,
): ProviderName | undefined {
  if (card.tokenProvider) return card.tokenProvider;
  return card.token || card.wallet ? chainHead : undefined;
}

/** Schemes that ask the BROWSER for an instrument. The others need none. */
const NEEDS_INSTRUMENT: ReadonlySet<ClientTokenization> = new Set(['PUBLIC_KEY', 'SDK']);

/** What the resolved adapter declares — the slice the ownership rules read. */
type DeclaredCapabilities = Pick<ProviderCapabilities, 'tokenization' | 'wallets'>;

/**
 * A wallet charge on a provider that never declared that wallet (FUT-471), or
 * null when the wallet question does not arise. Checked BEFORE ownership is
 * even asked: an undeclared wallet is a guaranteed rejection, and the skip
 * semantics (nothing went out) are exactly a foreign instrument's.
 */
function walletRefusal(
  card: NonNullable<ChargeInput['card']>,
  provider: ProviderName,
  capabilities: DeclaredCapabilities | undefined,
): NoInstrument | null {
  const wallet = card.wallet;
  if (!wallet || !capabilities) return null;
  if ((capabilities.wallets ?? []).includes(wallet.type)) return null;
  return { reason: `provider ${provider} does not support the ${wallet.type} wallet` };
}

export function chargeInputFor(
  input: ChargeInput,
  provider: ProviderName,
  chainHead: ProviderName | undefined,
  /**
   * What this provider DECLARES — tokenization scheme and wallet support.
   * Optional only so a caller with no adapter in hand still gets the
   * ownership rules; `step()` has already resolved the adapter and always
   * passes its capability table.
   */
  capabilities?: DeclaredCapabilities,
): ChargeInput | NoInstrument {
  const card = input.method === 'CARD' ? input.card : undefined;
  if (!card) return input;
  const refused = walletRefusal(card, provider, capabilities);
  if (refused) return refused;
  const tokenization = capabilities?.tokenization;

  const mine = card.tokensByProvider?.[provider];
  if (mine) {
    // Minted for this provider specifically — the only case where failing a
    // card charge over is genuinely safe.
    return { ...input, card: { ...card, token: mine, savedCardToken: undefined } };
  }

  const owner = ownerOf(card, chainHead);
  // The instrument we hold is THIS provider's own — send it, whatever the
  // provider declares. Checked before the capability rule below so a vaulted
  // card is never dropped from the charge that names its vault.
  if (owner === provider) return input;

  // DECIDED BY WHAT THE PROVIDER ASKS FOR, not by who owns the blob we hold.
  // A REDIRECT page takes the card on its own site and a NONE provider wants
  // no instrument at all, so neither can be "holding someone else's" — they
  // are attempted, with the card block dropped, because there is nothing here
  // either of them could read.
  if (tokenization && !NEEDS_INSTRUMENT.has(tokenization)) {
    return { ...input, card: undefined };
  }

  return byOwnership(input, card, provider, owner);
}

/**
 * The provider needs an instrument and none was minted FOR it — so whose is
 * the one we hold, and does that leave anything worth sending?
 */
function byOwnership(
  input: ChargeInput,
  card: NonNullable<ChargeInput['card']>,
  provider: ProviderName,
  owner: ProviderName | undefined,
): ChargeInput | NoInstrument {
  if (owner) return noInstrument(provider, owner);

  // Unattributed, and this provider DOES need an instrument. Which of the two
  // unattributed shapes it is decides the answer:
  //
  //  - a minted MAP is a complete statement (one entry per provider the
  //    browser could mint for), so a provider missing from it has none. It is
  //    SKIPPED. Attempting it sends an EMPTY token to a provider that requires
  //    one: a guaranteed rejection filed as a provider failure, which then
  //    denies the buyer the named-field answer a gated chain owes them, and on
  //    a timeout can strand the order before the provider that could have paid.
  //  - a bare vault token says nothing about its owner: it passes through so
  //    the adapter decides, rather than skip the one provider that can charge.
  const minted = card.tokensByProvider;
  if (minted && Object.keys(minted).length > 0) return noInstrument(provider, undefined);
  return input;
}

/** Why `provider` cannot be attempted with what we hold. */
function noInstrument(provider: ProviderName, owner: ProviderName | undefined): NoInstrument {
  return {
    reason:
      `no card instrument minted for ${provider} ` +
      `(held instrument belongs to ${owner ?? 'an unknown provider'}); ` +
      'mint one per provider via clientConfigChain() to enable card failover',
  };
}

/** Narrowing helper — `chargeInputFor` returns one or the other. */
export function hasInstrument(result: ChargeInput | NoInstrument): result is ChargeInput {
  return !('reason' in result);
}

/**
 * Does this chain offer ANY in-browser card path? (ported from the first
 * adopting host, FUT-760.)
 *
 * A checkout has to know BEFORE it raises a charge whether to show a card form
 * or hand the buyer to a provider's own page — and the answer is read off the
 * adapters' declared `tokenization`, never off their names, so a fifth
 * provider needs no edit anywhere.
 *
 * Asked of the WHOLE CHAIN, not the head. With failover the head is not
 * entitled to answer alone: a store whose head is a hosted page but whose next
 * provider tokenizes in the browser must still show the form, or the buyer is
 * handed over before the chain has been walked and the failover the merchant
 * configured can never happen.
 *
 * An EMPTY chain answers false — a store with nothing connected has no charge
 * path to choose between, and its caller has already failed closed.
 *
 * Hosts were spelling the `PUBLIC_KEY`/`SDK` set out for themselves to ask
 * this; it is {@link NEEDS_INSTRUMENT}, the same set the walk routes on, and a
 * second copy in a host is a copy that drifts.
 */
export function chainTokenizesInBrowser(
  chain: readonly { tokenization: ClientTokenization }[],
): boolean {
  return chain.some((entry) => NEEDS_INSTRUMENT.has(entry.tokenization));
}

/**
 * Do we hold a card instrument THAT PROVIDER could charge? (ported from the
 * first adopting host, FUT-760.)
 *
 * Distinct from {@link chargeInputFor}, which decides what to SEND during a
 * walk. This answers a question asked before any walk begins: whether a live
 * charge already raised at `provider` is still the honest answer to a re-tap.
 *
 * "Is there a card in the request" is the wrong test and was a real defect —
 * the card route always sends one, so once a chain could land on a REDIRECT
 * provider from the card form, a second submit walked the chain again while
 * the first hosted link was still payable: two payable charges for one order.
 * The right question is whether the card we hold could have produced a
 * DIFFERENT charge at that provider. For a provider we minted no instrument
 * for — a hosted page, which takes the card on its own site — the answer is
 * no, and the buyer gets back the link they already have.
 */
export function holdsInstrumentFor(
  card: ChargeInput['card'] | undefined,
  provider: ProviderName,
): boolean {
  if (!card) return false;
  // A minted MAP is a complete statement: a provider missing from it has no
  // instrument here, whatever else the block carries.
  const minted = card.tokensByProvider;
  if (minted && Object.keys(minted).length > 0) return Boolean(minted[provider]);
  return Boolean(card.token ?? card.savedCardToken);
}

/**
 * The card block to hand the gateway when the browser minted one instrument
 * PER provider (ported from the first adopting host, FUT-760).
 *
 * The bare `token` is dropped on purpose. An unattributed token defaults to
 * the chain head (see {@link ownerOf}), and every provider WITHOUT an entry in
 * the map would then look like it was handed a foreign instrument and be
 * skipped — including a REDIRECT provider, which needs no instrument at all
 * and is otherwise the one entry a card charge can always fall through to.
 *
 * A saved card is left untouched: its owner is whichever provider's vault
 * holds it, which the gateway resolves for itself.
 */
export function attributedCard(card: ChargeInput['card'] | undefined): ChargeInput['card'] {
  const minted = card?.tokensByProvider;
  if (!card || !minted || Object.keys(minted).length === 0) return card;
  if (card.savedCardToken) return card;
  return { tokensByProvider: minted };
}
