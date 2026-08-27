import type { JSX } from 'react';

import { Chip } from '@12-apps/ui/data-display/Chip';
import { Box } from '@12-apps/ui/mui/Box';
import { Text } from '@12-apps/ui/typography/Text';

import type { EmailPreviewRow } from '../catalog';

import type { EmailPreviewScreenCopy } from './copy';

/**
 * The catalogue, grouped by the PACKAGE that owns each message.
 *
 * Grouping by owner rather than by family is the whole answer to "which parts
 * of this system send mail": the section headers ARE that list, derived from
 * the rows the surface sent rather than written down anywhere, so a package
 * that starts sending mail appears the day it does.
 *
 * The family stays visible as a chip on each row, because it is the other
 * question an operator asks — and one owner can span two families.
 */

interface OwnerGroup {
  owner: string;
  rows: EmailPreviewRow[];
}

/** Group in FIRST-SEEN order, so the list does not reshuffle between renders. */
function groupByOwner(rows: readonly EmailPreviewRow[]): OwnerGroup[] {
  const groups = new Map<string, EmailPreviewRow[]>();
  for (const row of rows) {
    const bucket = groups.get(row.owner);
    if (bucket) bucket.push(row);
    else groups.set(row.owner, [row]);
  }
  return [...groups].map(([owner, ownerRows]) => ({ owner, rows: ownerRows }));
}

/** Does this row match what was typed? Subject, key, owner and family all count. */
export function matchesFilter(row: EmailPreviewRow, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return true;
  return [row.subject, row.key, row.owner, row.family].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

function MessageRow({
  row,
  selected,
  onSelect,
}: {
  row: EmailPreviewRow;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  return (
    <Box
      component="button"
      type="button"
      data-testid={`email-preview-row-${row.id}`}
      aria-current={selected}
      onClick={() => onSelect(row.id)}
      sx={{
        appearance: 'none',
        textAlign: 'left',
        width: '100%',
        cursor: 'pointer',
        border: '1px solid',
        borderColor: selected ? 'primary.main' : 'divider',
        background: selected ? 'action.selected' : 'background.paper',
        borderRadius: 1.5,
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
      }}
    >
      <Text as="span" size="sm" weight="medium">
        {row.subject}
      </Text>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Chip label={row.family} size="sm" variant="outlined" color="neutral" />
        <Text as="span" size="xs" color="secondary">
          {row.key}
        </Text>
      </Box>
    </Box>
  );
}

export function MessageList({
  rows,
  selectedId,
  copy,
  onSelect,
}: {
  rows: readonly EmailPreviewRow[];
  selectedId: string | null;
  copy: EmailPreviewScreenCopy;
  onSelect: (id: string) => void;
}): JSX.Element {
  if (rows.length === 0) {
    return (
      <Text as="p" size="sm" color="secondary" data-testid="email-preview-no-matches">
        {copy.noMatches}
      </Text>
    );
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {groupByOwner(rows).map((group) => (
        <Box
          key={group.owner}
          data-testid={`email-preview-owner-${group.owner}`}
          sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}
        >
          <Text as="p" size="xs" weight="medium" color="secondary">
            {group.owner}
          </Text>
          {group.rows.map((row) => (
            <MessageRow
              key={row.id}
              row={row}
              selected={row.id === selectedId}
              onSelect={onSelect}
            />
          ))}
        </Box>
      ))}
    </Box>
  );
}
