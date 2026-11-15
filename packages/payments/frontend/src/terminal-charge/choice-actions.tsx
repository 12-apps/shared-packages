'use client';

import { Box, Button, type ButtonProps, type SxProps, type Theme } from '@mui/material';
import { Children, type JSX, type ReactNode } from 'react';

/**
 * How the terminal charge's buttons look and sit, in one place, from the
 * host's theme only (its palette, spacing and breakpoints): the host's brand
 * wins, and nothing here types a colour or a size of its own.
 *
 * - **Rank** (draft ADR 0184 of the origin host): the primary is solid; the
 *   secondary is the primary inverted — the paper colour, with the primary as
 *   ink and border; the tertiary is the primary's ink alone. Labels keep the
 *   host's case (sentence case), never the theme's UPPERCASE.
 * - **One question, one line** (draft ADR 0190): the options of one question
 *   are equal columns of ONE row when the space given holds them, and
 *   otherwise each spans the row, stacked in order, the first on top. Never a
 *   wrap into a ragged second line, never a sideways scroll. The space is the
 *   container's (a container query), never the viewport's. See {@link ChoiceRow}.
 */

export type ActionRank = 'primary' | 'secondary' | 'tertiary';

const VARIANT: Readonly<Record<ActionRank, ButtonProps['variant']>> = { primary: 'contained', secondary: 'outlined', tertiary: 'text' };

/** A touch-sized target (six spacing steps) with the label as the host wrote it. */
const ACTION_SX = { textTransform: 'none', minHeight: (theme: Theme) => theme.spacing(6) } as const;

/** The primary inverted: paper, with the primary as ink and border. */
const SECONDARY_SX = { ...ACTION_SX, bgcolor: 'background.paper', color: 'primary.main', borderColor: 'primary.main' } as const;

interface ActionButtonProps extends Omit<ButtonProps, 'variant' | 'color'> {
  readonly rank: ActionRank;
}

/** A button of the charge's, at its rank. */
export function ActionButton({ rank, sx, ...rest }: ActionButtonProps): JSX.Element {
  const own = rank === 'secondary' ? SECONDARY_SX : ACTION_SX;
  return <Button variant={VARIANT[rank]} color="primary" sx={[own, ...(Array.isArray(sx) ? sx : [sx])] as SxProps<Theme>} {...rest} />;
}

interface ChoiceRowProps {
  readonly children: ReactNode;
  /** Names the group for assistive technology (the question), when the row is one. */
  readonly label?: string;
  readonly dataTestId?: string;
}

/**
 * The options of one question, from the left:
 *
 * - two: equal columns of one row from the theme's `sm` width of the
 *   CONTAINER on, each spanning the row below it, the row stopping at `md`;
 * - three or more: always stacked, equal width, at most `sm` wide — three
 *   host-worded labels side by side would break inside their buttons on most
 *   widths, and a label is never broken inside one;
 * - one: as wide as a column of two at most.
 */
function choiceLayout(theme: Theme, count: number) {
  const { sm, md } = theme.breakpoints.values;
  const one = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1 } as const;
  if (count >= 3) return { ...one, maxWidth: sm };
  if (count === 1) return { ...one, maxWidth: md / 2 };
  return { ...one, maxWidth: md, [`@container terminal-choices (min-width: ${sm}px)`]: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } };
}

export function ChoiceRow({ children, label, dataTestId }: ChoiceRowProps): JSX.Element | null {
  const count = Children.toArray(children).filter(Boolean).length;
  if (count === 0) return null;
  return (
    <Box sx={{ containerType: 'inline-size', containerName: 'terminal-choices' }}>
      <Box
        role={label === undefined ? undefined : 'group'}
        aria-label={label}
        data-testid={dataTestId}
        data-choices={count}
        sx={(theme) => choiceLayout(theme, count)}
      >
        {children}
      </Box>
    </Box>
  );
}
