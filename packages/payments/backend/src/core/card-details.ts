import type { ProviderName } from './types';
import type { WalletInstrument } from './wallet-types';

/**
 * Card payment details. Only tokens/ciphertexts ever transit here — a raw PAN
 * must never reach this library. Which token flavor applies depends on the
 * provider's `clientTokenization` capability (public-key encryption blob,
 * SDK-minted token, or a saved-card vault token).
 */
export interface CardDetails {
  /**
   * A wallet-minted instrument (FUT-471/472, see `./wallet-types`). When
   * present it IS the instrument: adapters send it instead of
   * `token`/`savedCardToken`, and the capability gate skips providers that
   * never declared the wallet.
   */
  wallet?: WalletInstrument;
  /** One-time token or encrypted card blob minted client-side. */
  token?: string;
  /** Provider vault token of a previously saved card. */
  savedCardToken?: string;
  /**
   * The provider-side CUSTOMER the vaulted instrument hangs off, where the
   * provider scopes its vault that way. Stripe does — a `pm_…` is attached to
   * a `cus_…` and charging it without naming the customer is rejected — while
   * PagBank's card ids are merchant-global and need none. Adapters take it
   * only if their vault requires it.
   */
  customerRef?: string;
  /**
   * MERCHANT-INITIATED: a subsequent charge in an agreed series, raised with
   * no cardholder present (a subscription cycle falling due).
   *
   * It has to be declared rather than inferred, because the card schemes treat
   * it as a different transaction: the issuer sees no authentication and, told
   * nothing, is entitled to decline for exactly that reason. Naming it is what
   * carries the stored-credential agreement, and it is also what waives the
   * customer-present authentication a scheduled job could never satisfy.
   *
   *   Stripe   `off_session: true`
   *   PagBank  `recurring: { type: 'SUBSEQUENT' }`
   */
  merchantInitiated?: boolean;
  /** 1..12 installments; adapters clamp to what the provider supports. */
  installments?: number;
  /** Cardholder name as typed at checkout (some providers require it). */
  holder?: string;
  /**
   * Which provider the bare instrument above was minted for. A card token is
   * always provider-bound (see `core/card-instrument.ts`), so the gateway has
   * to know whose it is. Defaults to the head of the merchant's chain.
   */
  tokenProvider?: ProviderName;
  /**
   * Instruments minted per provider — what makes CARD failover possible at
   * all. Without it a card charge is attemptable only on its own provider and
   * the gateway skips the rest rather than send a token that cannot work.
   */
  tokensByProvider?: Record<ProviderName, string>;
}
