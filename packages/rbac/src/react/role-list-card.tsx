'use client';

import type { JSX } from 'react';

import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';

import {
  BodyHeading,
  DetailColumns,
  Fact,
  TagList,
  type KindListCardProps,
} from '@12-apps/ui/data-display/CardKit';
import { Chip } from '@12-apps/ui/data-display/Chip';
import { BaseListCard, type ListCardCellConfig } from '@12-apps/ui/data-display/DataViews';

import type { RolesTableCopy } from './copy';
import { RoleActionsMenu, type RoleMenuContext } from './role-actions-menu';
import { permissionCount, roleKindLabel, type RoleRow } from './role-grid-config';

/**
 * Declared here and ALSO handed to the grid's `listGroup`, which is not
 * redundancy: inside a list group the group's config wins and the card's is
 * ignored, which is what makes the columns line up by construction. Outside one,
 * the card's own config is the only thing it has — a standalone row with neither
 * falls back to the named slots and renders no summary at all.
 */
export function roleCells(copy: RolesTableCopy): ListCardCellConfig<RoleRow>[] {
  return [
    {
      id: 'role',
      primary: (row) => row.name,
      secondary: (row) => row.description ?? copy.noDescription,
    },
    { id: 'kind', align: 'center', primary: (row) => roleKindLabel(row, copy) },
    {
      id: 'grants',
      align: 'end',
      width: 'max-content',
      strong: true,
      primary: (row) => permissionCount(row.permissions, copy),
      secondary: () => copy.permissionsUnit,
    },
  ];
}

/**
 * One role row for the list layout — the case the table can least serve.
 *
 * A role IS its permission set, and `permissions` is a `readonly string[]`: a
 * shape with no honest table cell. Rendered as a count it says nothing anybody
 * can act on; rendered in full it destroys the column. So the grid shows a
 * number and the actual grants — the thing anybody reviewing access is looking
 * for — are simply not in the UI. Here the count stays on the value rail, and
 * opening the row lists the grants themselves.
 *
 * A wildcard is stated in WORDS rather than printed as a one-item set holding an
 * asterisk, which is what a naive render shows and badly understates.
 */
export function RoleListCard({
  row,
  selection,
  context,
}: KindListCardProps & { row: RoleRow; context: RoleMenuContext }): JSX.Element {
  const copy = context.copy.rolesTable;
  const wildcard = row.permissions === '*';
  return (
    <BaseListCard
      row={row}
      cells={roleCells(copy)}
      scale={selection.scale}
      selected={selection.selected}
      onToggleSelect={selection.onToggleSelect}
      testId={`role-list-card-${row.id}`}
      leading={<BadgeOutlinedIcon sx={{ fontSize: 22, color: 'text.disabled' }} />}
      menu={<RoleActionsMenu row={row} context={context} />}
    >
      <DetailColumns
        left={
          <>
            <Fact label={copy.headers.kind} value={roleKindLabel(row, copy)} />
            <Fact
              label={copy.editableLabel}
              value={
                row.editable ? (
                  copy.editableYes
                ) : (
                  <Chip label={copy.lockedLabel} size="sm" variant="outlined" color="neutral" />
                )
              }
            />
            <Fact label={copy.headers.description} value={row.description ?? copy.emptyValue} />
          </>
        }
        right={
          <>
            <BodyHeading>{copy.headers.permissions}</BodyHeading>
            {wildcard ? (
              <Chip
                label={copy.allPermissions}
                size="sm"
                variant="filled"
                color="info"
                dataTestId={`role-list-card-wildcard-${row.id}`}
              />
            ) : (
              <TagList
                items={row.permissions as readonly string[]}
                empty={copy.noPermissions}
              />
            )}
          </>
        }
      />
    </BaseListCard>
  );
}
