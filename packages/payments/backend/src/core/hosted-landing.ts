import { holdsInstrumentFor } from './card-instrument';
import type { ChargeInput, ChargeSnapshot, MerchantRef, PaymentMethodKind, ProviderName } from './types';

/**
 * WHEN A PARKED HOSTED LINK IS STILL THE HONEST ANSWER (FUT-4072).
 *
 * FUT-604 made a re-tap hand back the hosted link the payable already holds,
 * because a second POST walking the chain again mints a second payable charge.
 * That rule asked nothing about the CHAIN. So a payable whose link was minted
 * while the store's chain read `[A, B]` kept answering with A's page after the
 * owner reordered it to `[B, A]` — every attempt, card or PIX, sent the buyer
 * back to a provider the store no longer routes to first. The payable was
 * trapped on its first provider for as long as the link lived.
 *
 * The owner's rule: a parked link is reused ONLY when a fresh walk would land on
 * its provider anyway — that provider is still enabled, still in the chain, and
 * is the FIRST member able to take the requested method. Then reusing and
 * walking reach the same provider, and reusing is the one of the two that does
 * not mint a second payable charge. Otherwise the checkout walks the CURRENT
 * chain, and the link it moved past is retired once the new charge exists
 * (`hosted-retire.ts`).
 *
 * "Enabled and in the chain" is read from the gateway's `clientConfigChain`,
 * the same enabled-and-connected chain the checkout tokenizes for: a member the
 * owner disabled or removed is simply absent from it, so it can never be where
 * a walk lands.
 */

/** One chain member, as `PaymentsGateway.clientConfigChain` answers it. */
export interface ChainMember {
  provider: ProviderName;
  methods: readonly PaymentMethodKind[];
  confirmation?: 'AUTOMATIC' | 'MANUAL';
}

/** The one gateway read the rule needs. */
interface ChainReader {
  clientConfigChain(merchant: MerchantRef): Promise<readonly ChainMember[]>;
}

/**
 * The provider a fresh walk for `method` would try first, or null when no
 * enabled member can take it. `automaticOnly` mirrors the walk's own filter for
 * a lane where nobody can confirm a store-confirmed charge.
 */
export function landingProvider(
  chain: readonly ChainMember[],
  method: PaymentMethodKind,
  automaticOnly = false,
): ProviderName | null {
  const member = chain.find(
    (entry) =>
      entry.methods.includes(method) && !(automaticOnly && entry.confirmation === 'MANUAL'),
  );
  return member?.provider ?? null;
}

/** What to do with the payable's parked hosted links. */
interface ParkedHostedVerdict {
  /** The link to hand back instead of raising, or null. */
  reuse: ChargeSnapshot | null;
  /**
   * The links a new charge moves past — every parked link when nothing is
   * reused. They are retired only AFTER the new charge is proven live.
   */
  movedPast: ChargeSnapshot[];
}

interface ParkedHostedRequest {
  merchant: MerchantRef;
  method: PaymentMethodKind;
  card?: ChargeInput['card'];
  confirmation?: 'AUTOMATIC';
}

const NOTHING_PARKED: ParkedHostedVerdict = { reuse: null, movedPast: [] };

/**
 * Judge the payable's still-payable hosted links (newest first) against the
 * merchant's CURRENT chain.
 *
 * The chain is read only when there is a link to judge, so a payable with none
 * costs nothing extra. A chain read that throws PROPAGATES: without it neither
 * answer can be proved — reusing may trap the buyer, raising may mint the
 * second payable charge FUT-604 exists to prevent — and the walk would fail on
 * the same read anyway.
 *
 * The instrument clause is FUT-604's and stays: a link at the landing provider
 * is still skipped when the buyer brought an instrument for that provider,
 * because reusing would silently ignore the card they just typed.
 */
export async function judgeParkedHosted(
  reader: ChainReader,
  parked: readonly ChargeSnapshot[],
  request: ParkedHostedRequest,
): Promise<ParkedHostedVerdict> {
  if (parked.length === 0) return NOTHING_PARKED;
  const chain = await reader.clientConfigChain(request.merchant);
  const landing = landingProvider(chain, request.method, request.confirmation === 'AUTOMATIC');
  const reuse =
    parked.find(
      (snapshot) => snapshot.provider === landing && !holdsInstrumentFor(request.card, snapshot.provider),
    ) ?? null;
  return reuse ? { reuse, movedPast: [] } : { reuse: null, movedPast: [...parked] };
}
