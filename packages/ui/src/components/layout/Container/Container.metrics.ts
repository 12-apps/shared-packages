import type { ContainerMaxWidth, ContainerPadding, ContainerVariant } from './Container.base';

/**
 * THE NUMBERS BOTH `Container` RENDERERS DRAW WITH.
 *
 * `Container.tsx` used to hold these as `theme.spacing(…)` calls and MUI's
 * breakpoint names inside the component; the native renderer has no MUI
 * breakpoints to name, so the values live here in SPACING UNITS and px, and
 * each renderer multiplies the units out through its own `theme.spacing`.
 */
export type ContainerMaxWidthKey = Exclude<ContainerMaxWidth, false>;

/**
 * MUI's default breakpoints, which its `Container` reads as `max-width`
 * (`xs` is `Math.max(values.xs, 444)`). MUI applies each under
 * `min-width: <breakpoint>`, but below it the column is `width: 100%` and
 * narrower anyway, so a plain `maxWidth` paints the same.
 */
export const CONTAINER_MAX_WIDTHS: Record<ContainerMaxWidthKey, number> = {
  xs: 444,
  sm: 600,
  md: 900,
  lg: 1200,
  xl: 1536,
};

export const CONTAINER_DEFAULT_MAX_WIDTH: ContainerMaxWidthKey = 'lg';
/** The `centered` variant reads at `md`, whatever `maxWidth` says. */
export const CONTAINER_CENTERED_MAX_WIDTH: ContainerMaxWidthKey = 'md';

export const CONTAINER_PADDING_UNITS: Record<ContainerPadding, number> = {
  none: 0,
  xs: 1,
  sm: 2,
  md: 3,
  lg: 4,
  xl: 6,
};

export const CONTAINER_DEFAULT_PADDING: ContainerPadding = 'md';

/** What `variant="padded"` declares above and below, in spacing units. */
export const CONTAINER_PADDED_VERTICAL_UNITS = 8;

/** Under {@link CONTAINER_COMPACT_BELOW}, a `responsive` container tightens to this. */
export const CONTAINER_COMPACT_PADDING_UNITS = 2;

/** MUI's `sm` breakpoint: `theme.breakpoints.down('sm')` is `max-width: 599.95px`. */
export const CONTAINER_COMPACT_BELOW = 600;

const isMaxWidthKey = (value: string): value is ContainerMaxWidthKey => value in CONTAINER_MAX_WIDTHS;

/**
 * The breakpoint the column is limited to, or `false` for none. `fluid` drops
 * the limit, `centered` fixes it at `md`, and a string outside the vocabulary
 * reads as the default — the rules `Container.tsx` has always applied.
 */
export function resolveContainerMaxWidth(
  variant: ContainerVariant,
  maxWidth: ContainerMaxWidth | string,
): ContainerMaxWidthKey | false {
  if (variant === 'fluid') return false;
  if (variant === 'centered') return CONTAINER_CENTERED_MAX_WIDTH;
  if (typeof maxWidth === 'string' && isMaxWidthKey(maxWidth)) return maxWidth;
  return maxWidth === false ? false : CONTAINER_DEFAULT_MAX_WIDTH;
}

/**
 * The inset every side of the container is painted with, in spacing units.
 *
 * `??`, not `||`: `none` is 0, and 0 is falsy. Reading the map with `||` sent
 * `padding="none"` through to the `md` default, so the one value a caller
 * would reach for to remove the inset was the one value that could not.
 * A word outside the vocabulary still reads as the default.
 */
export function containerPaddingUnits(padding: ContainerPadding | string, compact: boolean): number {
  if (compact) return CONTAINER_COMPACT_PADDING_UNITS;
  const units = (CONTAINER_PADDING_UNITS as Record<string, number | undefined>)[padding];
  return units ?? CONTAINER_PADDING_UNITS[CONTAINER_DEFAULT_PADDING];
}

/**
 * What `variant="padded"` paints above and below, in spacing units — the
 * horizontal inset stays whatever `padding` says.
 *
 * The variant used to paint nothing of its own: the web declared these before
 * the `padding` shorthand, which overrode them, and the native half copied the
 * painted result so the two would agree. Now both read this.
 *
 * A `responsive` container under {@link CONTAINER_COMPACT_BELOW} compacts, as
 * every other inset does; a tall vertical inset is the first thing a phone
 * cannot spare.
 */
export function containerVerticalUnits(
  variant: ContainerVariant,
  padding: ContainerPadding | string,
  compact: boolean,
): number {
  if (variant !== 'padded') return containerPaddingUnits(padding, compact);
  return compact ? CONTAINER_COMPACT_PADDING_UNITS : CONTAINER_PADDED_VERTICAL_UNITS;
}
