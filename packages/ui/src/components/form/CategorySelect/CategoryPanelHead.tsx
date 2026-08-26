'use client';

import type { CategorySelectCopy } from '../../../copy';
import Box from '@mui/material/Box/index.js';
import InputBase from '@mui/material/InputBase/index.js';

import { SearchGlyph } from './CategoryIcons';
import {
  chipSx,
  chipWrapSx,
  panelHeadSx,
  pinnedLabelSx,
  pinnedSx,
} from './CategorySelect.styles';
import type { CategorySelectionChip } from './CategorySelect.types';

interface PanelHeadProps {
  query: string;
  placeholder: string;
  sheet: boolean;
  /** Quick actions belong to multi-select only; single-select has nothing to bulk-do. */
  quickActions?: React.ReactNode;
  onQueryChange: (next: string) => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  dataTestId: string;
  copy: CategorySelectCopy;
}

const searchFieldSx = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  '& input': {
    width: '100%',
    height: 36,
    padding: '0 30px 0 32px',
    fontSize: 13,
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: '9px',
    background: 'background.paper',
    color: 'text.primary',
    '&:focus': {
      outline: 'none',
      borderColor: 'primary.main',
      boxShadow: (theme: { palette: { primary: { main: string } } }) =>
        `0 0 0 3px ${theme.palette.primary.main}26`,
    },
  },
} as const;

const clearButtonSx = {
  position: 'absolute',
  right: 7,
  width: 20,
  height: 20,
  border: 0,
  background: 'action.selected',
  color: 'text.secondary',
  borderRadius: '50%',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
  fontSize: 12,
  padding: 0,
  lineHeight: 1,
} as const;

/** Search field, its clear affordance, and the optional quick-action row. */
export function CategoryPanelHead({
  query,
  placeholder,
  sheet,
  quickActions,
  onQueryChange,
  searchInputRef,
  dataTestId,
  copy,
}: PanelHeadProps): React.JSX.Element {
  return (
    <Box sx={(theme) => panelHeadSx(theme, sheet)}>
      <Box sx={searchFieldSx}>
        <SearchGlyph
          style={{
            position: 'absolute',
            left: 10,
            width: 15,
            height: 15,
            opacity: 0.55,
            pointerEvents: 'none',
          }}
        />
        <InputBase
          inputRef={searchInputRef}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          inputProps={{ 'aria-label': placeholder, 'data-testid': `${dataTestId}-search` }}
          onChange={(event) => onQueryChange(event.target.value)}
          sx={{ width: '100%' }}
        />
        {query.length > 0 && (
          <Box
            component="button"
            type="button"
            aria-label={copy.search.clear}
            data-testid={`${dataTestId}-search-clear`}
            sx={clearButtonSx}
            onClick={() => onQueryChange('')}
          >
            ×
          </Box>
        )}
      </Box>
      {quickActions && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginTop: '8px',
            fontSize: 12,
          }}
        >
          {quickActions}
        </Box>
      )}
    </Box>
  );
}

interface PinnedTrayProps {
  chips: CategorySelectionChip[];
  onRemove: (chipId: string) => void;
  dataTestId: string;
  copy: CategorySelectCopy;
}

/**
 * The selected categories, pinned above the list.
 *
 * Pinned rather than left in place because a selection made at the bottom of a
 * ten-category tree scrolls out of sight the moment you look for the next one —
 * and a search hides it entirely. Here it survives both.
 */
export function CategoryPinnedTray({
  chips,
  onRemove,
  dataTestId,
  copy,
}: PinnedTrayProps): React.JSX.Element | null {
  if (chips.length === 0) return null;
  return (
    <Box sx={pinnedSx} data-testid={`${dataTestId}-pinned`}>
      <Box sx={pinnedLabelSx}>{copy.search.pinnedLabel(chips.length)}</Box>
      <Box sx={chipWrapSx}>
        {chips.map((chip) => (
          <Box component="span" key={chip.id} sx={chipSx}>
            {chip.label}
            <button
              type="button"
              aria-label={copy.search.removeChip(chip.label)}
              data-testid={`${dataTestId}-unpin-${chip.id}`}
              onClick={() => onRemove(chip.id)}
            >
              ×
            </button>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
