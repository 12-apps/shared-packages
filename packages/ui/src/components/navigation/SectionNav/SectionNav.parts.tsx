import Box from '@mui/material/Box/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import type { ElementType, ReactNode } from 'react';

import { rem } from '../../../tokens/scales';
import { Badge } from '../../data-display/Badge';

import { shownCount } from './SectionNav.helpers';

/**
 * An icon with its count on the shoulder.
 *
 * Quiet to assistive tech on change: the count moves on a poll, and a control
 * that announces itself every minute is noise. Its NAME carries the number,
 * so it is read when the control is.
 */
export function CountedIcon({
  icon,
  count,
  label,
  testId,
}: {
  icon: ReactNode;
  count: number | undefined;
  label: (count: number) => string;
  testId: string;
}): React.JSX.Element {
  const shown = shownCount(count);
  if (shown === undefined) return <>{icon}</>;
  return (
    // The library's corner count, in the warning role the sidebar's pill is
    // drawn from.
    <Badge
      content={shown}
      variant="count"
      color="warning"
      max={99}
      aria-label={label(shown)}
      aria-live="off"
      data-testid={testId}
    >
      {icon}
    </Badge>
  );
}

/** The keyboard ring every control in the nav draws, in the theme's own colour. */
export function focusRing(theme: Theme): SxProps<Theme> {
  return {
    '&:focus-visible': {
      outline: `${rem(theme, 2)} solid ${theme.palette.primary.main}`,
      outlineOffset: rem(theme, -2),
    },
  };
}

/**
 * The element an entry or destination renders as: the host's link for an
 * `href`, a button for an `onSelect`.
 *
 * Returned as props for a `Box`, so the control stays ONE interactive
 * element — never a button wrapped around a link.
 */
export function controlProps({
  href,
  onClick,
  linkComponent,
}: {
  href: string | undefined;
  onClick: () => void;
  linkComponent: ElementType | undefined;
}): Record<string, unknown> {
  if (href !== undefined) return { component: linkComponent ?? 'a', href, onClick };
  return { component: 'button', type: 'button', onClick };
}

/** The base reset every clickable in the nav shares: no underline, no button chrome. */
export const CONTROL_RESET = {
  border: 0,
  background: 'none',
  font: 'inherit',
  color: 'inherit',
  textDecoration: 'none',
  cursor: 'pointer',
  margin: 0,
} as const;

export { Box };
