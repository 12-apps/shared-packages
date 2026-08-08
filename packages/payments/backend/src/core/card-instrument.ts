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
