/**
 * THE PRODUCT'S TWO INKS, AND THE TWO RULES FOR CHOOSING BETWEEN THEM.
 *
 * Split out of `theme.ts` when that file reached the 400-line cap, and the seam
 * is a real one rather than a place the knife happened to land: everything here
 * answers one question — given a surface, which of the two inks goes on it —
 * and nothing here builds a palette. `theme.ts` keeps the tables and the
 * factories and imports the answers.
 *
 * Both functions stay exported from `theme.ts` as well, because both were
 * published from there and a caller should not have to learn about this file.
 */
import { getContrastRatio } from './color';

/** MUI's `createPalette` contrast defaults, exactly. */
export const CONTRAST_THRESHOLD = 3;
export const DARK_TEXT_PRIMARY = 'rgba(0, 0, 0, 0.87)';
export const LIGHT_TEXT_PRIMARY = '#fff';

/**
 * MUI's `getContrastText`: white where white reads at 3:1 on the colour, the
 * light mode's dark ink otherwise. (MUI's source spells the white as the DARK
 * palette's `text.primary`, which is what made it easy to read backwards.)
 */
export function contrastText(background: string): string {
  return getContrastRatio(background, LIGHT_TEXT_PRIMARY) >= CONTRAST_THRESHOLD
    ? LIGHT_TEXT_PRIMARY
    : DARK_TEXT_PRIMARY;
}

/**
 * The ink that reads on EVERY one of these fills (FUT-1924).
 *
 * {@link contrastText} answers for one fill, which is all MUI's `augmentColor`
 * ever needs: a solid button is a single flat colour. Two components paint the
 * label over something that is not one colour — `Button`'s `gradient` variant
 * runs between two stops, and `Switch`'s thumb travels the whole length of a
 * checked track — and both of them stated `#fff` outright instead, which is
 * white-on-pale the moment a white-labelled host hands the library a pale
 * brand. Audited across the library, those two were the only places a hardcoded
 * white sat over a surface the TENANT chooses.
 *
 * **This deliberately does not follow `contrastText`'s rule.** MUI's is a
 * threshold that PREFERS white — white wherever white clears 3:1 — which is a
 * brand-feel decision, and it is kept for every existing caller so nothing
 * already legible moves. Here the fills can disagree: over MUI's own success
 * pair white is 2.78:1 on `#4caf50` and dark ink 2.66:1 on `#1b5e20`, so
 * neither meets any threshold and asking whether one does is the wrong
 * question. The answer is whichever ink has the better WORST case across the
 * fills — which is also not what either fill says on its own, since
 * `contrastText('#4caf50')` is dark ink.
 *
 * A gradient wide enough that neither ink clears 4.5:1 anywhere is a palette
 * problem this cannot fix — it returns the less bad ink and does not pretend
 * otherwise.
 *
 * **It no longer takes the better ink for free (FUT-2066).** "Better worst
 * case" decides WHICH ink wins; {@link INK_CHANGE_MARGIN} decides whether the
 * win is big enough to repaint a brand over. The two rows that moved when this
 * function landed were `warning` — 2.16:1 white on an orange, the defect — and
 * `danger`, bought for a quarter of a point. Only the first survives the
 * margin, which is the whole point: one of them was a fix and the other was
 * churn, and nothing in the old rule could tell them apart.
 *
 * `Math.min` is the claim, and it is worth knowing that no test can prove it
 * against `Math.max` today: the two candidate inks sit at opposite ends of the
 * luminance range, so ranking them by their best fill and by their worst gives
 * the same winner for every possible pair (checked exhaustively). Worst case is
 * still what this MEANS, and the moment a third ink or one that is not an
 * extreme is offered, the two stop agreeing.
 *
 * `incumbent` is the palette's own `contrastText` for this role — what both
 * call sites already passed, under the name `fallback`. It is still returned
 * when a fill cannot be decomposed ({@link getContrastRatio} throws on a format
 * it does not know, and a throw inside an emotion style function takes the
 * render down with it), so nothing about that path changed; it has simply
 * stopped being only a last resort.
 */
/**
 * HOW MUCH BETTER THE OTHER INK HAS TO BE BEFORE A BRAND IS REPAINTED (FUT-2066).
 *
 * Half a contrast point. The rule this guards is "take the better worst case",
 * and on MUI's own stock palette that rule repainted `danger`'s gradient button
 * from white-on-red to black-on-red for **0.25 of a point** — 3.49 against 3.74,
 * with neither ink clearing AA either way. A rule that churns a brand for a
 * rounding difference will churn it again on the next palette tweak, and the
 * consumer who has to explain why their destructive button changed colour has
 * no better answer than "it rounded the other way".
 *
 * The number sits in a wide measured band rather than on a cliff. Walking the
 * five gradient pairs `Button.styles.ts` paints, the only two gaps that exist
 * are `danger`'s **0.25** — the churn — and `warning`'s **3.38**, white at
 * 2.16:1 on an orange against dark ink at 5.54:1, which is the defect FUT-1924
 * exists for. Anything in `[0.3, 3.38]` separates them; 0.5 is the round number
 * nearest the bottom of that band, so the next palette move has to be
 * substantially larger than a rounding difference before this fires.
 *
 * FUT-2066 recorded this as undecidable, on a measurement that turns out to be
 * wrong: it reports the incumbent for `success` as DARK ink and concludes that
 * a margin would hold it at 2.66 where the current rule gets 2.78. The gradient
 * runs `success.light → success.dark`, but `contrastText` answers for
 * `success.MAIN` — `#2e7d32`, not the `#4caf50` the table names — and white on
 * `#2e7d32` is 5.7:1, so the incumbent is white and a margin leaves that row
 * exactly where it is. With that row corrected the objection goes away and the
 * shape the ticket proposed is simply right.
 */
const INK_CHANGE_MARGIN = 0.5;

/**
 * The contrast below which the incumbent is not worth keeping at any margin.
 *
 * MUI's own `contrastThreshold`, and the same number for the same reason: below
 * 3:1 an ink is not a brand decision, it is text nobody can read. `warning` is
 * caught by this AND by {@link INK_CHANGE_MARGIN} — white sits at 2.16:1 on
 * that orange — which is deliberate: the one row that has to move should not
 * depend on which clause fires.
 */
const INK_CHANGE_FLOOR = CONTRAST_THRESHOLD;

export function inkOver(fills: readonly string[], incumbent: string): string {
  try {
    const worstCase = (ink: string): number =>
      Math.min(...fills.map((fill) => getContrastRatio(ink, fill)));

    const better =
      worstCase(LIGHT_TEXT_PRIMARY) >= worstCase(DARK_TEXT_PRIMARY)
        ? LIGHT_TEXT_PRIMARY
        : DARK_TEXT_PRIMARY;

    // The incumbent is the palette's OWN answer for this role, which is what
    // makes "keep it unless the gain is material" a statement about churn
    // rather than about arithmetic. It arrives as the same argument that used
    // to be the parse-failure fallback, because it always was `contrastText`
    // at both call sites — the parameter has stopped being a last resort and
    // started being the thing being defended.
    const held = worstCase(incumbent);
    const gain = worstCase(better) - held;
    return gain >= INK_CHANGE_MARGIN || held < INK_CHANGE_FLOOR ? better : incumbent;
  } catch {
    return incumbent;
  }
}
