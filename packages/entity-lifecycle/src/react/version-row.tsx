import { type JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Button } from '@12-apps/ui/form/Button';
import { Box } from '@12-apps/ui/mui/Box';
import { Stack } from '@12-apps/ui/mui/Stack';
import { Text } from '@12-apps/ui/typography/Text';

import type { VersionWire } from './api';
import type { VersionHistoryCopy } from './copy';
import { DATE_TIME } from './labels';

/** Wire kind → the copy key naming what the version did. */
const KIND_COPY_KEYS: Record<VersionWire['kind'], keyof VersionHistoryCopy['actions']> = {
  CREATE: 'create',
  UPDATE: 'update',
  RESTORE: 'restore',
};

interface VersionRowProps {
  entry: VersionWire;
  copy: VersionHistoryCopy;
  /** Who acted when no user is recorded (a job, a migration). */
  systemActor: string;
  isCurrent: boolean;
  isSelected: boolean;
  onSelect: (version: number) => void;
  onRestore: (version: number) => void;
}

/**
 * One version row: number, kind chip, date, author, field chips + restore.
 *
 * The whole row is the affordance that opens the comparison — the ticket's
 * "click an item" — so it carries the button role and the keyboard handling
 * itself rather than growing a second control the mouse would race with. The
 * restore button inside it stops propagation: restoring is not selecting.
 */
export function VersionRow({
  entry,
  copy,
  systemActor,
  isCurrent,
  isSelected,
  onSelect,
  onRestore,
}: VersionRowProps): JSX.Element {
  return (
    <Box
      data-testid={`version-row-${entry.version}`}
      role="button"
      tabIndex={0}
      aria-expanded={isSelected}
      aria-label={copy.compareAria(entry.version)}
      onClick={() => onSelect(entry.version)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect(entry.version);
      }}
      sx={{
        p: 1.5,
        borderRadius: 1,
        cursor: 'pointer',
        border: (theme) =>
          `1px solid ${isSelected ? theme.palette.primary.main : theme.palette.divider}`,
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Text variant="heading" size="sm" as="span">
          {`v${entry.version}`}
        </Text>
        <Chip label={copy.actions[KIND_COPY_KEYS[entry.kind]]} size="sm" variant="outlined" />
        {isCurrent && <Chip label={copy.currentBadge} size="sm" color="primary" />}
        {entry.restoredFromVersion !== null && (
          <Chip
            label={`a partir da v${entry.restoredFromVersion}`}
            size="sm"
            variant="outlined"
          />
        )}
        <Box sx={{ flex: 1 }} />
        {!isCurrent && (
          <Button
            variant="outline"
            size="xs"
            onClick={(event) => {
              event.stopPropagation();
              onRestore(entry.version);
            }}
            dataTestId={`version-restore-${entry.version}`}
          >
            {copy.restoreAction}
          </Button>
        )}
      </Stack>
      <Text variant="caption" as="p" color="secondary">
        {DATE_TIME.format(new Date(entry.createdAt))} · {entry.actorName ?? systemActor}
      </Text>
      {(entry.changedFields.length > 0 || entry.removedFields.length > 0) && (
        <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
          {entry.changedFields.map((field) => (
            <Chip key={`c-${field}`} label={field} size="sm" variant="outlined" />
          ))}
          {entry.removedFields.map((field) => (
            <Chip key={`r-${field}`} label={`− ${field}`} size="sm" variant="outlined" />
          ))}
        </Stack>
      )}
    </Box>
  );
}
