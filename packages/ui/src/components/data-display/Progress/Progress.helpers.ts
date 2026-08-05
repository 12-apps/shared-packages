import type { ProgressProps } from './Progress.types';

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

type ResolvedProgressProps = ProgressProps &
  Required<Pick<ProgressProps, ProgressDefaultedKeys>>;

const PROGRESS_DEFAULTS: Pick<ProgressProps, ProgressDefaultedKeys> = {
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
const definedProps = (props: ProgressProps): Partial<ProgressProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<ProgressProps>;

export const resolveProgressProps = (props: ProgressProps): ResolvedProgressProps =>
  ({ ...PROGRESS_DEFAULTS, ...definedProps(props) }) as ResolvedProgressProps;
