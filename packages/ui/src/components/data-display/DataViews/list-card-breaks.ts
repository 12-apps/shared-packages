/**
 * THE WIDTHS A LIST ROW ANSWERS, measured on its query container (the group, or
 * a standalone card's wrapper) — never the viewport.
 *
 * Their own module because both the row (`base-list-card-*`) and the group
 * (`list-card-group-tracks`) ask the question, and the group's rails module is
 * already a dependency of the row's slots.
 */

/**
 * Below this the row COMPACTS: the rail gap halves, a reserved drag track no row
 * fills leaves the template, and a configured list's first cell takes a double
 * share. Between `STACK_BREAK` and here the row is still one line of columns,
 * and at 24px a gap four columns wide was spending a third of a phone-sized row
 * on air while every name ellipsised.
 */
export const COMPACT_BREAK = 600;
/** Below this the row drops its middle columns. */
export const META_BREAK = 520;
/** …and below this it leaves the shared rails and goes two-line. */
export const STACK_BREAK = 360;
