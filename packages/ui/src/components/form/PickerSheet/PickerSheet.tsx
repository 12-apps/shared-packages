'use client';

import { useId } from 'react';
import Box from '@mui/material/Box/index.js';
import Dialog from '@mui/material/Dialog/index.js';
import Drawer from '@mui/material/Drawer/index.js';
import { useTheme } from '@mui/material/styles/index.js';
import useMediaQuery from '@mui/material/useMediaQuery/index.js';

import { METRICS as CATEGORY_SELECT_METRICS } from '../CategorySelect/CategorySelect.styles';
import { stackedOverlayZIndex } from '../../../tokens/layers';
import { PickerSheetHead, PickerSheetList, PickerSheetSearch } from './PickerSheet.parts';
import { bodySx, dialogPaperSx, footSx, sheetPaperSx } from './PickerSheet.styles';
import type { PickerSheetProps } from './PickerSheet.types';
import { usePickerSheet } from './usePickerSheet';

/**
 * Both surfaces clear the sheet ladder rather than taking MUI's default — the
 * same rule as `CategoryPanelSurface`. A `Dialog` sits at `zIndex.modal` and a
 * temporary `Drawer` a step lower, while `StackedModal` puts its second panel
 * at 1310: a picker opened from a stacked editor painted UNDER it (FUT-806).
 * See `tokens/layers`.
 */
const ABOVE_SHEETS = { zIndex: stackedOverlayZIndex } as const;

interface SurfaceProps {
  open: boolean;
  /** True below the sheet breakpoint — a bottom sheet instead of a centred dialog. */
  sheet: boolean;
  onClose: () => void;
  titleId: string;
  dataTestId: string;
  children: React.ReactNode;
}

/**
 * Where the sheet lives. Both surfaces are modal, which gives Esc, the
 * tap-outside dismissal and focus containment for free.
 */
function PickerSheetSurface({ open, sheet, onClose, titleId, dataTestId, children }: SurfaceProps): React.JSX.Element {
  const close = (): void => onClose();
  if (sheet) {
    // A Drawer's paper carries no dialog semantics of its own, so it is given them.
    const paper = {
      sx: sheetPaperSx,
      role: 'dialog',
      'aria-modal': true,
      'aria-labelledby': titleId,
      'data-testid': dataTestId,
    };
    return (
      <Drawer anchor="bottom" open={open} onClose={close} sx={ABOVE_SHEETS} slotProps={{ paper }}>
        {children}
      </Drawer>
    );
  }
  const paper = { sx: dialogPaperSx, 'data-testid': dataTestId };
  return (
    <Dialog open={open} onClose={close} aria-labelledby={titleId} sx={ABOVE_SHEETS} slotProps={{ paper }}>
      {children}
    </Dialog>
  );
}

/**
 * A searchable pick-or-create sheet: a title, a search box, a list of rows
 * (optionally a tree), and a create row when the query names nothing yet.
 *
 * A centred dialog on a pointer and a bottom sheet under `CategorySelect`'s
 * sheet breakpoint. Typing filters (case-insensitive substring over each
 * item's label and `searchText`, accents aside) and flattens the tree; ↑↓ move
 * the cursor, Enter picks,
 * Esc or a tap outside closes. Picking calls `onPick` and nothing else — the
 * caller decides when to close. All copy comes from the caller.
 */
export function PickerSheet(props: PickerSheetProps): React.JSX.Element {
  const { open, onClose, kicker, title, searchPlaceholder, searchLabel, closeLabel, createLabel, createMeta, emptyText, foot } =
    props;
  const dataTestId = props.dataTestId ?? 'picker-sheet';
  const theme = useTheme();
  const sheet = useMediaQuery(theme.breakpoints.down(CATEGORY_SELECT_METRICS.sheetBreakpoint));
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const listId = `${baseId}-list`;
  const rowId = (index: number): string => `${baseId}-row-${index}`;
  const state = usePickerSheet(props);

  return (
    <PickerSheetSurface open={open} sheet={sheet} onClose={onClose} titleId={titleId} dataTestId={dataTestId}>
      <PickerSheetHead
        kicker={kicker}
        title={title}
        titleId={titleId}
        closeLabel={closeLabel}
        onClose={onClose}
        dataTestId={dataTestId}
      />
      <Box sx={bodySx}>
        <PickerSheetSearch
          query={state.query}
          placeholder={searchPlaceholder}
          label={searchLabel}
          listId={listId}
          activeId={state.activeIndex >= 0 ? rowId(state.activeIndex) : undefined}
          expanded={state.view.rowCount > 0}
          inputRef={state.searchInputRef}
          onQueryChange={state.setQuery}
          onKeyDown={state.onSearchKeyDown}
          dataTestId={dataTestId}
        />
        <PickerSheetList
          view={state.view}
          activeIndex={state.activeIndex}
          cursorShown={state.cursorShown}
          listId={listId}
          rowId={rowId}
          listRef={state.listRef}
          createLabel={createLabel}
          createMeta={createMeta}
          emptyText={emptyText}
          onChoose={state.choose}
          dataTestId={dataTestId}
        />
        {foot ? (
          <Box component="p" sx={footSx} data-testid={`${dataTestId}-foot`}>
            {foot}
          </Box>
        ) : null}
      </Box>
    </PickerSheetSurface>
  );
}
