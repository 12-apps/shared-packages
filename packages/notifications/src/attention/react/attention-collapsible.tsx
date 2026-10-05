/**
 * The button, folded: a half disc on the screen's right edge, halfway down.
 *
 *                      ◖3  ← the tab: the count, in the colour of the worst
 *                            of them; a quiet bare half disc when nothing waits
 *
 * It pulses as the open button would — the same halos, at the same pace, for
 * the thing it would show first — and stays still when that one is still.
 *
 * A host opts in by giving `AttentionHost` the words below (`collapsed`). Then
 * the tab is ALWAYS there, even with nothing waiting, and a tap opens the
 * ordinary button — dock, "+N", drag and all — with a small round "−" over or
 * under it (away from the nearer edge of the screen) that folds it back. With
 * nothing waiting, the tap says so instead. It folds back by itself once the
 * last item leaves, and wherever the reader dragged it, it folds back to the
 * same spot: the tab does not move.
 *
 * Sound, vibration and push do not care whether it is folded: the host keeps
 * listening either way (`./alerts`).
 */
import { useEffect, useRef, useState, type JSX, type MouseEvent } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';

import type { AttentionPulse, AttentionSeverity } from '../core';

import { HALO_SX, halos, severityFill, severityInk } from './attention-button';

/** The words of the folded mode — the host's, like every other sentence. */
export interface AttentionCollapsedMessages {
  /** The tab read aloud: "3 waiting, the worst late — open", or that nothing waits. */
  readonly tab: (count: number, worst: AttentionSeverity | null) => string;
  /** The round "−" read aloud: "Fold the button". */
  readonly collapse: string;
  /** What an open button with nothing waiting says: "Nothing to see". */
  readonly empty: string;
}

/**
 * How far the half disc reaches into the page: half its height. Wide enough to
 * be seen at a glance and to hold two digits — a thinner tab was missed.
 */
export const TAB_WIDTH_PX = 28;
const TAB_HEIGHT_PX = TAB_WIDTH_PX * 2;

/** The most the tab prints: two digits; past it, "99+" (the label says the number). */
const TAB_MAX = 99;

/** What the tab prints: nothing with nothing waiting, the count, or "9+" past it. */
function tabCount(count: number): string {
  if (count === 0) return '';
  return count > TAB_MAX ? `${TAB_MAX}+` : String(count);
}

/** How long "nothing to see" stays before the button folds itself back. */
export const EMPTY_NOTE_MS = 4000;

/** Where focus goes once a reader's own tap has folded or opened it. */
const FOCUS_OPEN = '[data-testid="attention-dock"] [data-testid="attention-button"]';
const FOCUS_OPEN_EMPTY = '[data-testid="attention-dock"] [data-testid="attention-collapse"]';
const FOCUS_FOLDED = '[data-testid="attention-tab"]';

/**
 * Folded or open, and when it folds by itself: when what waited is all gone,
 * and a few seconds after "nothing to see".
 *
 * Focus follows only the reader's own taps: opening lands on the button (on the
 * "−" when nothing waits), folding with the "−" lands back on the tab. A fold
 * of its own leaves focus where it is — the reader did not ask for it.
 */
export function useCollapse(count: number): {
  readonly open: boolean;
  readonly expand: () => void;
  readonly collapse: () => void;
} {
  const [open, setOpen] = useState(false);
  const before = useRef(count);
  const focusAfter = useRef<'open' | 'folded' | null>(null);
  useEffect(() => {
    const had = before.current;
    before.current = count;
    // The last one left while it was open: there is nothing left to show.
    if (open && had > 0 && count === 0) setOpen(false);
  }, [count, open]);
  useEffect(() => {
    if (!open || count > 0) return undefined;
    const fold = setTimeout(() => setOpen(false), EMPTY_NOTE_MS);
    return () => clearTimeout(fold);
  }, [open, count]);
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === null) return;
    const selector = target === 'folded' ? FOCUS_FOLDED : `${FOCUS_OPEN}, ${FOCUS_OPEN_EMPTY}`;
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(selector));
    // The button when there is one, the "−" otherwise.
    (candidates.find((element) => element.dataset.testid === 'attention-button') ?? candidates[0])?.focus();
  }, [open]);
  return {
    open,
    expand: () => {
      focusAfter.current = 'open';
      setOpen(true);
    },
    collapse: () => {
      focusAfter.current = 'folded';
      setOpen(false);
    },
  };
}

/**
 * The ink of the white "−" and note. They are white in every theme, like the
 * "+N" ball (`./attention-button`), so their ink cannot take the dark theme's
 * light `text.primary` — it would be white on white.
 */
function inkOnPaper(theme: Theme, opacity: number): string {
  return alpha(theme.palette.common.black, opacity);
}

