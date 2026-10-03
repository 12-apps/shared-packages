'use client';

import Box from '@mui/material/Box/index.js';
import InputBase from '@mui/material/InputBase/index.js';

import { CheckGlyph, SearchGlyph } from '../CategorySelect/CategoryIcons';
import type { PickerSheetView } from './picker-sheet-model';
import {
  checkSx,
  closeButtonSx,
  createLabelSx,
  emptySx,
  headSx,
  kickerSx,
  listSx,
  rowLabelSx,
  rowMetaSx,
  rowPaddingLeft,
  rowSx,
  rowTextSx,
  searchFieldSx,
  titleSx,
} from './PickerSheet.styles';
import type { PickerSheetItem } from './PickerSheet.types';

/** The close button's cross, at the weight of the search glyph beside it. */
function CloseGlyph(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

interface HeadProps {
  kicker?: string;
  title: string;
  titleId: string;
  closeLabel: string;
  onClose: () => void;
  dataTestId: string;
}

/** `.sh` — kicker over title, and the bordered close button. */
export function PickerSheetHead({ kicker, title, titleId, closeLabel, onClose, dataTestId }: HeadProps): React.JSX.Element {
  return (
    <Box sx={headSx}>
      <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
        {kicker ? <Box sx={kickerSx}>{kicker}</Box> : null}
        <Box component="h2" id={titleId} sx={titleSx}>
          {title}
        </Box>
      </Box>
      <Box
        component="button"
        type="button"
        aria-label={closeLabel}
        data-testid={`${dataTestId}-close`}
        onClick={onClose}
        sx={closeButtonSx}
      >
        <CloseGlyph />
      </Box>
    </Box>
  );
}

interface SearchProps {
  query: string;
  placeholder: string;
  label: string;
  listId: string;
  activeId: string | undefined;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onQueryChange: (next: string) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  dataTestId: string;
}

/** The search field — a combobox over the list below it, so the cursor is announced. */
export function PickerSheetSearch(props: SearchProps): React.JSX.Element {
  const { query, placeholder, label, listId, activeId, inputRef, onQueryChange, onKeyDown, dataTestId } = props;
  return (
    <Box sx={searchFieldSx}>
      <SearchGlyph />
      <InputBase
        inputRef={inputRef}
        value={query}
        placeholder={placeholder}
        autoComplete="off"
        sx={{ width: '100%' }}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        inputProps={{
          role: 'combobox',
          'aria-label': label,
          'aria-expanded': true,
          'aria-controls': listId,
          'aria-autocomplete': 'list',
          'aria-activedescendant': activeId,
          'data-testid': `${dataTestId}-search`,
        }}
      />
    </Box>
  );
}

interface RowProps {
  item: PickerSheetItem;
  rowId: string;
  active: boolean;
  /** False while searching: the tree flattens and `meta` carries the path. */
  indented: boolean;
  onChoose: () => void;
  dataTestId: string;
}

/** `.pitem` — one item: label, optional meta line, and the check when selected. */
function PickerSheetRow({ item, rowId, active, indented, onChoose, dataTestId }: RowProps): React.JSX.Element {
  const selected = item.selected ?? false;
  const depth = indented ? (item.indent ?? 0) : 0;
  return (
    <Box
      component="li"
      id={rowId}
      role="option"
      aria-selected={selected}
      data-testid={`${dataTestId}-item-${item.id}`}
      data-indent={depth}
      onClick={onChoose}
      sx={(theme) => ({ ...rowSx(theme, selected, active), paddingLeft: rowPaddingLeft(theme, depth) })}
    >
      <Box component="span" sx={rowTextSx}>
        <Box component="span" sx={rowLabelSx}>
          {item.label}
        </Box>
        {item.meta ? (
          <Box component="span" sx={rowMetaSx}>
            {item.meta}
          </Box>
        ) : null}
      </Box>
      {selected ? (
        <Box component="span" sx={checkSx} data-testid={`${dataTestId}-check-${item.id}`}>
          <CheckGlyph />
        </Box>
      ) : null}
    </Box>
  );
}

interface ListProps {
  view: PickerSheetView;
  activeIndex: number;
  listId: string;
  rowId: (index: number) => string;
  listRef: React.RefObject<HTMLUListElement | null>;
  createLabel?: (query: string) => string;
  emptyText?: (query: string) => string;
  onChoose: (index: number) => void;
  dataTestId: string;
}

/** The matching items, then the create row — or the empty text when there is neither. */
export function PickerSheetList(props: ListProps): React.JSX.Element | null {
  const { view, activeIndex, listId, rowId, listRef, createLabel, emptyText, onChoose, dataTestId } = props;
  if (view.rowCount === 0) {
    const text = emptyText?.(view.query);
    return text ? (
      <Box sx={emptySx} role="status" data-testid={`${dataTestId}-empty`}>
        {text}
      </Box>
    ) : null;
  }
  const createIndex = view.items.length;
  return (
    <Box component="ul" id={listId} role="listbox" ref={listRef} sx={listSx} data-testid={`${dataTestId}-list`}>
      {view.items.map((item, index) => (
        <PickerSheetRow
          key={item.id}
          item={item}
          rowId={rowId(index)}
          active={index === activeIndex}
          indented={view.query.length === 0}
          onChoose={() => onChoose(index)}
          dataTestId={dataTestId}
        />
      ))}
      {view.canCreate && createLabel ? (
        <Box
          component="li"
          id={rowId(createIndex)}
          role="option"
          aria-selected={false}
          data-testid={`${dataTestId}-create`}
          onClick={() => onChoose(createIndex)}
          sx={(theme) => rowSx(theme, false, activeIndex === createIndex)}
        >
          <Box component="span" sx={createLabelSx}>
            {createLabel(view.query)}
          </Box>
        </Box>
      ) : null}
    </Box>
  );
}
