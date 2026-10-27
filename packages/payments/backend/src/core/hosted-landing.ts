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
 * not mint a second payable charge. "Would land anyway" also covers a link
 * minted while the providers ahead of it were DOWN and that are STILL down:
 * the ledger of the walk that minted it shows it failed over from each of them
 * and their outage breaker is still open (`walk-history.ts`), so a re-tap
 * during that outage must not mint a fresh link on every tap. Otherwise
 * the checkout walks the CURRENT chain, and the links it moved past are retired
 * against whatever the buyer now holds (`hosted-retire.ts`).
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

/** The gateway reads the rule needs. */
interface ChainReader {
  clientConfigChain(merchant: MerchantRef): Promise<readonly ChainMember[]>;
  /** Providers the minting walk failed over from, still down now (`walk-history.ts`). Optional. */
  stillWalkedPast?(merchant: MerchantRef, idempotencyKey: string): Promise<ProviderName[]>;
}

/** The members a fresh walk for `method` may land on, in walk order. */
function capableMembers(
  chain: readonly ChainMember[],
  method: PaymentMethodKind,
  automaticOnly: boolean,
): ProviderName[] {
  return chain
    .filter((entry) => entry.methods.includes(method) && !(automaticOnly && entry.confirmation === 'MANUAL'))
    .map((entry) => entry.provider);
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
  return capableMembers(chain, method, automaticOnly)[0] ?? null;
}

/** What to do with the payable's parked hosted links. */
interface ParkedHostedVerdict {
  /** The link to hand back instead of raising, or null. */
  reuse: ChargeSnapshot | null;
  /**
   * Every OTHER parked link. Retired against whatever charge the buyer ends up
   * holding — the reused one or a new one — never dropped (`hosted-retire.ts`).
   */
  movedPast: ChargeSnapshot[];
}

/** A parked link as the store holds it: the snapshot and the walk that minted it. */
interface ParkedLink {
  snapshot: ChargeSnapshot;
  idempotencyKey?: string | null;
}

interface ParkedHostedRequest {
  merchant: MerchantRef;
  method: PaymentMethodKind;
  card?: ChargeInput['card'];
  confirmation?: 'AUTOMATIC';
}

const NOTHING_PARKED: ParkedHostedVerdict = { reuse: null, movedPast: [] };

/**
 * Would a fresh walk land on this link's provider?
 *
 * Yes when it is the FIRST capable member (the owner's rule). Also yes when
 * every capable member ranked ahead of it is one the walk that minted this
 * link, for this same method, FAILED OVER from AND that is still down now —
 * its outage breaker still open (FUT-563): minting a second link there on
 * every re-tap is the double charge FUT-604 refuses. Once those providers are
 * back, or when the chain was REORDERED (a member ahead the walk never tried —
 * the trapped payable), the current chain is walked.
 */
async function wouldLandOn(
  reader: ChainReader,
  request: ParkedHostedRequest,
  capable: readonly ProviderName[],
  link: ParkedLink,
): Promise<boolean> {
  const rank = capable.indexOf(link.snapshot.provider);
  if (rank < 0) return false;
  if (rank === 0) return true;
  if (!reader.stillWalkedPast || !link.idempotencyKey) return false;
  if (link.snapshot.method !== request.method) return false;
  const walkedPast = await reader.stillWalkedPast(request.merchant, link.idempotencyKey);
  return capable.slice(0, rank).every((provider) => walkedPast.includes(provider));
}

/**
 * Judge the payable's still-payable, not-superseded hosted links (newest first)
 * against the merchant's CURRENT chain.
 *
 * The chain is read only when there is a link to judge, so a payable with none
 * costs nothing extra. A chain read that throws PROPAGATES: without it neither
 * answer can be proved — reusing may trap the buyer, raising may mint the
 * second payable charge FUT-604 exists to prevent — and the walk would fail on
 * the same read anyway.
 *
 * The instrument clause is FUT-604's and stays: a link is still skipped when
 * the buyer brought an instrument for its provider, because reusing would
 * silently ignore the card they just typed.
 */
export async function judgeParkedHosted(
  reader: ChainReader,
  parked: readonly ParkedLink[],
  request: ParkedHostedRequest,
): Promise<ParkedHostedVerdict> {
  if (parked.length === 0) return NOTHING_PARKED;
  const chain = await reader.clientConfigChain(request.merchant);
  const capable = capableMembers(chain, request.method, request.confirmation === 'AUTOMATIC');
  let reuse: ChargeSnapshot | null = null;
  for (const link of parked) {
    if (holdsInstrumentFor(request.card, link.snapshot.provider)) continue;
    if (await wouldLandOn(reader, request, capable, link)) {
      reuse = link.snapshot;
      break;
    }
  }
  const movedPast = parked.map((link) => link.snapshot).filter((snapshot) => snapshot !== reuse);
  return { reuse, movedPast };
}
