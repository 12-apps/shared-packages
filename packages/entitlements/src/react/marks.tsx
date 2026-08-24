/**
 * The ✓ / − marks, as plain SVG: this package takes no icon-font dependency
 * for two glyphs, and both follow the host THEME (drawn with `currentColor`
 * under an `sx` palette colour) exactly as an icon set would.
 *
 * ## The sizing is the whole reason this is its own module
 *
 * The mark used to be written `<Box component="svg" width="20" height="20">`,
 * which renders a mark roughly TWELVE TIMES that size. `Box` is MUI's, so
 * `width` and `height` are SYSTEM PROPS: they are consumed by the styled
 * layer instead of reaching the DOM as SVG attributes, and the string `'20'`
 * is not a CSS length, so the declaration is dropped as invalid. The element
 * ends up with no attribute size and no CSS size, and an inline SVG with
 * neither falls back to the replaced-element default (300×150, here squared
 * by the viewBox) — a ~150px tick beside an 14px label, on every line of
 * every card.
 *
 * Nothing about it is visible in review: the numbers are right there in the
 * markup. So the size lives in `sx` — the one channel `Box` does not eat —
 * and `marks.test.tsx` asserts the rendered element actually carries it.
 */
import type { JSX } from 'react';

import { Box } from '@12-apps/ui/mui/Box';

/** Both marks are drawn on this box, in CSS pixels. */
const MARK_PX = 18;

interface MarkProps {
  included: boolean;
  /**
   * What the mark SAYS, for a reader who cannot see it — or null where the
   * mark is decoration beside a label that already carries the meaning.
   *
   * Never defaulted either way: a card line reads perfectly with the mark
   * hidden and would be read twice if it were not, while a matrix cell has no
   * other text at all and is empty to a screen reader without one.
   */
  label: string | null;
}

export function IncludedMark({ included, label }: MarkProps): JSX.Element {
  return (
    <Box
      component="svg"
      role={label === null ? undefined : 'img'}
      aria-hidden={label === null ? true : undefined}
      aria-label={label ?? undefined}
      viewBox="0 0 24 24"
      fill="none"
      sx={{
        // See the docblock: `width`/`height` PROPS on a Box never reach the
        // SVG. These do.
        width: MARK_PX,
        height: MARK_PX,
        flexShrink: 0,
        display: 'block',
        color: included ? 'success.main' : 'text.disabled',
      }}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      {included ? (
        <path
          d="M8 12.5l2.5 2.5L16 9.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
      ) : (
        <path d="M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </Box>
  );
}