/** The tab's fill: the worst severity's, or the quiet surface when nothing waits. */
function tabFill(theme: Theme, worst: AttentionSeverity | null): string {
  return worst === null ? theme.palette.action.selected : severityFill(theme, worst);
}

function tabInk(theme: Theme, worst: AttentionSeverity | null): string {
  return worst === null ? theme.palette.text.secondary : severityInk(theme, worst);
}

export interface AttentionTabProps {
  readonly count: number;
  readonly worst: AttentionSeverity | null;
  /** How the thing the open button would show pulses; `still` when nothing waits. */
  readonly pulse: AttentionPulse;
  readonly label: string;
  readonly zIndex: number;
  readonly onExpand: () => void;
}

const HALF_DISC = `${TAB_WIDTH_PX}px 0 0 ${TAB_WIDTH_PX}px`;

/** The folded button: flush with the right edge, halfway down, at every width. */
export function AttentionTab({ count, worst, pulse, label, zIndex, onExpand }: AttentionTabProps): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      aria-expanded={false}
      data-testid="attention-tab"
      data-severity={worst ?? 'none'}
      data-count={count}
      data-pulse={pulse}
      onClick={onExpand}
      sx={{
        position: 'fixed',
        right: 0,
        top: '50%',
        transform: 'translateY(-50%)',
        zIndex,
        width: TAB_WIDTH_PX,
        height: TAB_HEIGHT_PX,
        p: 0,
        pl: '3px',
        borderRadius: HALF_DISC,
        bgcolor: (theme: Theme) => tabFill(theme, worst),
        // A bare tab is the quiet surface on the page's own paper: its edge is
        // what finds it, so it keeps one even with nothing waiting.
        border: (theme: Theme) => (worst === null ? `1px solid ${theme.palette.text.secondary}` : 0),
        borderRight: 0,
        color: (theme: Theme) => tabInk(theme, worst),
        boxShadow: (theme: Theme) => `-2px 0 6px ${alpha(theme.palette.text.primary, 0.22)}`,
        font: 'inherit',
        fontSize: count > TAB_MAX ? 10 : 13,
        fontWeight: 700,
        lineHeight: 1,
        letterSpacing: '-0.04em',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        '&:focus-visible': {
          outline: 2,
          outlineStyle: 'solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      {worst !== null &&
        halos(pulse).map((halo, index) => (
          <Box
            key={index}
            component="span"
            aria-hidden
            sx={{
              ...HALO_SX,
              borderRadius: HALF_DISC,
              // Grows from the edge into the page, the way the disc's halo grows from its centre.
              transformOrigin: 'right center',
              bgcolor: (theme: Theme) => severityFill(theme, worst),
              animation: halo.animation,
            }}
          />
        ))}
      <Box component="span" sx={{ position: 'relative' }}>
        {tabCount(count)}
      </Box>
    </Box>
  );
}

export interface AttentionCollapseButtonProps {
  readonly label: string;
  readonly onCollapse: () => void;
}

/** The small round "−" beside the open button that folds it back into the tab. */
export function AttentionCollapseButton({ label, onCollapse }: AttentionCollapseButtonProps): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      data-testid="attention-collapse"
      // A tap, never the start of a drag of the dock it sits in.
      onPointerDown={(event: MouseEvent<HTMLElement>) => event.stopPropagation()}
      onClick={onCollapse}
      sx={{
        width: 26,
        height: 26,
        flexShrink: 0,
        p: 0,
        display: 'grid',
        placeItems: 'center',
        borderRadius: '50%',
        bgcolor: 'common.white',
        color: (theme: Theme) => inkOnPaper(theme, 0.87),
        border: (theme: Theme) => `1.5px solid ${inkOnPaper(theme, 0.3)}`,
        boxShadow: (theme: Theme) => `0 2px 6px ${inkOnPaper(theme, 0.18)}`,
        cursor: 'pointer',
        '&:focus-visible': {
          outline: 2,
          outlineStyle: 'solid',
          outlineColor: 'primary.main',
          outlineOffset: 2,
        },
      }}
    >
      <Box component="svg" viewBox="0 0 16 16" aria-hidden="true" sx={{ width: 12, height: 12 }}>
        <line x1="3" y1="8" x2="13" y2="8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </Box>
    </Box>
  );
}

/** What the open button says with nothing waiting. */
export function AttentionEmptyNote({ text }: { readonly text: string }): JSX.Element {
  return (
    <Box
      role="status"
      data-testid="attention-empty"
      sx={{
        px: 2,
        py: 1.25,
        borderRadius: 3,
        bgcolor: 'common.white',
        color: (theme: Theme) => inkOnPaper(theme, 0.87),
        border: (theme: Theme) => `1px solid ${inkOnPaper(theme, 0.12)}`,
        boxShadow: (theme: Theme) => `0 2px 6px ${inkOnPaper(theme, 0.18)}`,
        fontSize: 14,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </Box>
  );
}
