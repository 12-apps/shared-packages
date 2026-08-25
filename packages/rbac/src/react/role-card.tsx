'use client';

import type { JSX } from 'react';

import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';

import type { KindCardProps } from '@12-apps/ui/data-display/CardKit';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { BaseCard } from '@12-apps/ui/data-display/DataViews';

import { RoleActionsMenu, type RoleMenuContext } from './role-actions-menu';
import { roleKindLabel, type RoleRow } from './role-grid-config';

/**
 * One role tile for the grid's card layout — the generic `BaseCard` envelope
 * plus the role's self-contained menu.
 */
export function RoleCard({
  row,
  selection,
  aspectRatio,
  context,
}: KindCardProps & { row: RoleRow; context: RoleMenuContext }): JSX.Element {
  const copy = context.copy.rolesTable;
  return (
    <BaseCard
      aspectRatio={aspectRatio ?? '4:3'}
      scale={selection.scale}
      selected={selection.selected}
      onToggleSelect={selection.onToggleSelect}
      testId={`role-card-${row.id}`}
      title={row.name}
      subtitle={row.description ?? copy.emptyValue}
      imageFallback={<BadgeOutlinedIcon sx={{ fontSize: 40, opacity: 0.35 }} />}
      menu={<RoleActionsMenu row={row} context={context} />}
    >
      <Chip
        label={roleKindLabel(row, copy)}
        size="sm"
        variant={row.system ? 'outlined' : 'filled'}
        color={row.system ? 'neutral' : 'info'}
        dataTestId={`role-card-type-${row.id}`}
      />
    </BaseCard>
  );
}
