/**
 * What "+N" opens: everything after the head, in the queue's order, each row
 * opening its own item. Late rows wear a square and calm ones a dot, so the
 * shape says it as well as the hue.
 */
import type { JSX } from 'react';

import { Popover } from '@12-apps/ui/data-display/Popover';
import { Box } from '@12-apps/ui/mui/Box';
import type { Theme } from '@12-apps/ui/mui/styles';
import { softSignal } from '@12-apps/ui/tokens';

import type { AttentionEntry } from '../core';

import { severityFill } from './attention-button';
import { FLOATING_MARGIN_PX, FLOATING_PAPER } from './floating';
import type { AttentionMessages } from './messages';
import { minutesOf, type AttentionKindView, type AttentionViews } from './views';

const ROW_SX = {
  display: 'flex',
  width: '100%',
  alignItems: 'center',
  gap: 1.25,
  minHeight: 48,
  px: 1,
  py: 0.75,
  border: 0,
  borderRadius: 1,
  color: 'text.primary',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  '&:focus-visible': {
    outline: 2,
    outlineStyle: 'solid',
    outlineColor: 'primary.main',
  },
} as const;

/** The air between the list and the dock it hangs off. */
const LIST_GAP_PX = 10;

export interface AttentionOthersListProps {
  /** The DOCK — the button and its "+N" — so the list clears the button too. */
  readonly anchor: HTMLElement | null;
  /** The side the dock rests on: the list lines up with its outer edge. */
  readonly side: 'left' | 'right';
  readonly entries: readonly AttentionEntry[];
  readonly views: AttentionViews;
  readonly messages: AttentionMessages;
  readonly onClose: () => void;
  readonly onPick: (entry: AttentionEntry) => void;
}

/** One waiting thing in the list: its marker, its name, and how long. */
function OtherRow({
  entry,
  view,
  messages,
  onPick,
}: {
  readonly entry: AttentionEntry;
  readonly view: AttentionKindView;
  readonly messages: AttentionMessages;
  readonly onPick: (entry: AttentionEntry) => void;
}): JSX.Element {
  const { title, what, spoken } = view.describe(entry.item);
  const waited = messages.waited(minutesOf(entry.waitedMs), entry.waitedMs);
  const calm = entry.severity === 'calm';
  return (
    <Box component="li">
      <Box
        component="button"
        type="button"
        aria-label={`${spoken ?? title}, ${what}, ${waited}, ${messages.severity[entry.severity]}`}
        data-testid={`attention-others-${entry.item.id}`}
        data-severity={entry.severity}
        onClick={() => onPick(entry)}
        sx={{
          ...ROW_SX,
          // The row's own wash: the soft amber for anything late, the soft green while calm.
          bgcolor: (theme: Theme) => softSignal(theme, calm ? 'success' : 'warning'),
        }}
      >
        <Box
          component="span"
          aria-hidden
          sx={{
            width: 12,
            height: 12,
            flexShrink: 0,
            // A shape as well as a colour: the late are squares, the calm round.
            borderRadius: calm ? '50%' : '2px',
            // Amber for every late row, the spent ones included: the shape and
            // the time carry the rest.
            bgcolor: (theme: Theme) => (calm ? theme.palette.success.main : theme.palette.warning.main),
          }}
        />
        <Box component="span" aria-hidden sx={{ flex: 1, minWidth: 0, fontSize: 14 }}>
          <strong>{title}</strong> · {what}
        </Box>
        <Box
          component="span"
          aria-hidden
          sx={{
            whiteSpace: 'nowrap',
            fontSize: 13,
            color: (theme: Theme) => (calm ? theme.palette.success.dark : severityFill(theme, 'spent')),
          }}
        >
          {waited}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Above the dock, 10px clear of the button, unless the reader dragged it into
 * the top half of the screen — then under it; lined up with its outer edge;
 * and no taller than the room on that side, so a long list scrolls there
 * rather than slide over the dock it hangs off.
 */
function placeList(
  anchor: HTMLElement | null,
  side: 'left' | 'right',
): { readonly at: { top: number; left: number }; readonly below: boolean; readonly room: number } | null {
  if (anchor === null) return null;
  const rect = anchor.getBoundingClientRect();
  const below = rect.top < window.innerHeight / 2;
  const room = (below ? window.innerHeight - rect.bottom : rect.top) - LIST_GAP_PX - FLOATING_MARGIN_PX;
  const top = below ? rect.bottom + LIST_GAP_PX : rect.top - LIST_GAP_PX;
  return { at: { top, left: rect[side] }, below, room };
}

export function AttentionOthersList({
  anchor,
  side,
  entries,
  views,
  messages,
  onClose,
  onPick,
}: AttentionOthersListProps): JSX.Element {
  const place = placeList(anchor, side);
  return (
    <Popover
      open={place !== null && entries.length > 0}
      anchorReference="anchorPosition"
      anchorPosition={place?.at}
      onClose={onClose}
      transformOrigin={{ vertical: place?.below === true ? 'top' : 'bottom', horizontal: side }}
      marginThreshold={FLOATING_MARGIN_PX}
      PaperProps={FLOATING_PAPER}
      dataTestId="attention-others-list"
    >
      <Box
        sx={{
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          // Never wider than the screen less the popover's 16px margins: at
          // 320px a fixed width ran 9px off the left edge.
          width: 'min(270px, calc(100vw - 24px))',
          boxSizing: 'border-box',
          ...(place === null ? {} : { maxHeight: place.room, overflowY: 'auto' }),
        }}
      >
        <Box component="strong" sx={{ fontSize: 14, p: '4px 6px 6px' }}>
          {messages.othersTitle}
        </Box>
        <Box
          component="ul"
          aria-label={messages.othersTitle}
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
        >
          {entries.map((entry) => {
            const view = views[entry.kind.id];
            if (view === undefined) return null;
            return (
              <OtherRow key={entry.item.id} entry={entry} view={view} messages={messages} onPick={onPick} />
            );
          })}
        </Box>
      </Box>
    </Popover>
  );
}
