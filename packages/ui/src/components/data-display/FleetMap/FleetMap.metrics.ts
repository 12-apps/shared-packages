/**
 * THE NUMBERS BOTH `FleetMap` RENDERERS DRAW WITH.
 *
 * `FleetRoster.tsx` / `FleetMap.tsx` (web, MUI `sx`) and `FleetRoster.native.tsx`
 * / `FleetMap.native.tsx` (React Native) read this one table. The web hands the
 * spacing UNITS to `theme.spacing()` and the radius MULTIPLES to `sx`; native
 * multiplies the units by the theme's own spacing step and the multiples by
 * `shape.borderRadius`.
 *
 * Nothing here imports a renderer, a theme or a colour: a freshness dot's
 * COLOUR is the theme's (`success.main`, `warning.main`, `text.disabled`), and
 * the two sides reach the same palette through different doors.
 *
 * ## Why the radii are MULTIPLES and never pixels
 *
 * MUI's `sx` reads a bare number for `borderRadius` as a multiple of
 * `theme.shape.borderRadius`, so a value that already had the theme's radius
 * divided out of it is applied twice. Measured: `theme.shape.borderRadius / 4`
 * drew 4px on the default theme — which is why it looked right — and 36px on a
 * host that sets its own radius to 12. In a package whose whole premise is
 * being re-themed, only the multiple is portable, and it is the multiple that
 * both renderers store here.
 */

/** `theme.spacing(n)` for the panel's own stack. */
export const FLEET_PANEL = {
  /** Between the heading, the status region and the body. */
  gapUnits: 1.5,
} as const;

/** The roster list box. */
export const FLEET_ROSTER = {
  /** Between rows. */
  gapUnits: 0.5,
  /** `:focus-visible` ring on the web; a device has no focus ring to draw. */
  focusRingWidth: 2,
  focusRingOffset: 2,
} as const;

/** One roster row. */
export const FLEET_ROW = {
  /** Between the dot, the text block and the badge. */
  gapUnits: 1.5,
  /** `theme.spacing(y, x)`. */
  paddingYUnits: 1,
  paddingXUnits: 1.5,
  /** A MULTIPLE of `theme.shape.borderRadius` — see the note above. */
  radiusMultiple: 1,
} as const;

/**
 * The freshness dot.
 *
 * A perfect circle, so the radius is half the box on both sides rather than
 * the web's `50%`: React Native resolves a percentage radius against the box
 * it is given, and a square box makes the two spellings agree.
 */
export const FLEET_DOT = {
  size: 10,
} as const;

/** What stands in for the roster before any unit has landed. */
export const FLEET_SKELETON = {
  /** Three bars, the height of a row with its padding. */
  rows: 3,
  height: 44,
  /** A MULTIPLE, for the same reason the row's is. */
  radiusMultiple: 1,
  gapUnits: 1,
} as const;

/**
 * How long a fix stays `live`, and then `lagging`, when the caller says nothing.
 *
 * Ninety seconds and five minutes: sized for a phone reporting every twenty
 * seconds, which is the densest cadence a battery tolerates all day. They are
 * DEFAULTS and not a rule — a fleet on five-minute trackers passes its own, and
 * the props exist so it can.
 */
export const FLEET_DEFAULT_LAGGING_AFTER_SECONDS = 90;
export const FLEET_DEFAULT_STALE_AFTER_SECONDS = 300;
