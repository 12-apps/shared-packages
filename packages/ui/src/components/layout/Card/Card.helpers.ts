import type { CardProps } from './Card.types';

type CardDefaultedKeys =
  | 'variant'
  | 'interactive'
  | 'glow'
  | 'pulse'
  | 'borderRadius'
  | 'loading';

type ResolvedCardProps = CardProps & Required<Pick<CardProps, CardDefaultedKeys>>;

const CARD_DEFAULTS: Pick<CardProps, CardDefaultedKeys> = {
  variant: 'elevated',
  interactive: false,
  glow: false,
  pulse: false,
  borderRadius: 'md',
  loading: false,
};

// Strips explicitly-undefined props before the merge, so `glow={undefined}` still
// falls back to the default exactly as a destructuring default would.
const definedProps = (props: CardProps): Partial<CardProps> =>
  Object.fromEntries(
    Object.entries(props).filter(([, value]) => value !== undefined),
  ) as Partial<CardProps>;

export const resolveCardProps = (props: CardProps): ResolvedCardProps =>
  ({ ...CARD_DEFAULTS, ...definedProps(props) }) as ResolvedCardProps;
