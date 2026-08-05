import type { ButtonProps } from './Button.types';

type ButtonDefaultedKeys =
  | 'variant'
  | 'color'
  | 'size'
  | 'loading'
  | 'iconPosition'
  | 'glow'
  | 'pulse'
  | 'ripple'
  | 'active';

type ResolvedButtonProps = ButtonProps & Required<Pick<ButtonProps, ButtonDefaultedKeys>>;

const BUTTON_DEFAULTS: Pick<ButtonProps, ButtonDefaultedKeys> = {
  variant: 'solid',
  color: 'primary',
  size: 'md',
  loading: false,
  iconPosition: 'left',
  glow: false,
  pulse: false,
  ripple: true,
  active: false,
};

// Strips explicitly-undefined props before the merge, so `size={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: ButtonProps): Partial<ButtonProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<ButtonProps>;

export const resolveButtonProps = (props: ButtonProps): ResolvedButtonProps =>
  ({ ...BUTTON_DEFAULTS, ...definedProps(props) }) as ResolvedButtonProps;
