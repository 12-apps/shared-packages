/**
 * THE ONE RADIUS EVERY FIELD IS DRAWN WITH, WITH NO RENDERER BEHIND IT.
 *
 * A row of controls — a search box, three filter triggers, a "Mais" button —
 * used to carry three radii: the text field took MUI's `shape.borderRadius`
 * (4px), the button `theme.spacing(1)` (8px), and the filter triggers a 999px
 * pill. Each was reasonable on its own; side by side they read as three kits
 * glued together. A field's corner is one decision, so it is one token.
 *
 * "Field" is anything that sits at control height and takes input or opens a
 * choice: text inputs, selects, textareas, OTP slots, date and filter triggers,
 * toggles, and the buttons that share their rows. It is NOT a card, a menu, a
 * badge or a chip counter — those keep the theme's general `radius` scale.
 *
 * This file is the number alone, so the native renderer and `./theme.ts` read
 * it without importing MUI. The web reader and the theme channel it is set
 * through are in `./field-radius.ts`.
 */

/**
 * The default field radius, in px (dp on native).
 *
 * 8, because that is what `Button` has always drawn — so the control people
 * see most keeps its corner and the rest of the row comes to meet it.
 */
export const DEFAULT_FIELD_RADIUS = 8;
