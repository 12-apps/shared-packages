/**
 * What "+N" opens: everything after the head, in the queue's order, each row
 * opening its own item. Late rows wear a square and calm ones a dot, so the
 * shape says it as well as the hue.
 */
import type { JSX } from 'react';

import { Popover } from '@12-apps/ui/data-display/Popover';
import { Box } from '@12-apps/ui/mui/Box';
import type { Theme } from '@12-apps/ui/mui/styles';
import { Text } from '@12-apps/ui/typography/Text';

import type { AttentionEntry } from '../core';

import { severityFill } from './attention-button';
import type { AttentionMessages } from './messages';
import { minutesOf, type AttentionViews } from './views';

const ROW_SX = {
  display: 'flex',
  alignItems: 'center',
  gap: 1.25,
  minHeight: 48,
  px: 1,
  border: 0,
  borderRadius: 1,
  bgcolor: 'action.hover',
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

export interface AttentionOthersListProps {
  readonly anchor: HTMLElement | null;
  readonly entries: readonly AttentionEntry[];
  readonly views: AttentionViews;
  readonly messages: AttentionMessages;
  readonly onClose: () => void;
  readonly onPick: (entry: AttentionEntry) => void;
}

export function AttentionOthersList({
  anchor,
  entries,
  views,
  messages,
  onClose,
  onPick,
}: AttentionOthersListProps): JSX.Element {
  return (
    <Popover
      open={anchor !== null && entries.length > 0}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      dataTestId="attention-others-list"
    >
      <Box
        role="list"
        aria-label={messages.othersTitle}
        sx={{
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          minWidth: 260,
          maxWidth: 320,
        }}
      >
        <Text variant="body" size="sm" weight="bold" as="span">
          {messages.othersTitle}
        </Text>
        {entries.map((entry) => {
          const view = views[entry.kind.id];
          if (view === undefined) return null;
          const { title, what } = view.describe(entry.item);
          return (
            <Box
              key={entry.item.id}
              role="listitem"
              component="button"
              type="button"
              data-testid={`attention-others-${entry.item.id}`}
              data-severity={entry.severity}
              onClick={() => onPick(entry)}
              sx={ROW_SX}
            >
              <Box
                component="span"
                aria-hidden
                sx={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  borderRadius: entry.severity === 'calm' ? '50%' : '2px',
                  bgcolor: (theme: Theme) => severityFill(theme, entry.severity),
                }}
              />
              <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
                <strong>{title}</strong> · {what}
              </Box>
              <Box component="span" sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                {messages.waited(minutesOf(entry.waitedMs))}
              </Box>
            </Box>
          );
        })}
      </Box>
    </Popover>
  );
}
