/**
 * The months' frame in the in-page (`beside`) layout, and the fields' column
 * beside it: how wide each is, with and without `fullWidth`. Kept out of the
 * component so that file stays a layout of parts.
 */
import { sxRem } from '../../../tokens/relative';

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
const FILL_BELOW_FRAME_SX = { ...BESIDE_FRAME_SX, alignSelf: 'stretch' } as const;
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

