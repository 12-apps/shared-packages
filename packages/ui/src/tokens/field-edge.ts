import type { Theme } from '@mui/material/styles/index.js';

import { resolveFieldEdge } from './field-edge.core';

/**
 * THE EDGE THAT TELLS YOU WHERE A FIELD IS.
 *
 * Every outlined control in this package drew its resting border from
 * `alpha(theme.palette.divider, 0.23)` — or 0.2, or 0.18, or 0.42 for the
 * underline. On the MUI default theme that expression is harmless, and that is
 * exactly why it survived: MUI's own light `divider` is `rgba(0, 0, 0, 0.12)`,
 * and `alpha()` REPLACES the alpha channel rather than multiplying it, so
 * `alpha(divider, 0.23)` resolves to `rgba(0, 0, 0, 0.23)` — byte for byte the
 * border MUI's own `OutlinedInput` ships. The line reads like a restatement of
 * the default because, against the default, it is one.
 *
 * Give it a theme whose `divider` is an OPAQUE hex and the same expression
 * collapses. A themed divider is already a hairline — a pale warm cream, a pale
 * green-grey — chosen to separate two rows INSIDE a card. Fading that to 23%
 * over the card it sits on leaves a border the same colour as the card:
 *
 * | theme                          | resolved border | ratio |
 * |--------------------------------|-----------------|-------|
 * | MUI default (`rgba(0,0,0,.12)`)| `#C4C4C4`       | 1.74:1|
 * | a warm hairline `#EBD9C7`      | `#FAF6F2`       | 1.08:1|
 * | a cool hairline `#D7DDD5`      | `#EDF0EC`       | 1.06:1|
 *
 * 1.06:1 is not a faint border, it is no border: the field is invisible until
 * you click into it. Both failing rows are real adopter themes, and neither
 * adopter did anything wrong — they set `palette.divider`, which is what a theme
 * is for.
 *
 * **So the fault is using `divider` for this at all**, not the alpha on top of
 * it. Even at FULL strength those hairlines are 1.26:1 and 1.27:1 against their
 * own paper. A row separator and a control boundary are different jobs with
 * different floors, and only one of them has a number in the spec.
 *
 * ## The floor, and why it is measured rather than picked
 *
 * WCAG 2.1 SC 1.4.11 (Non-text Contrast) puts a control's own boundary at
 * {@link MIN_UI_CONTRAST}. A hex cannot satisfy that on its own, because the
 * ratio is a fact about a PAIR — the same border is fine on white and gone on a
 * dark card. So {@link fieldEdge} takes the theme's hairline as a SEED and walks
 * it away from the surface until it clears, which means:
 *
 *  - a theme whose divider already clears keeps its own colour, untouched;
 *  - one that does not gets the nearest tone of ITS OWN hairline that does, so
 *    the border still looks like the theme's, just visible;
 *  - dark mode needs no second table — the walk lightens on a dark surface for
 *    the same reason it darkens on a light one.
 *
 * This is the argument `readableInk` makes for text in `@12-apps/app-shell`,
 * applied to the boundary rather than the ink. It is not imported from there:
 * that package depends on THIS one, so the edge would be a cycle.
 *
 * ## What this does NOT touch
 *
 * Hover and focus, which every control already draws in `primary.main` — a
 * corrected brand colour that clears the floor by construction. The resting
 * state was the only one you could not see, and it is the one that matters,
 * because it is the state a field is in before anyone has found it.
 *
 * ## Where the walk itself lives
 *
 * `./field-edge.core.ts`, over two colour strings and this package's own
 * colour arithmetic. The native `Input` and `Select` draw the same border and
 * have neither a MUI `Theme` to pass nor `@mui/material/styles` to import, so
 * the algorithm sits one file below this one and both renderers call it. This
 * file is the MUI-typed door onto it, and the argument above.
 */

export { MIN_UI_CONTRAST } from './field-edge.core';

/**
 * The resting boundary for a form control on `surface`.
 *
 * `surface` defaults to `background.paper` because that is what a field sits on
 * in the overwhelming majority of cases — a dialog, a card, a form panel. A
 * control on a deliberately different ground (a tinted strip, a glass pane over
 * a photo) should pass the ground it is actually on; the answer is only as good
 * as the pair it is given.
 */
export function fieldEdge(theme: Theme, surface?: string): string {
  return resolveFieldEdge(theme.palette.divider, surface ?? theme.palette.background.paper);
}
