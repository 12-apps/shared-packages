import type { CardBaseProps } from './Card.base';

type CardDefaultedKeys =
  | 'variant'
  | 'interactive'
  | 'glow'
  | 'pulse'
  | 'borderRadius'
  | 'loading';

/**
 * Generic over the renderer's own props: the web and the native `Card` pass
 * different handler types (and different style props) through, and both come
 * back out untouched.
 */
type ResolvedCardProps<P extends CardBaseProps> = P &
  Required<Pick<CardBaseProps, CardDefaultedKeys>>;

const CARD_DEFAULTS: Required<Pick<CardBaseProps, CardDefaultedKeys>> = {
  variant: 'elevated',
  interactive: false,
  glow: false,
  pulse: false,
  borderRadius: 'md',
  loading: false,
};

// Strips explicitly-undefined props before the merge, so `glow={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = <P extends CardBaseProps>(props: P): Partial<P> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<P>;

export const resolveCardProps = <P extends CardBaseProps>(props: P): ResolvedCardProps<P> =>
  ({ ...CARD_DEFAULTS, ...definedProps(props) }) as ResolvedCardProps<P>;
