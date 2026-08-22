import type { CardCopy } from '../card/copy';

/**
 * The three sentences the card activation charge has to put on screen itself
 * (FUT-763).
 *
 * Same rule as `RedirectActivationCopy`, for the same reason: these states are
 * reached inside the flow and carry no message from the provider, so something
 * has to be shown — and a fallback string compiled into the package is how one
 * product's voice reaches every adopter. No defaults, and the field is required.
 */
export interface ActivationChargeCopy {
  /**
   * The card form's own words — its labels, its field-level refusals, and
   * everything a tokenizer can fail with.
   *
   * The activation charge IS a card form, so it carries the same port the
   * buyer checkout does rather than a second one shaped almost like it.
   */
  card: CardCopy;
  /**
   * No tokenizer is registered for this provider, so nothing can be encrypted
   * and there is no charge to make.
   *
   * `{provider}` is substituted with the provider's name — the one word that
   * makes the sentence actionable on a screen listing several.
   */
  noTokenizer: string;
  /** The server refused the charge and sent no reason of its own. */
  chargeFailed: string;
  /** The request never got out — the browser's own fetch threw. */
  unreachable: string;
}
