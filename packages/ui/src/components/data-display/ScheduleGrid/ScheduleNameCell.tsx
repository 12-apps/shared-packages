import Box from '@mui/material/Box/index.js';
import type { SxProps, Theme } from '@mui/material/styles/index.js';
import type * as React from 'react';

import { chipsSx, metaSx, nameButtonSx, nameLineSx, nameTextSx } from './schedule-name.styles';

/** What a row says about its person, in both views. */
export interface ScheduleNameRow {
  label: string;
  meta?: string;
  metaTone?: 'default' | 'warning';
  onLabelClick?: () => void;
  labelAccessible?: string;
  nameAdornment?: React.ReactNode;
  chips?: React.ReactNode;
}

interface ScheduleNameCellProps {
  row: ScheduleNameRow;
  /** The cell's own box (where it sits in its view's row). */
  sx: SxProps<Theme>;
  /** `rowheader` in the week grid's table; none on the ruler. */
  role?: string;
  /** The view's type sizes (px) and the space above the chips (spacing units). */
  sizes: { name: number; meta: number; chipsTop: number };
}

/**
 * The first column of a schedule row (FUT-3825): the name (a button when the
 * host acts on it), its adornment, its meta line and its chips — one part for
 * the week grid and the day ruler, so a person reads the same in both.
 */
export function ScheduleNameCell({ row, sx, role, sizes }: ScheduleNameCellProps): React.JSX.Element {
  const name = (
    <Box component="span" sx={nameTextSx(sizes.name)}>
      {row.label}
    </Box>
  );
  const named = row.onLabelClick ? (
    <Box component="button" type="button" sx={nameButtonSx} onClick={row.onLabelClick} aria-label={row.labelAccessible}>
      {name}
    </Box>
  ) : (
    name
  );
  return (
    <Box role={role} sx={sx}>
      {row.nameAdornment ? (
        <Box sx={nameLineSx}>
          {named}
          <Box component="span" data-schedule-adornment="">
            {row.nameAdornment}
          </Box>
        </Box>
      ) : (
        named
      )}
      {row.meta ? (
        <Box component="span" sx={metaSx(row.metaTone ?? 'default', sizes.meta)}>
          {row.meta}
        </Box>
      ) : null}
      {row.chips ? <Box sx={chipsSx(sizes.chipsTop)}>{row.chips}</Box> : null}
    </Box>
  );
}
