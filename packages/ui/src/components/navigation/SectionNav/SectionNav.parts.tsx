import Box from '@mui/material/Box/index.js';
import CircularProgress from '@mui/material/CircularProgress/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import { useEffect, useState, type ElementType, type ReactNode } from 'react';

import { rem } from '../../../tokens/scales';
import { SR_ONLY_SX } from '../../form/Label/Label.styles';
import { Badge } from '../../data-display/Badge';

import { shownCount } from './SectionNav.helpers';
import type { SectionNavBadge, SectionNavDestination } from './SectionNav.types';

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
  attentionLabel,
}: {
  icon: ReactNode;
  count: SectionNavBadge | undefined;
  label: (count: number) => string;
  testId: string;
  /** The "!" badge's accessible name (`SectionNavCopy.attention`). */
  attentionLabel?: string;
}): React.JSX.Element {
  if (count === '!') {
    return (
      <Badge content="!" variant="count" color="warning" aria-label={attentionLabel ?? label(1)} aria-live="off" data-testid={testId}>
        {icon}
      </Badge>
    );
  }
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
 * element — never a button wrapped around a link. Whatever it would lead to,
 * a control that is not live is a BUTTON: a link cannot be disabled, and one
 * that looks dimmed but still navigates is the lie this rules out.
 *
 * - `inert` — a native `disabled` button: no focus, no click.
 * - `busy` — a write is in flight: `aria-disabled`, still focusable, and the
 *   click is dropped, so the keyboard keeps its place until the write answers.
 * - `dimmed` — `aria-disabled`, still focusable, and the click STILL runs, so
 *   the host can explain why the act cannot be done now.
 */
export function controlProps({
  href,
  onClick,
  linkComponent,
  inert = false,
  busy = false,
  dimmed = false,
}: {
  href: string | undefined;
  onClick?: () => void;
  linkComponent: ElementType | undefined;
  inert?: boolean;
  busy?: boolean;
  dimmed?: boolean;
}): Record<string, unknown> {
  if (inert) return { component: 'button', type: 'button', disabled: true };
  if (busy) return { component: 'button', type: 'button', 'aria-disabled': 'true' };
  if (dimmed) return { component: 'button', type: 'button', 'aria-disabled': 'true', onClick };
  if (href !== undefined) return { component: linkComponent ?? 'a', href, onClick };
  return { component: 'button', type: 'button', onClick };
}

/**
 * A destination's control: `controlProps` from its own state, plus
 * `aria-pressed` when it is an action slot that is a toggle. A link reports
 * where the viewer is through `aria-current` instead — the row draws that.
 */
export function destinationControl(
  destination: SectionNavDestination,
  linkComponent: ElementType | undefined,
  onClick: () => void,
): Record<string, unknown> {
  return {
    ...controlProps({
      href: destination.href,
      linkComponent,
      inert: destination.disabled === true,
      busy: destination.loading === true,
      dimmed: destination.dimmed === true,
      onClick,
    }),
    'aria-pressed': destination.href === undefined ? destination.active : undefined,
  };
}

/**
 * The selector for a control drawn as not live: natively disabled, or
 * `aria-disabled` (in flight, or dimmed) and still focusable.
 */
export const NOT_LIVE = '&:disabled, &[aria-disabled="true"]';

/**
 * The icon, or the spinner that stands in for it while the slot's write is in
 * flight — the same box, so the label under it does not move.
 */
export function SlotIcon({ icon, loading }: { icon: ReactNode; loading: boolean }): React.JSX.Element {
  if (!loading) return <>{icon}</>;
  return <CircularProgress size="1em" color="inherit" thickness={5} data-testid="section-nav-spinner" />;
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
  [NOT_LIVE]: { cursor: 'default' },
} as const;

/**
 * Out of sight, still read: a compact nav keeps each label as its control's
 * accessible name. The same box `Label`'s `srOnly` draws.
 */
export const VISUALLY_HIDDEN = SR_ONLY_SX;

/**
 * False on the first render, true from then on — so a fold animates when the
 * host CHANGES `compact`, never when a page simply opens folded (which drew
 * the labels sliding out over the neighbouring badges on every load).
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

export { Box };
