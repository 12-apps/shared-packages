/**
 * The layout's design tokens — the nine colours a mail is drawn from.
 *
 * ## Why a theme is a VALUE here and copy is required config
 *
 * The copy-portability doctrine is that a package ships no user-facing
 * sentences: a default in the origin host's language reads as finished to the
 * next host right up until somebody's customer gets mail in a language they do
 * not speak. Colour is not that. {@link NEUTRAL_EMAIL_THEME} is not anybody's
 * brand — it is grey on white, which reads as *unstyled but tidy* rather than
 * as *somebody else's product*. A host that passes nothing gets a mail that
 * looks plain, not a mail that looks like a different company.
 *
 * So this one has a default and the copy does not, and the difference is
 * exactly whether getting it wrong is invisible. A missing theme is visible in
 * the first preview; a wrong-language default is invisible until a customer
 * complains.
 *
 * ## What a host should know before overriding it
 *
 * Two rungs of most brand palettes cannot carry light text, and a mail has no
 * theme to fall back on when a client ignores a colour. {@link accent} is the
 * one that MUST clear 4.5:1 against white — it is the CTA fill and every link.
 * A warm mid-tone that looks fine on a screen at 2.6:1 is unreadable in an
 * inbox, and nothing in the pipeline will say so.
 */
export interface EmailTheme {
  /** The page behind the card. Never pure white: a white card needs a ground. */
  readonly page: string;
  /** The card itself. */
  readonly surface: string;
  /** A quieter panel inside the card — the facts table. */
  readonly panel: string;
  /** Every hairline. */
  readonly border: string;
  /** Body text. */
  readonly ink: string;
  /** Secondary text: the footer, the fallback link, a fact's label. */
  readonly muted: string;
  /** The action colour — the CTA fill and every link. Must clear 4.5:1 on white. */
  readonly accent: string;
  /** Ink ON {@link accent}. */
  readonly onAccent: string;
  /** The rule under the wordmark. Decorative — nothing is written on it. */
  readonly rule: string;
}

/**
 * A brand-free default: greys, one blue, nothing anybody would mistake for a
 * product. Every value clears its contrast requirement against its own ground.
 */
export const NEUTRAL_EMAIL_THEME: EmailTheme = {
  page: '#F5F6F8',
  surface: '#FFFFFF',
  panel: '#F5F6F8',
  border: '#E1E4E9',
  ink: '#1A1D23',
  muted: '#5C6470',
  accent: '#1F5EDB',
  onAccent: '#FFFFFF',
  rule: '#1F5EDB',
};

/**
 * The font stack, as one string.
 *
 * System fonts only, and no web font: a `@font-face` is stripped by Gmail and
 * by Outlook, so a mail that depends on one renders in whatever the client
 * substitutes — never the fallback the designer chose. The stack ends in the
 * emoji faces so a status glyph in a subject line does not drop to a tofu box
 * on Windows.
 */
export const EMAIL_FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";

/** The card's width. 600px is the width every client lays out without scroll. */
export const EMAIL_CONTENT_WIDTH = 600;
