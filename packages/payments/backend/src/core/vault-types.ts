import type { ClientTokenization, CustomerInfo, ProviderName } from './types';

/**
 * VAULTING — saving an instrument for later off-session use, without charging
 * anything now (FUT-340).
 *
 * ## Why this is not `createCharge` with a zero amount
 *
 * Because the providers do not agree that it is a charge at all. Stripe vaults
 * through a SetupIntent, which never moves money and is a different object with
 * a different lifecycle; PagBank vaults through its Card Validation & Storage
 * API (`POST /tokens/cards`, FUT-478) — one storage call with no session
 * object anywhere. Modelling vaulting as a charge would have forced both flows
 * through a shape neither has; modelling it as "just save this token" would
 * have ignored that Stripe's browser must complete a provider-side handshake
 * first. PagBank's sessionless flow still fits the two steps: `begin` merely
 * equips the browser to encrypt, and `complete` carries the blob via `token`.
 *
 * So it is two steps, mirroring what actually happens:
 *
 *   begin     the server asks the provider for a session and hands the browser
 *             what it needs — a publishable key, a client secret, or both.
 *   complete  the browser has confirmed with the provider; the server asks the
 *             provider what was created and gets back durable references.
 *
 * A third, later step undoes it:
 *
 *   forget    the tenant takes the card off file; the server tells the
 *             provider to stop storing it. Optional per adapter — a provider
 *             that cannot detach is a provider whose vault entry outlives our
 *             pointer, which the host must be told rather than left to assume.
 *
 * The PAN never enters either step. It goes from the cardholder's keyboard to
 * the provider, and what comes back to us is an opaque id plus the display
 * metadata the provider chose to share.
 *
 * ## The check that makes `complete` safe
 *
 * `complete` is reached from a browser, so its inputs are attacker-controlled:
 * a session id names an object at the PROVIDER, not in our database. Without a
 * check, a tenant could post somebody else's session id and attach a stranger's
 * card to their own subscription.
 *
 * The check is `reference`. `begin` stamps it into the session's provider-side
 * metadata, where the browser can neither read nor alter it, and `complete`
 * requires the session to carry the reference the HOST passed in — a value the
 * host reads from its own row, never from the request. That ties the session to
 * one subscription rather than merely to one customer, and it works on a
 * tenant's FIRST card, when no customer reference exists yet to compare
 * against. `customerRef` is checked too when the host holds one, but it cannot
 * be the primary check for exactly that reason.
 *
 * The check binds to SESSIONS. A sessionless `complete` (PagBank's `token`)
 * carries the instrument itself, which names nothing at the provider until
 * that very request stores it — there is no pre-existing object for another
 * tenant to point at, so there is nothing for the reference to guard.
 */

/** What the host knows when it starts vaulting a card. */
export interface VaultBeginInput {
  /**
   * Stable host-side owner — the subscription. Forwarded as provider metadata
   * so a vault object in a provider dashboard traces back to a tenant.
   */
  reference: string;
  /** The tenant, as the provider's customer. */
  customer: CustomerInfo;
  /**
   * A provider customer this tenant already has. Reused rather than recreated:
   * a second `cus_` per tenant would scatter their instruments across objects
   * and make "replace my card" ambiguous.
   */
  customerRef?: string;
}

/** What the browser needs to mint the instrument. */
export interface VaultSession {
  provider: ProviderName;
  /** How the browser must tokenize — the same vocabulary as `clientConfig`. */
  tokenization: ClientTokenization;
  /** The provider customer this vault attaches to. Persist it. */
  customerRef?: string;
  /** Publishable/public key, for SDK and PUBLIC_KEY flows. */
  publicKey?: string;
  /**
   * One-time secret the browser confirms against (Stripe's SetupIntent
   * `client_secret`). Safe to send to the client — that is its purpose — but
   * it is single-use and scoped to one session, never a credential.
   */
  clientSecret?: string;
  /** The provider's id for this session, echoed back to `complete`. */
  sessionId?: string;
}

/** What the browser reports once the provider has accepted the card. */
export interface VaultCompleteInput {
  /**
   * The host-side owner this session MUST belong to — the ownership check.
   *
   * Read from the host's own row, never from the request. `begin` put it in
   * the session's provider-side metadata, so a session minted for a different
   * subscription cannot satisfy it.
   */
  reference: string;
  /** The customer the host holds, when it already has one. Checked as well. */
  customerRef?: string;
  /** The session the browser confirmed. */
  sessionId?: string;
  /**
   * A directly-minted instrument, for providers with no session step —
   * PagBank's browser-encrypted card blob, which its `complete` stores via
   * `POST /tokens/cards` (FUT-478).
   */
  token?: string;
}

/**
 * What the host knows when it takes a card back OFF file.
 *
 * The mirror of `complete`, and safe for the opposite reason: nothing here is
 * attacker-controlled. `instrumentId` is a value the host minted through
 * `complete` and has held in its own row ever since — a browser never names an
 * instrument, it only asks for "my card" and the host resolves which row that
 * is. So there is no ownership check to perform at this seam; the host's own
 * lookup IS the check.
 *
 * The operation must be IDEMPOTENT in effect: the end state a caller wants is
 * "this instrument is not stored at the provider any more", and an instrument
 * that was already gone satisfies that. Adapters signal an id the provider
 * will never act on with a non-retriable `ProviderRequestError`, and the host
 * decides whether to drop its pointer anyway — that policy is not the
 * adapter's to make.
 */
export interface VaultForgetInput {
  /** The vault id to detach — from the host's own row, never from a request. */
  instrumentId: string;
  /** The customer it hangs off, for providers whose detach needs both. */
  customerRef?: string;
}

/**
 * The durable result — everything the host persists, and nothing else.
 *
 * Note what is absent: no PAN, no CVV, no expiry the host is expected to
 * enforce. `expMonth`/`expYear` are for display only; an expired card is
 * discovered by the issuer declining it, not by us comparing dates to a clock
 * the issuer does not share.
 */
export interface VaultedInstrument {
  provider: ProviderName;
  customerRef?: string;
  /** The vault id a later charge presents as `card.savedCardToken`. */
  instrumentId: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
}
