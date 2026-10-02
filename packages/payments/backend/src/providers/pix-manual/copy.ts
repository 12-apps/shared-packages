import type { ProbeUnreachableCopy } from '../copy';

/**
 * Pix manual — the store's own Pix key, shown as a static code, confirmed by
 * hand. There is no provider to be unreachable, but the pack still extends
 * `ProbeUnreachableCopy` so every pack answers the same probe vocabulary.
 */
export interface PixManualCopy extends ProbeUnreachableCopy {
  /** The option's name on cards and in sentences. */
  displayName: string;
  fields: {
    /** The store's registered Pix key — the payer's money lands there. */
    pixKey: string;
    /** Under the key: which shapes are accepted. */
    pixKeyHelp: string;
    /** BR Code tag 59: the name the payer's bank app shows before they confirm. */
    merchantName: string;
    merchantNameHelp: string;
    /** BR Code tag 60. */
    merchantCity: string;
    merchantCityHelp: string;
    /** How long an order waits for the store's confirmation before it expires. */
    confirmWithinMinutes: string;
    confirmWithinMinutesHelp: string;
  };
  /** The local probe's per-field verdicts — there is no bank to ask. */
  checks: {
    pixKeyValid: string;
    pixKeyInvalid: string;
    merchantNameValid: string;
    merchantNameInvalid: string;
    merchantCityValid: string;
    merchantCityInvalid: string;
    windowValid: (minutes: number) => string;
    windowInvalid: string;
  };
  /** The probe's headline when a field is wrong. */
  invalid: string;
  /** The probe's headline when everything checks out. */
  ready: string;
}
