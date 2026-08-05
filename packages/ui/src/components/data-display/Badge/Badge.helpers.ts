import type { ReactNode } from 'react';

import type { BadgeProps } from './Badge.types';

type BadgeDefaultedKeys =
  | 'variant'
  | 'size'
  | 'color'
  | 'glow'
  | 'pulse'
  | 'animate'
  | 'shimmer'
  | 'bounce'
  | 'max'
  | 'showZero'
  | 'position'
  | 'closable';

export type ResolvedBadgeProps = BadgeProps & Required<Pick<BadgeProps, BadgeDefaultedKeys>>;

const BADGE_DEFAULTS: Pick<BadgeProps, BadgeDefaultedKeys> = {
  variant: 'default',
  size: 'md',
  color: 'primary',
  glow: false,
  pulse: false,
  animate: true,
  shimmer: false,
  bounce: false,
  max: 99,
  showZero: false,
  position: 'top-right',
  closable: false,
};

// Strips explicitly-undefined props before the merge, so `prop={undefined}` still
// falls back to the default exactly as a destructuring default would. Applied as
// a merge rather than destructuring defaults, which would otherwise put twelve
// branches into the component's own complexity budget.
export const resolveBadgeProps = (props: BadgeProps): ResolvedBadgeProps =>
  ({
    ...BADGE_DEFAULTS,
    ...(Object.fromEntries(
      Object.entries(props).filter(([, value]) => value !== undefined),
    ) as Partial<BadgeProps>),
  }) as ResolvedBadgeProps;

// `content` supersedes the older `badgeContent` prop.
export const badgeContentOf = (props: Pick<BadgeProps, 'content' | 'badgeContent'>): ReactNode => {
  if (props.content !== undefined) return props.content;
  if (props.badgeContent !== undefined) return props.badgeContent;
  return null;
};

// Counts cap at `max` and, unless showZero is set, a zero renders nothing.
export const formatCount = (
  count: ReactNode,
  { max, showZero }: { max: number; showZero: boolean },
): ReactNode => {
  if (typeof count !== 'number') return count;
  if (count === 0 && !showZero) return null;
  if (count > max) return `${max}+`;
  return count;
};

// MUI spreads these straight onto the badge span, where an explicit undefined
// would render as an empty attribute.
export const definedAria = (
  aria: Record<string, string | boolean | undefined>,
): Record<string, string | boolean> =>
  Object.fromEntries(Object.entries(aria).filter(([, value]) => value !== undefined)) as Record<
    string,
    string | boolean
  >;
