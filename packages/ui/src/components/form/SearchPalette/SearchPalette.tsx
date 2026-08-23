import React from 'react';

import {
  createKeyDownHandler,
  FilterChips,
  ghostRemainder,
  PALETTE_CARD_SX,
  PaletteBody,
  PaletteInput,
  PaletteScrollArea,
  Paper,
} from './SearchPalette.parts';
import type { SearchPaletteProps } from './SearchPalette.types';

/**
 * A Gmail-style search palette (FUT-168): a single card with a search input,
 * a toggleable filter-chip row, a compact list of rich result rows (leading
 * image/avatar/icon + primary/secondary + trailing), and a "see all results"
 * footer. Fully app-agnostic — every label, filter, and row field is supplied
 * by the host through accessors, so it drops into any surface.
 *
 * Keyboard: ↑/↓ move the active row across the results and the footer, Enter
 * selects it (row → `onSelect`, footer → `onSubmitAll`), Esc calls `onClose`,
 * and Tab/→ accepts the inline ghost completion of the top result.
 *
 * Presentational pieces + the keydown builder live in `SearchPalette.parts`.
 */

const DEFAULT_MAX_ITEMS = 5;

/** Non-string option defaults (numbers / flags / arrays). */
function resolveOpts<T>(props: SearchPaletteProps<T>): {
  maxItems: number;
  filters: NonNullable<SearchPaletteProps<T>['filters']>;
  activeFilterIds: string[];
  isLoading: boolean;
  showGhostText: boolean;
  autoFocus: boolean;
} {
  return {
    maxItems: props.maxItems ?? DEFAULT_MAX_ITEMS,
    filters: props.filters ?? [],
    activeFilterIds: props.activeFilterIds ?? [],
    isLoading: Boolean(props.isLoading),
    showGhostText: props.showGhostText ?? true,
    autoFocus: props.autoFocus ?? true,
  };
}

/** String / label defaults. */
function resolveText<T>(props: SearchPaletteProps<T>): {
  submitAllLabel: (q: string) => string;
  submitKeyLabel: string;
  noResultsLabel: string;
  placeholder: string;
  dataTestId: string;
} {
  return {
    submitAllLabel: props.submitAllLabel,
    submitKeyLabel: props.submitKeyLabel,
    noResultsLabel: props.noResultsLabel,
    placeholder: props.placeholder,
    dataTestId: props.dataTestId ?? 'search-palette',
  };
}

export function SearchPalette<T>(props: SearchPaletteProps<T>): React.JSX.Element {
  const opts = resolveOpts(props);
  const text = resolveText(props);

  const trimmed = props.value.trim();
  const hasQuery = trimmed.length > 0;
  const visible = props.items.slice(0, opts.maxItems);
  const showFooter = Boolean(props.onSubmitAll) && hasQuery;
  const rowCount = visible.length + (showFooter ? 1 : 0);
  const footerIndex = showFooter ? visible.length : -1;

  const [activeIndex, setActiveIndex] = React.useState(0);
  // Keep the active row in range as results change (typing, filtering).
  React.useEffect(() => {
    setActiveIndex((i) => (rowCount === 0 ? 0 : Math.min(i, rowCount - 1)));
  }, [rowCount]);

  const top = visible[0];
  const ghost =
    opts.showGhostText && hasQuery && top ? ghostRemainder(props.getPrimary(top), props.value) : '';

  const onKeyDown = createKeyDownHandler<T>({
    rowCount,
    activeIndex,
    footerIndex,
    visible,
    hasQuery,
    ghost,
    top,
    trimmed,
    getPrimary: props.getPrimary,
    onChange: props.onChange,
    onSelect: props.onSelect,
    onSubmitAll: props.onSubmitAll,
    onClose: props.onClose,
    setActiveIndex,
  });

  return (
    <Paper
      elevation={8}
      className={props.className}
      data-testid={text.dataTestId}
      sx={PALETTE_CARD_SX}
    >
      <PaletteInput
        value={props.value}
        ghost={ghost}
        isLoading={opts.isLoading}
        autoFocus={opts.autoFocus}
        placeholder={text.placeholder}
        inputAriaLabel={props.inputAriaLabel}
        hasQuery={hasQuery}
        onChange={props.onChange}
        onKeyDown={onKeyDown}
      />
      {opts.filters.length > 0 && (
        <FilterChips
          filters={opts.filters}
          activeFilterIds={opts.activeFilterIds}
          onToggleFilter={props.onToggleFilter}
        />
      )}
      <PaletteScrollArea>
        <PaletteBody<T>
          hasQuery={hasQuery} emptyQueryContent={props.emptyQueryContent} visible={visible}
          isLoading={opts.isLoading} noResultsLabel={text.noResultsLabel} showFooter={showFooter}
          footerIndex={footerIndex} activeIndex={activeIndex} trimmed={trimmed}
          submitAllLabel={text.submitAllLabel} submitKeyLabel={text.submitKeyLabel}
          getKey={props.getKey} getPrimary={props.getPrimary}
          getSecondary={props.getSecondary} getLead={props.getLead} getTrailing={props.getTrailing}
          onSelect={props.onSelect} onSubmitAll={props.onSubmitAll} setActiveIndex={setActiveIndex}
        />
      </PaletteScrollArea>
    </Paper>
  );
}

SearchPalette.displayName = 'SearchPalette';

export default SearchPalette;
