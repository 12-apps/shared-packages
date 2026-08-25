import type { JSX } from 'react';

import type { KindCardProps } from '@12-apps/ui/data-display/CardKit';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { BaseCard } from '@12-apps/ui/data-display/DataViews';
import { Box } from '@12-apps/ui/mui/Box';
import type { ColorValue } from '@12-apps/ui/tokens';
import type { RowAction } from '@12-apps/ui/data-display/DataViews';

import type { TeamTableCopy } from './copy';
import type { RbacLabels } from './labels';
import { TeamActionsMenu } from './team-actions-menu';
import type { MemberRowStatus, TeamRow } from './team-grid-config';

/** Mirrors the table's status chip, so the two layouts agree at a glance. */
const STATUS_COLOR: Record<MemberRowStatus, ColorValue> = {
  ENABLED: 'success',
  DISABLED: 'danger',
  PENDING: 'warning',
};

/** The member's initial for the avatar fallback — name first, then e-mail. */
function memberInitial(row: TeamRow): string {
  return (row.name ?? row.email ?? '?').trim().charAt(0).toUpperCase() || '?';
}

/** A round avatar bearing the member's initial (the roster carries no photo). */
function MemberAvatar({ row }: { row: TeamRow }): JSX.Element {
  return (
    <Box
      sx={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1.5rem',
        fontWeight: 600,
        color: 'primary.contrastText',
        backgroundColor: 'primary.main',
      }}
    >
      {memberInitial(row)}
    </Box>
  );
}

/**
 * One member tile for the grid's card layout — the generic `BaseCard` envelope
 * plus the roster's shared kebab, so a card and its table row offer exactly the
 * same actions.
 */
export function TeamCard({
  row,
  selection,
  aspectRatio,
  rowActions,
  labels,
  copy,
  menuLabel,
  onOpen,
}: KindCardProps & {
  row: TeamRow;
  rowActions: RowAction<TeamRow>[];
  labels: RbacLabels;
  copy: TeamTableCopy;
  menuLabel: string;
  onOpen?: (row: TeamRow) => void;
}): JSX.Element {
  const label =
    row.status === 'PENDING'
      ? copy.status.pending
      : row.status === 'DISABLED'
        ? copy.status.disabled
        : copy.status.active;
  // A pending accountless invite has no profile to open yet — inert, exactly as
  // the table row is.
  const open = onOpen && row.status !== 'PENDING' ? () => onOpen(row) : undefined;
  return (
    <BaseCard
      aspectRatio={aspectRatio ?? '1:1'}
      scale={selection.scale}
      selected={selection.selected}
      onToggleSelect={selection.onToggleSelect}
      onClick={open}
      state={row.status === 'DISABLED' ? 'disabled' : 'default'}
      testId={`team-card-${row.userId}`}
      title={row.name ?? row.email}
      subtitle={labels.roleLabel(row.role)}
      imageFallback={<MemberAvatar row={row} />}
      menu={<TeamActionsMenu row={row} rowActions={rowActions} menuLabel={menuLabel} />}
    >
      <Chip label={label} size="sm" variant="outlined" color={STATUS_COLOR[row.status]} />
    </BaseCard>
  );
}
