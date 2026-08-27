import type { ActivationChargeCopy } from '../charge-copy';
import type { RedirectActivationCopy } from '../copy';

/**
 * Every sentence step 3 puts in front of a store owner (FUT-764 burn-down).
 *
 * Required, with no defaults — this package's doctrine, stated in
 * `checkout/view-copy.ts` and again in `settings-copy.ts`: a default in the
 * origin host's language reads as finished to the next host right up until an
 * owner sees it.
 *
 * The split is the one the whole port draws. WHICH outcome the activation
 * charge reached — refused at creation, refused on payment, unreachable,
 * expired, outstanding, already proven — is knowledge of the activation
 * lifecycle and it stays here. The words are the host's.
 *
 * ## What is NOT in here
 *
 * The provider's own display name: it arrives as `displayName` and is
 * interpolated by the functions below, because "InfinitePay" is InfinitePay's
 * name in every language.
 *
 * The AMOUNT. Every sentence that names one takes an already-formatted string,
 * because how a host writes money is a decision it has made elsewhere — and
 * because the figure is the provider's, not this package's to round.
 */

/** The step's heading and the two sentences under it, per flow. */
export interface ActivationIntroCopy {
  /** The heading both flows carry — "Passo 3 · …". */
  readonly title: string;
  /**
   * The card flow's lead: a test charge on the owner's own card, refunded.
   *
   * Takes the formatted amount or `null` — the window before the endpoint has
   * priced the charge. A package that guessed a cent there would have the
   * screen promise one figure while the button charged another, which is the
   * exact lie this step exists to remove.
   */
  cardBody(amountLabel: string | null): string;
  /** The redirect flow's first line: what is about to be charged. */
  realCharge(amountLabel: string): string;
  /** Its second: whose money moves, and where it lands. */
  payingYourself(amountLabel: string): string;
}

/** The buttons that start a charge, and the one that re-runs a settled test. */
export interface ActivationActionCopy {
  /** The card flow's submit — takes the formatted amount, or `null`. */
  chargeAndActivate(amountLabel: string | null): string;
  /** The redirect flow's submit, which always names an amount. */
  payAndActivate(amountLabel: string): string;
  /** Re-run the activation TEST — not "retry a failed read". */
  readonly testAgain: string;
  /** The retry button on the settled-and-refused state. */
  readonly retry: string;
  /** "Try again" for an outage, which is a different act from `retry`. */
  readonly tryAgain: string;
  /** Clear a refused creation and return the step to its start. */
  readonly restart: string;
  /** Mint a replacement for a link whose window elapsed. */
  readonly generateNewCharge: string;
  /** Ask the provider right now instead of waiting for the next tick. */
  readonly checkNow: string;
  /** The same, worded for someone who has just paid. */
  readonly alreadyPaidCheckNow: string;
  /** Where the owner goes next: the order providers are tried in. */
  readonly setProviderOrder: string;
  /** And the shop this connection now takes money for. */
  readonly seePublishedStore: string;
}

/** The outstanding-payment panel, and the link it is waiting on. */
export interface ActivationAwaitingCopy {
  /** The return trip: the owner has paid and we are only confirming. */
  readonly receivedTitle: string;
  readonly receivedBody: string;
  /** A refused attempt on a charge that is still payable. */
  readonly declinedTitle: string;
  /** The live link's own panel. */
  readonly waitingTitle: string;
  waitingBody(amountLabel: string): string;
  /** How long ago the provider was last asked, in seconds. */
  lastChecked(seconds: number): string;
  readonly openPaymentPage: string;
  readonly copyLink: string;
  readonly linkCopied: string;
  readonly showLink: string;
  readonly hideLink: string;
}

/** The settled outcomes — where this screen earns its keep. */
export interface ActivationOutcomeCopy {
  /** Passed, with the refund already made. */
  readonly approvedTitle: string;
  refundedBody(amountLabel: string): string;
  /** Passed, refund still in flight. */
  refundPendingBody(amountLabel: string): string;
  /** The fallback for a sentence that must name an amount before one is known. */
  readonly someAmount: string;
  /**
   * Refused on PAYMENT. The owner IS connected, so a sentence about the
   * connection failing would send them to reauthorize something that works.
   */
  readonly authenticatedNotActive: string;
  /** Refused at CREATION — a provider-side switch, which is a step not an error. */
  refusedTitle(displayName: string): string;
  refusedBody(displayName: string): string;
  /** The provider was never reached: it refused nothing, so blame nothing. */
  readonly unreachableTitle: string;
  /** The link's window elapsed unpaid. No blame, and the offer of another. */
  readonly expiredTitle: string;
  /** The redirect flow's own success, which settles without a refund leg. */
  readonly settledTitle: string;
  settledBody(amountLabel: string): string;
  /** Already proven — the only honest thing the step can render on a reload. */
  readonly provenTitle: string;
  readonly provenBody: string;
  /** The provider's raw refusal, above the verbatim block. */
  readonly providerSaid: string;
  /** An earlier step is unconfirmed, so no new charge is offered yet. */
  readonly blockedTitle: string;
  readonly blockedBody: string;
}

/** The CPF field the card flow asks for beside the card. */
export interface ActivationTaxIdCopy {
  readonly label: string;
  readonly hint: string;
  readonly placeholder: string;
}

/**
 * Everything step 3 says.
 *
 * `charge` and `redirect` are the two protocol packs the hooks already
 * required — carried here rather than beside them so a host answers the step
 * in ONE object, which is what stops half of it going unread.
 */
export interface ActivationStepCopy {
  readonly intro: ActivationIntroCopy;
  readonly actions: ActivationActionCopy;
  readonly awaiting: ActivationAwaitingCopy;
  readonly outcome: ActivationOutcomeCopy;
  readonly taxId: ActivationTaxIdCopy;
  /** The card protocol's three sentences, plus the card form's own words. */
  readonly charge: ActivationChargeCopy;
  /** The redirect protocol's four. */
  readonly redirect: RedirectActivationCopy;
}
