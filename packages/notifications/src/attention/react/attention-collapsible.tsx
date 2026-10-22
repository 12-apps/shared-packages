/**
 * The button, folded: a half disc on the screen's edge — halfway down the
 * right edge until the reader drags it somewhere else.
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
 * last item leaves, and wherever the reader dragged the OPEN button, it folds
 * back to the tab's own spot.
 *
 * The tab moves only when the tab itself is dragged: it snaps to the nearer
 * side, flush with it, at the height it was let go, and the device remembers
 * the spot (`./preferences.ts`). The button then opens there.
 *
 * Sound, vibration and push do not care whether it is folded: the host keeps
 * listening either way (`./alerts`).
 */
import { useEffect, useRef, useState, type JSX, type MouseEvent, type ReactNode } from 'react';

import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';

import type { AttentionSeverity } from '../core';

export { AttentionTab, type AttentionTabProps } from './attention-tab';

/** The words of the folded mode — the host's, like every other sentence. */
export interface AttentionCollapsedMessages {
  /** The tab read aloud: "3 waiting, the worst late — open", or that nothing waits. */
  readonly tab: (count: number, worst: AttentionSeverity | null) => string;
  /** The round "−" read aloud: "Fold the button". */
  readonly collapse: string;
  /** What an open button with nothing waiting says: "Nothing to see". */
  readonly empty: string;
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

interface AttentionCollapseSpotProps {
  readonly label: string;
  /** Under the button (it rests in the screen's top half) or over it. */
  readonly below: boolean;
  /** Left out while something else hangs off the same side. */
  readonly hidden: boolean;
  readonly onCollapse: () => void;
  /** The button the "−" is set against. */
  readonly children: ReactNode;
}

/**
 * The open button with its "−" over or under it — never beside it — centred on
 * the button and away from the nearer edge of the screen, so it stays on it.
 */
export function AttentionCollapseSpot({ label, below, hidden, onCollapse, children }: AttentionCollapseSpotProps): JSX.Element {
  return (
    <Box sx={{ position: 'relative', display: 'flex' }}>
      {children}
      {!hidden && (
        <Box
          data-testid="attention-collapse-spot"
          data-place={below ? 'below' : 'above'}
          sx={{
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
            [below ? 'top' : 'bottom']: 'calc(100% + 6px)',
          }}
        >
          <AttentionCollapseButton label={label} onCollapse={onCollapse} />
        </Box>
      )}
    </Box>
  );
}

/** The open button with nothing waiting: the "−" beside "nothing to see". */
export function AttentionFoldedEmpty({
  words,
  onCollapse,
}: {
  readonly words: AttentionCollapsedMessages;
  readonly onCollapse: () => void;
}): JSX.Element {
  return (
    <>
      <AttentionCollapseButton label={words.collapse} onCollapse={onCollapse} />
      <AttentionEmptyNote text={words.empty} />
    </>
  );
}
