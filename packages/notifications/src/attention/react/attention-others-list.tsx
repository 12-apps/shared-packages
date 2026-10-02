/**
 * What "+N" opens: everything after the head, in the queue's order, each row
 * opening its own item. Late rows wear a square and calm ones a dot, so the
 * shape says it as well as the hue.
 */
import type { JSX } from 'react';

import { Popover } from '@12-apps/ui/data-display/Popover';
import { Box } from '@12-apps/ui/mui/Box';
import { alpha, type Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import type { AttentionEntry } from '../core';

import { severityFill } from './attention-button';
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
          // The row's own wash: amber for anything late, green while calm.
          bgcolor: (theme: Theme) =>
            alpha(calm ? theme.palette.success.main : theme.palette.warning.main, 0.08),
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
            bgcolor: (theme: Theme) => severityFill(theme, entry.severity),
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

export function AttentionOthersList({
  anchor,
  side,
  entries,
  views,
  messages,
  onClose,
  onPick,
}: AttentionOthersListProps): JSX.Element {
  // Above the dock, 10px clear of the button, unless the reader dragged it into
  // the top half of the screen — then under it; lined up with its outer edge.
  const rect = anchor?.getBoundingClientRect() ?? null;
  const below = rect !== null && rect.top < window.innerHeight / 2;
  return (
    <Popover
      open={rect !== null && entries.length > 0}
      anchorReference="anchorPosition"
      anchorPosition={
        rect === null
          ? undefined
          : { top: below ? rect.bottom + LIST_GAP_PX : rect.top - LIST_GAP_PX, left: rect[side] }
      }
      onClose={onClose}
      transformOrigin={{ vertical: below ? 'top' : 'bottom', horizontal: side }}
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
          width: 'min(270px, calc(100vw - 32px))',
          boxSizing: 'border-box',
        }}
      >
        <Text variant="body" size="sm" weight="bold" as="span">
          {messages.othersTitle}
        </Text>
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
