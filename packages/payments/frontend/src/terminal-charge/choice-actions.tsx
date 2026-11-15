'use client';

import { Box, Button, type ButtonProps, type SxProps, type Theme } from '@mui/material';
import { Children, useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react';

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
 *   space given (measured), never the viewport's. See {@link ChoiceRow}.
 */

export type ActionRank = 'primary' | 'secondary' | 'tertiary';

const VARIANT: Readonly<Record<ActionRank, ButtonProps['variant']>> = { primary: 'contained', secondary: 'outlined', tertiary: 'text' };

/** A touch-sized target (six spacing steps) with the label as the host wrote it. */
const ACTION_SX = { textTransform: 'none', minHeight: (theme: Theme) => theme.spacing(6) } as const;

/** The text rank starts from the left of its cell, as the buttons of a row do. */
const TERTIARY_SX = { ...ACTION_SX, justifyContent: 'flex-start' } as const;

/** The primary inverted: paper, with the primary as ink and border. */
const SECONDARY_SX = { ...ACTION_SX, bgcolor: 'background.paper', color: 'primary.main', borderColor: 'primary.main' } as const;

interface ActionButtonProps extends Omit<ButtonProps, 'variant' | 'color'> {
  readonly rank: ActionRank;
}

/** A button of the charge's, at its rank. */
export function ActionButton({ rank, sx, ...rest }: ActionButtonProps): JSX.Element {
  const own = { primary: ACTION_SX, secondary: SECONDARY_SX, tertiary: TERTIARY_SX }[rank];
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
 * - two: side by side, as equal columns, whenever both labels fit at their
 *   natural width in the space given; otherwise stacked whole, each across the
 *   row. Never one row wrapped into two ragged lines. The row stops at `md`.
 * - three or more: always stacked at equal width, across the space given —
 *   three host-worded labels side by side rarely fit;
 * - one: as wide as a column of two at most.
 *
 * Whether two fit is measured (see {@link useSideBySide}); a label longer than
 * the whole row still wraps inside its stacked button, the only place left.
 */
function choiceLayout(theme: Theme, count: number, sideBySide: boolean) {
  const { md } = theme.breakpoints.values;
  const one = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 1 } as const;
  if (count >= 3) return one;
  if (count === 1) return { ...one, maxWidth: md / 2 };
  return { ...one, maxWidth: md, ...(sideBySide ? { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } : {}) };
}

/** A button's natural width: its label on one line, plus its own padding and border. */
function naturalWidth(button: HTMLElement, measure: CanvasRenderingContext2D): number {
  const style = getComputedStyle(button);
  measure.font = style.font;
  const chrome = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const;
  const text = button.textContent ?? '';
  const tracking = (Number.parseFloat(style.letterSpacing) || 0) * text.length;
  return measure.measureText(text).width + tracking + chrome.reduce((sum, side) => sum + (Number.parseFloat(style[side]) || 0), 0);
}

/**
 * Whether the row's buttons fit side by side as equal columns: the widest
 * natural width times their number, plus the gaps, within the row's width.
 * Re-measured whenever the row's width changes. Where nothing can measure (no
 * layout, no canvas) they sit side by side, as before.
 */
function useSideBySide(row: RefObject<HTMLDivElement | null>, count: number): boolean {
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const element = row.current;
    const measure = typeof document === 'undefined' ? null : document.createElement('canvas').getContext?.('2d');
    if (element === null || count !== 2 || typeof ResizeObserver === 'undefined' || !measure) return undefined;
    const decide = (): void => {
      const buttons = [...element.children] as HTMLElement[];
      const gap = Number.parseFloat(getComputedStyle(element).columnGap) || 0;
      const widest = Math.max(...buttons.map((button) => naturalWidth(button, measure)));
      setFits(widest * buttons.length + gap * (buttons.length - 1) <= element.clientWidth);
    };
    const observer = new ResizeObserver(decide);
    observer.observe(element.parentElement ?? element);
    decide();
    return () => observer.disconnect();
  }, [row, count]);
  return fits;
}

export function ChoiceRow({ children, label, dataTestId }: ChoiceRowProps): JSX.Element | null {
  const count = Children.toArray(children).filter(Boolean).length;
  const row = useRef<HTMLDivElement | null>(null);
  const sideBySide = useSideBySide(row, count);
  if (count === 0) return null;
  return (
    <Box
      ref={row}
      role={label === undefined ? undefined : 'group'}
      aria-label={label}
      data-testid={dataTestId}
      data-choices={count}
      data-side-by-side={count === 2 ? String(sideBySide) : undefined}
      sx={(theme) => choiceLayout(theme, count, sideBySide)}
    >
      {children}
    </Box>
  );
}
