import { Box, ClickAwayListener } from '@mui/material';
import React from 'react';

import {
  defaultGetKey,
  defaultGetLabel,
  defaultGetSuggestionType,
  type MatchMode,
} from './Autocomplete.helpers';
import {
  AutocompleteInput,
  ChipList,
  DefaultSuggestion,
  SuggestionListBox,
} from './Autocomplete.parts';
import type { AutocompleteOption, AutocompleteProps, SuggestionType } from './Autocomplete.types';
import { useAutocomplete, type AutocompleteView } from './useAutocomplete';

/** Presentational props resolved from {@link AutocompleteProps} (defaults applied once). */
interface RenderConfig<T> {
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  getSuggestionType: (item: T) => SuggestionType | undefined;
  getDescription?: (item: T) => string | undefined;
  renderSuggestion?: (item: T, state: { active: boolean; query: string }) => React.ReactNode;
  matchMode: MatchMode;
  multiple: boolean;
  selectedItems: T[];
  isLoading: boolean;
  showGhostText: boolean;
  placeholder: string;
  autoFocus: boolean;
  disabled: boolean;
  portal: boolean | { container?: HTMLElement };
  className?: string;
  chipClassName?: string;
  inputAriaLabel?: string;
  inputClassName?: string;
  listClassName?: string;
  itemClassName?: string;
  activeItemClassName?: string;
}

/** Apply presentational defaults once so the component itself stays branch-light. */
function resolveRenderConfig<T>(p: AutocompleteProps<T>): RenderConfig<T> {
  return {
    getKey: p.getKey ?? defaultGetKey,
    getLabel: p.getLabel ?? defaultGetLabel,
    getSuggestionType: p.getSuggestionType ?? defaultGetSuggestionType,
    getDescription: p.getDescription,
    renderSuggestion: p.renderSuggestion,
    matchMode: p.matchMode ?? 'contains',
    multiple: Boolean(p.multiple),
    selectedItems: p.selectedItems ?? [],
    isLoading: Boolean(p.isLoading),
    showGhostText: p.showGhostText ?? true,
    placeholder: p.placeholder ?? p.copy.placeholder,
    autoFocus: Boolean(p.autoFocus),
    disabled: Boolean(p.disabled),
    portal: p.portal ?? false,
    className: p.className,
    chipClassName: p.chipClassName,
    inputAriaLabel: p.inputAriaLabel,
    inputClassName: p.inputClassName,
    listClassName: p.listClassName,
    itemClassName: p.itemClassName,
    activeItemClassName: p.activeItemClassName,
  };
}

/** A single suggestion node: the caller's custom renderer or the default row. */
function renderSuggestionNode<T>(item: T, active: boolean, query: string, cfg: RenderConfig<T>): React.ReactNode {
  if (cfg.renderSuggestion) return cfg.renderSuggestion(item, { active, query });
  return (
    <DefaultSuggestion
      item={item}
      state={{ active, query }}
      getLabel={cfg.getLabel}
      getDescription={cfg.getDescription}
      getSuggestionType={cfg.getSuggestionType}
      matchMode={cfg.matchMode}
    />
  );
}

/**
 * ARIA combobox with a popup listbox: local/async filtering, inline ghost
 * completion (Tab/→), multi-select chips, custom rendering, and typed
 * `search`/`link` suggestions (a `link` opens its URL instead of filling the
 * input). State/effects/handlers live in {@link useAutocomplete}; presentational
 * pieces live in `Autocomplete.parts`.
 */
export const Autocomplete = <T = AutocompleteOption>(props: AutocompleteProps<T>): React.JSX.Element => {
  const cfg = resolveRenderConfig(props);
  const view: AutocompleteView<T> = useAutocomplete<T>(props);
  const s = view.state;
  const showNoResults =
    !cfg.isLoading && view.visibleSuggestions.length === 0 && Boolean(s.inputValue.trim());

  return (
    <ClickAwayListener onClickAway={view.onClickAway}>
      <Box className={cfg.className} data-testid="autocomplete-container">
        {cfg.multiple && cfg.selectedItems.length > 0 && (
          <ChipList
            items={cfg.selectedItems}
            getKey={cfg.getKey}
            getLabel={cfg.getLabel}
            onRemove={view.removeSelectedItem}
            chipClassName={cfg.chipClassName}
          />
        )}

        <AutocompleteInput
          id={view.id}
          listId={view.listId}
          inputRef={s.inputRef}
          inputValue={s.inputValue}
          ghost={s.ghost}
          showGhost={cfg.showGhostText}
          isInputFocused={s.isInputFocused}
          open={s.open}
          activeDescendant={view.activeDescendant}
          isLoading={cfg.isLoading}
          disabled={cfg.disabled}
          autoFocus={cfg.autoFocus}
          placeholder={cfg.placeholder}
          startAdornment={props.startAdornment}
          inputAriaLabel={cfg.inputAriaLabel}
          inputClassName={cfg.inputClassName}
          onChange={view.onInputChange}
          onKeyDown={view.onKeyDown}
          onFocus={view.onFocus}
          onBlur={view.onBlur}
          onCompositionStart={() => s.setComposition(true)}
          onCompositionEnd={() => s.setComposition(false)}
        />

        {s.open && (
          <SuggestionListBox
            copy={props.copy}
            open={s.open}
            anchorEl={s.inputRef.current}
            portal={cfg.portal}
            listRef={s.listRef}
            listId={view.listId}
            optionIdPrefix={view.optionIdPrefix}
            items={view.visibleSuggestions}
            activeIndex={s.activeIndex}
            isLoading={cfg.isLoading}
            showNoResults={showNoResults}
            getKey={cfg.getKey}
            onSelect={view.selectItem}
            onHover={s.setActiveIndex}
            renderItem={(item, active) => renderSuggestionNode(item, active, s.inputValue, cfg)}
            listClassName={cfg.listClassName}
            itemClassName={cfg.itemClassName}
            activeItemClassName={cfg.activeItemClassName}
          />
        )}
      </Box>
    </ClickAwayListener>
  );
};

Autocomplete.displayName = 'Autocomplete';

export default Autocomplete;
