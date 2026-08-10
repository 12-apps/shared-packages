import type { Page } from '@playwright/test';

/**
 * The port a HOST implements to run the packaged payment journeys (FUT-561).
 *
 * The journeys themselves are portable: every assertion in them reads a test id
 * the payments package's own components render, so `card-number`,
 * `checkout-method-CARD` and `payment-paid` mean the same thing in any app that
 * mounts the checkout. What is NOT portable is everything around them — how
 * this app routes to a checkout, how a merchant of a given shape gets set up,
 * and where a host records what crossed the wire.
 *
 * That is the whole of this port. A host implements it once, adds one glob to
 * its bdd config, and inherits every scenario the library ships — including the
 * ones added after it integrated. Nothing is copied, so nothing can rot.
 */

/**
 * The SHAPE of a store a scenario is set in — never a vendor, and never a
 * screen id either.
 *
 * A scenario says what kind of merchant it is talking about; the host decides
 * how to produce one. That indirection is what lets the same journey run
 * against a harness that declares an in-page provider chain and against a real
 * app that seeds a tenant, without either of them editing the feature file.
 *
 * Adding a member here is a breaking change for hosts, which is the correct
 * cost: a new scenario that needs a store nobody can build is a scenario that
 * silently never runs.
 */
export type PaymentsStore =
  /** One provider, PIX only — the simplest store there is. */
  | 'pix-only'
  /** One provider that mints card instruments in the browser. */
  | 'card'
  /** One provider offering both methods. */
  | 'both-methods'
  /** The buyer finishes on the provider's own page. */
  | 'hosted'
  /** A PIX code nobody has paid yet — the state a buyer sits in while deciding. */
  | 'awaiting'
  /** The provider confirms on the first poll. */
  | 'settles'
  /** The issuer refuses. A real decline, not an outage. */
  | 'declined'
  /** Nobody can prove whether the money moved, and no probe answers. */
  | 'unresolved'
  /** Provably nothing left the building — the walk may advance. */
  | 'unavailable'
  /** No provider connected at all. */
  | 'no-provider'
  /** No provider, but the host offers something else to do. */
  | 'no-provider-remedy'
  /** A live chain the APPLICATION has switched online payments off for. */
  | 'payments-off'
  /** Two providers that both mint in the browser. */
  | 'two-mintable'
  /** A hand-off provider at the head, a minting one behind it. */
  | 'redirect-head'
  /**
   * A store whose chain head declares Google Pay (FUT-471): the wallet
   * capability, the PAYMENT_GATEWAY parameters, a merchant id — and a page
   * where `google.payments.api` answers, which the host provides by
   * installing a stub of it before the checkout loads (the shipped button
   * uses an installed global without touching the network).
   */
  | 'google-pay'
  /**
   * A store whose chain head declares Apple Pay (FUT-472), opened on a device
   * that HAS it: the host provides a page where `window.ApplePaySession`
   * exists and `canMakePayments()` answers true (a stub, outside Safari),
   * plus a merchant-validation port that answers a session.
   */
  | 'apple-pay'
  /**
   * The SAME Apple Pay store on a device WITHOUT Apple Pay (every non-Safari
   * browser): no `ApplePaySession` global. The scenario this hosts is the
   * fallback rule — no button, and the card form stays the way to pay.
   */
  | 'apple-pay-unsupported'
  /**
   * The buyer's saved-card WALLET (FUT-183 over FUT-478), not a checkout: the
   * host opens the package's manage-cards surface at a store whose provider
   * can vault — one mintable chain entry with the vault seam, connected in
   * stub mode — and the wallet starts EMPTY. The card the buyer types decides
   * the outcome: the package's `DECLINE_PAN` is refused at validation, any
   * other valid card is stored. (Not a digital wallet — those are the
   * `google-pay` / `apple-pay` shapes above.)
   */
  | 'wallet'
  /** Declares the on-page screen (FUT-596). */
  | 'screen-on-page'
  /** Declares the hand-off screen (FUT-596). */
  | 'screen-handoff'
  /** Declares no screen — the capability default answers. */
  | 'screen-undeclared'
  /** Declares a screen id this bundle has never shipped. */
  | 'screen-unknown';

