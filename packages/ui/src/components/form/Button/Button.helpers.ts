import type { ButtonBaseProps } from './Button.base';

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

/**
 * Generic over the renderer's own props: the web and the native `Button` pass
 * different handler types through, and both come back out untouched.
 */
type ResolvedButtonProps<P extends ButtonBaseProps> = P &
  Required<Pick<ButtonBaseProps, ButtonDefaultedKeys>>;

const BUTTON_DEFAULTS: Required<Pick<ButtonBaseProps, ButtonDefaultedKeys>> = {
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
const definedProps = <P extends ButtonBaseProps>(props: P): Partial<P> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<P>;

export const resolveButtonProps = <P extends ButtonBaseProps>(props: P): ResolvedButtonProps<P> =>
  ({ ...BUTTON_DEFAULTS, ...definedProps(props) }) as ResolvedButtonProps<P>;
