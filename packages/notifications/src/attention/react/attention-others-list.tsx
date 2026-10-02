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
  width: '100%',
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
        sx={{
          p: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          // Never wider than the screen less the popover's 16px margins: at
          // 320px a fixed 260–320 ran 9px off the left edge.
          minWidth: 'min(260px, calc(100vw - 32px))',
          maxWidth: 'min(320px, calc(100vw - 32px))',
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
            const { title, what, spoken } = view.describe(entry.item);
            const waited = messages.waited(minutesOf(entry.waitedMs), entry.waitedMs);
            return (
              <Box component="li" key={entry.item.id}>
                <Box
                  component="button"
                  type="button"
                  aria-label={`${spoken ?? title}, ${what}, ${waited}, ${messages.severity[entry.severity]}`}
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
                  <Box component="span" aria-hidden sx={{ flex: 1, minWidth: 0 }}>
                    <strong>{title}</strong> · {what}
                  </Box>
                  <Box component="span" aria-hidden sx={{ whiteSpace: 'nowrap', color: 'text.secondary' }}>
                    {waited}
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Popover>
  );
}
