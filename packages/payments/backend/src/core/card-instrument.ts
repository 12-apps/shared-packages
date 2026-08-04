import type { ChargeInput, ProviderName } from './types';

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
 * The chain-head default applies ONLY to a one-time `token`, and only because
 * that token was minted moments ago from what `clientConfig()` described to
 * the browser — which is the head. A `savedCardToken` has no such context: it
 * names a card in whichever provider's vault held it when the buyer saved it,
 * possibly long before the current chain existed. Defaulting a vault token to
 * the head would hand the head a foreign token AND skip the provider that can
 * actually charge it, breaking a saved-card payment that used to work.
 *
 * So an unattributed vault token is `undefined` here — unknown, not assumed.
 */
function ownerOf(
  card: NonNullable<ChargeInput['card']>,
  chainHead: ProviderName | undefined,
): ProviderName | undefined {
  if (card.tokenProvider) return card.tokenProvider;
  return card.token ? chainHead : undefined;
}

export function chargeInputFor(
  input: ChargeInput,
  provider: ProviderName,
  chainHead: ProviderName | undefined,
): ChargeInput | NoInstrument {
  const card = input.method === 'CARD' ? input.card : undefined;
  if (!card) return input;

  const mine = card.tokensByProvider?.[provider];
  if (mine) {
    // Minted for this provider specifically — the only case where failing a
    // card charge over is genuinely safe.
    return { ...input, card: { ...card, token: mine, savedCardToken: undefined } };
  }

  const owner = ownerOf(card, chainHead);
  // Unattributed: either no instrument at all (a REDIRECT provider needs
  // none) or a vault token whose owner nobody recorded. Both pass through so
  // the adapter decides — the true owner accepts it, others reject it as
  // validation and the walk moves on. That is worse than knowing, but it
  // never skips the one provider that can actually charge the card.
  if (!owner) return input;

  if (owner === provider) return input;

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
