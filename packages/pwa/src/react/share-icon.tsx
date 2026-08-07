/**
 * iOS's Share glyph, inline — the square with an arrow leaving the top.
 *
 * ## Why an icon and not the word
 *
 * The instruction it replaces said "toque em **Compartilhar**". That asks
 * somebody to translate a word into a control they then have to find, in a
 * toolbar they have never deliberately looked at. Recognition is the cheaper
 * operation: the glyph on screen and the glyph in the browser chrome are the
 * same shape, so there is nothing to translate.
 *
 * Drawn rather than imported, for two reasons that both matter here. The exact
 * SF Symbol is Apple's and not ours to redistribute; and an icon font or sprite
 * would be a network round-trip in a component whose entire job is to be
 * understood in the two seconds somebody looks at it.
 *
 * `currentColor` throughout, so it inherits whatever the host's text colour is
 * and stays legible in both themes without the caller configuring anything.
 */
import type { JSX } from "react";

export interface ShareIconProps {
  /** Matches the surrounding text size. Defaults to 1em, so it sits on the line. */
  size?: number | string;
}

export function ShareIcon({ size = "1.1em" }: ShareIconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: the sentence around it already names the action, so a
      // screen reader announcing "share icon" would only interrupt it.
      aria-hidden="true"
      focusable="false"
      style={{ verticalAlign: "-0.15em", flexShrink: 0 }}
    >
      {/* the box */}
      <path d="M8 11.5H5.5v8h13v-8H16" />
      {/* the arrow leaving it */}
      <path d="M12 3.5v11" />
      <path d="M8.5 7 12 3.5 15.5 7" />
    </svg>
  );
}
