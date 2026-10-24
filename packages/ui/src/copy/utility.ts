/**
 * The utility family's words — the install prompt and the account card.
 *
 * Split out of `copy.ts`, which is a barrel over this folder: one file
 * listing every family is the file that grows on every port, and it stopped
 * fitting the 400-line budget the rest of this package holds itself to.
 */

/**
 * The install prompt's own words. Two of the three surfaces here are iOS-only:
 * Safari has no programmatic install, so the component explains the gesture
 * instead of offering a button.
 */
export interface InstallPromptCopy {
  /** Headline, and the Chromium install button. */
  title: string;
  installLabel: string;
  /** The dismiss button's accessible name — it renders as a bare cross. */
  dismissLabel: string;
  /**
   * The iOS instruction, split around the Share glyph that sits INSIDE the
   * sentence: "Tap [share] then Add to Home Screen". Two halves rather than
   * one string because the glyph's position is part of the sentence and a
   * language may not put it where English does. A host wanting a different
   * shape entirely passes `iosInstructions` and replaces the whole node.
   */
  iosTapBefore: string;
  iosTapAfter: string;
  /** The Share glyph's accessible name, mid-sentence. */
  shareLabel: string;
}

/** The account card's one action, and the words standing in for a missing name. */
export interface UserAvatarCopy {
  signOut: string;
  /**
   * The avatar's `alt`, and the card's name line, when the user has no name.
   * Optional so a host's existing pack keeps compiling; the shipped packs carry
   * both and the components fall back to the English one.
   */
  avatarAlt?: string;
  unnamedUser?: string;
}