/**
 * Facts about the host's own fixtures that the assertions have to name.
 *
 * These exist because a few Thens are about WHAT CROSSED THE WIRE, not about
 * what is on the screen — which provider received the charge, which host the
 * buyer was sent to. Those are the assertions that caught three criticals in
 * FUT-740, so they are worth the coupling; parameterising them here is what
 * keeps the feature files free of one host's invented vendor names.
 */
export interface PaymentsFixtures {
  /** The first provider of a multi-entry chain. */
  headProvider: string;
  /** The provider behind it. */
  tailProvider: string;
  /** A substring of the hosted checkout URL the buyer is sent to. */
  hostedUrlFragment: string;
  /** A substring of the payable reference the host parks before navigating. */
  payableRef: string;
  /** The CPF the buyer types, as the provider should receive it. */
  taxId: string;
}

/**
 * Where a host records what actually crossed the wire.
 *
 * A host that renders no probe can return locators that never resolve — the
 * scenarios asserting on them will fail loudly, which is the honest outcome:
 * those journeys are the ones that only pass because somebody is watching the
 * bytes, and quietly skipping them would report a coverage that is not there.
 */
export interface PaymentsWireProbe {
  /** Every request path the client made, in order. */
  paths(page: Page): ReturnType<Page['getByTestId']>;
  /** The charge body's own top-level keys. */
  chargeKeys(page: Page): ReturnType<Page['getByTestId']>;
  /** The charge body, verbatim. */
  chargeBody(page: Page): ReturnType<Page['getByTestId']>;
  /** The instrument map, or `(absent)` when none was sent. */
  tokensByProvider(page: Page): ReturnType<Page['getByTestId']>;
  /** Every charge a provider actually received, tagged with who received it. */
  providerCharges(page: Page): ReturnType<Page['getByTestId']>;
  /** How many charges reached a provider. */
  providerChargeCount(page: Page): ReturnType<Page['getByTestId']>;
  /** Where the host was asked to navigate, on a hand-off. */
  navigated(page: Page): ReturnType<Page['getByTestId']>;
}

/** Everything a host supplies to run the packaged journeys. */
export interface PaymentsWorld {
  /** Put the browser on a checkout for a store of this shape. */
  open(page: Page, store: PaymentsStore): Promise<void>;
  /** Raise a hosted payable and show the hand-off interstitial. */
  raiseHostedPayable(page: Page): Promise<void>;
  /** Bring the buyer back from the provider's page, as a real return trip. */
  returnFromProvider(page: Page): Promise<void>;
  /** The terminal status the return leg settles to. */
  hostedReturnStatus(page: Page): ReturnType<Page['getByTestId']>;
  fixtures: PaymentsFixtures;
  wire: PaymentsWireProbe;
}

let installed: PaymentsWorld | null = null;

/**
 * Install the host's implementation. Call this from a module inside the host's
 * OWN steps glob — playwright-bdd imports every step file before any scenario
 * runs, so a top-level call there is registered in time, in every worker.
 */
export function definePaymentsWorld(world: PaymentsWorld): void {
  installed = world;
}

/**
 * The installed world.
 *
 * Throws rather than degrading: a journey that ran against a half-configured
 * world would fail somewhere deep inside a step with a message about a missing
 * element, and the actual cause — a host that forgot to call
 * {@link definePaymentsWorld} — would be several layers away from the error.
 */
export function paymentsWorld(): PaymentsWorld {
  if (!installed) {
    throw new Error(
      'No PaymentsWorld installed. Call definePaymentsWorld(...) from a module ' +
        "inside this app's bdd `steps` glob — see @12-apps/payments-e2e's README.",
    );
  }
  return installed;
}
