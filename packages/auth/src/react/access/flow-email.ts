import { useCallback, useState } from "react";

/**
 * The address, carried across the whole flow.
 *
 * ## The journey this exists for
 *
 * Sign in → "esqueci minha senha" → check your e-mail → open the link → set a
 * new password → sign in. That is five screens, and a person types their
 * address ONCE. Every retype is a chance to typo the one field that decides
 * whether any of it works, and the commonest support ticket in this flow is
 * somebody who reset the password of an address they do not own.
 *
 * ## Why a hook and not a route param
 *
 * The address must not travel in the URL. A reset flow whose e-mail is in the
 * querystring puts it in browser history, in the Referer header of every asset
 * the page loads, and in whatever analytics the host runs — for an address that
 * is, by construction, one half of a credential. Keeping it in memory means it
 * survives exactly as long as the flow does and no longer.
 *
 * That it does NOT survive a reload is the correct trade, not a limitation:
 * somebody who reloads mid-flow is somebody whose context is already gone, and
 * a prefilled field they did not type is worse than an empty one.
 *
 * The host owns the state so it can seed it — a sign-in screen reached with an
 * address already known (an invite, a returning session) starts filled.
 */

export interface FlowEmail {
  /** The address as it stands. Empty string when nobody has typed one. */
  email: string;
  /** Record what was typed or confirmed. */
  setEmail: (next: string) => void;
  /**
   * Drop it — "use another e-mail", or a completed flow.
   *
   * Explicit rather than a `setEmail("")` call at each site: clearing is a
   * DECISION (the person said this address was wrong), and naming it keeps it
   * from being confused with a field that happens to be blank.
   */
  clearEmail: () => void;
}

/** Carry one address across the screens of a single access flow. */
export function useFlowEmail(initial = ""): FlowEmail {
  const [email, setEmailState] = useState(initial);
  const setEmail = useCallback((next: string) => {
    // Trimmed at the boundary rather than at each field: a trailing space
    // pasted from a mail client is the single most common reason an address
    // that looks right is refused.
    setEmailState(next.trim());
  }, []);
  const clearEmail = useCallback(() => setEmailState(""), []);
  return { email, setEmail, clearEmail };
}
