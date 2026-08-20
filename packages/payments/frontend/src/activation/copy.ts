/**
 * The four sentences the redirect activation protocol has to put on screen
 * itself (FUT-763).
 *
 * It renders nothing — the host owns the screen — but four states are reached
 * INSIDE the protocol and carry a reason the host never sees the raw form of:
 * the provider answered with no message, the poll gave up, the link expired.
 * Something has to be shown, and a fallback string compiled into the package is
 * how one product's voice reaches every adopter (`DEFAULT_CHECKOUT_COPY_FE`,
 * removed for exactly that in FUT-760).
 *
 * So there are no defaults and the field is required. A host that has not
 * written these sentences finds out at the type level rather than by reading
 * another company's tone of voice on its own settings screen.
 */
export interface RedirectActivationCopy {
  /**
   * The activation link's window elapsed with nothing paid.
   *
   * Distinct from a refusal on purpose: nothing was charged, so the only
   * useful offer is another link.
   */
  chargeExpired: string;
  /** The provider answered "not paid" definitively, with no message of its own. */
  confirmFailed: string;
  /** The provider would not mint the link at all. */
  createFailed: string;
  /**
   * The bounded poll elapsed while the charge was still live.
   *
   * The wording is the part that matters and the part only a host can own: the
   * charge IS still payable, and telling an owner who has genuinely paid that
   * their payment did not arrive in time is worse than saying nothing.
   */
  confirmTimedOut: string;
}
