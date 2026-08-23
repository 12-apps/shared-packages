/**
 * Every word the platform sign-in settings screen renders.
 *
 * No default is exported, deliberately — the same call the screens' own copy
 * makes. A host that forgets a field gets a compile error rather than an
 * English sentence in a Portuguese console, and the two switches are exactly
 * the place where a half-translated screen would do damage: their whole job is
 * to state what each setting COSTS.
 */
export interface EmailAuthSettingsCopy {
  /** Page title and the sentence under it. */
  title: string;
  intro: string;

  /** The e-mail + password switch. */
  methodLabel: string;
  /**
   * What turning it off costs.
   *
   * Worth writing properly: off refuses the method for everyone who already has
   * a password, and an operator who was told only "turns e-mail login off"
   * would not know whether that deletes anything.
   */
  methodDescription: string;

  /** The verification switch. */
  verificationLabel: string;
  /**
   * What turning it off costs.
   *
   * The one that must be read twice. ON also makes sign-up non-enumerating — a
   * taken address and a free one answer identically — so OFF shortens the
   * funnel and pays for it by letting sign-up reveal that an address exists.
   */
  verificationDescription: string;

  /** Shown while the method is off, because the switch above it is then inert. */
  verificationInertNote: string;

  /** The save failed. */
  saveFailedTitle: string;
  saveFailedDescription: string;
  /** The dismiss on that alert — a glyph with no visible label. */
  saveFailedDismiss: string;

  /** The settings could not be read at all. */
  loadFailedTitle: string;
  retry: string;

  /** "Last changed on {when} by {who}." — both halves supplied by the caller. */
  lastChanged: (when: string, who: string | null) => string;
}
