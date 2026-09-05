import type { ProgressBaseProps } from './Progress.base';

type ProgressDefaultedKeys =
  | 'variant'
  | 'size'
  | 'color'
  | 'glow'
  | 'pulse'
  | 'showLabel'
  | 'segments'
  | 'thickness'
  | 'dataTestId';

/**
 * Generic over the renderer's own props: the web and the native `Progress`
 * carry different extras (MUI's `LinearProgress` props against a `View`'s), and
 * both come back out untouched.
 */
type ResolvedProgressProps<P extends ProgressBaseProps> = P &
  Required<Pick<ProgressBaseProps, ProgressDefaultedKeys>>;

const PROGRESS_DEFAULTS: Required<Pick<ProgressBaseProps, ProgressDefaultedKeys>> = {
  variant: 'linear',
  size: 'md',
  color: 'primary',
  glow: false,
  pulse: false,
  showLabel: false,
  segments: 10,
  thickness: 4,
  dataTestId: 'progress',
};

// Strips explicitly-undefined props before the merge, so `size={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = <P extends ProgressBaseProps>(props: P): Partial<P> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<P>;

export const resolveProgressProps = <P extends ProgressBaseProps>(
  props: P,
): ResolvedProgressProps<P> =>
  ({ ...PROGRESS_DEFAULTS, ...definedProps(props) }) as ResolvedProgressProps<P>;

/**
 * The label the caller asked for, or the rounded percentage when they only
 * asked for one. Empty when there is nothing to show.
 */
export const progressLabelText = (
  label: string | undefined,
  showLabel: boolean,
  displayValue: number,
): string => label || (showLabel ? `${Math.round(displayValue)}%` : '');

/** How much of the track the bar covers, 0 to 100 — a value outside that is clamped. */
export const progressFraction = (value: number): number =>
  Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
