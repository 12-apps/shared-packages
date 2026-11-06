/**
 * The months' frame in the in-page (`beside`) layout, and the fields' column
 * beside it: how wide each is, with and without `fullWidth`. Kept out of the
 * component so that file stays a layout of parts.
 */
import type { Theme } from '@mui/material/styles/index.js';

import { rem, sxRem } from '../../../tokens/relative';
import { surfaces } from '../../../tokens/surfaces';
import { CARD_RADIUS_UNITS } from '../../layout/Card/Card.metrics';

import { framedMonthsWidth } from './DateRangePicker.layout';

export const CALENDAR_CLASS = 'date-range-picker__calendar';

// `Calendar` renders its own `Paper` with 24px of padding. Nested in this one
// that reads as a box inside a box, so the inner frame is flattened here
// through the className hook the component exposes for exactly this.
export const FLAT_CALENDAR = {
  [`& .${CALENDAR_CLASS}`]: {
    p: 0,
    boxShadow: 'none',
    backgroundColor: 'transparent',
    backgroundImage: 'none',
  },
};

/**
 * The months' own frame in the `beside` layout: the picker is part of a page
 * there, so the frame holds the calendar alone and the fields sit on the page
 * beside or under it, as the form's other fields do.
 */
const BESIDE_FRAME_SX = {
  p: 2,
  maxWidth: '100%',
  minWidth: 0,
  // A card on the page, as the prototype draws it: the RAISED surface role
  // (`background.paper` unless the host states one — a host whose paper is its
  // page ground states a lighter card there) and the default `Card`'s radius,
  // not a Paper's 4px (FUT-4156, round 3). In-page only: the popover keeps its own.
  bgcolor: (theme: Theme) => surfaces(theme).raised,
  borderRadius: (theme: Theme) => theme.spacing(CARD_RADIUS_UNITS.md),
  ...FLAT_CALENDAR,
} as const;

/**
 * Under the fields' row the frame is as wide as its months and centred: a
 * frame stretched across the page around one month left a third of itself
 * blank (FUT-4156, 600 and 900 wide).
 */
const BELOW_FRAME_SX = {
  ...BESIDE_FRAME_SX,
  alignSelf: 'center',
  width: 'fit-content',
} as const;

/**
 * `fullWidth`: the frame's edges are the picker's. Under the fields it spans
 * the picker; beside them it takes the row the fields' column leaves, and the
 * months spread across it (FUT-4156: a fitted frame left blank bands of 10 to
 * 77px each side at 390, 600 and 900 wide).
 */
/**
 * Under the fields the frame gives up its side padding before its columns
 * drop under 40 design px: seven 40px columns and the hairlines need 282, so
 * the padding is what is left of the row past that, never more than its 16
 * (FUT-4156, round 3: at 320 wide the columns were 36). `100%` is the row's
 * width — padding percentages read the containing block.
 */
export const FILL_COLUMN_MIN = 40;
const sidePadding = (theme: Theme): string =>
  `clamp(0px, calc((100% - ${rem(theme, 7 * FILL_COLUMN_MIN + 2)}) / 2), ${theme.spacing(2)})`;
const FILL_BELOW_FRAME_SX = { ...BESIDE_FRAME_SX, alignSelf: 'stretch', px: sidePadding } as const;
// Never narrower than its months at their full size: the fields' column gives
// way first, down to the room `besideLayout` chose this placement with.
const fillBesideFrameSx = (months: number) =>
  ({ ...BESIDE_FRAME_SX, flex: '1 1 auto', minWidth: sxRem(framedMonthsWidth(months)) }) as const;

/**
 * The fields' column beside a filling frame stops at 320 design px: at 1920
 * wide it ran to 694 for a ten-character date, with the room under it blank.
 */
const FILL_FIELDS_COLUMN = { flex: '0 1 auto', width: sxRem(320), minWidth: 0 } as const;

export const frameSx = (sideBySide: boolean, fill: boolean, months: number) => {
  if (fill) return sideBySide ? fillBesideFrameSx(months) : FILL_BELOW_FRAME_SX;
  return sideBySide ? { ...BESIDE_FRAME_SX, flex: '0 0 auto' } : BELOW_FRAME_SX;
};

export const fieldsColumnSx = (sideBySide: boolean, fill: boolean) =>
  fill && sideBySide ? FILL_FIELDS_COLUMN : { flex: 1, minWidth: 0 };

