'use client';

import type { CategorySelectCopy } from "../../../copy";
import { Box } from '@mui/material';

import { removeChip } from './category-tree';
import { CategoryMultiFoot, CategorySingleFoot } from './CategoryPanelFoot';
import { CategoryPanelHead, CategoryPinnedTray } from './CategoryPanelHead';
import { CategoryPanelList } from './CategoryPanelList';
import { CategoryQuickActions } from './CategoryQuickActions';
import { panelSx, sheetSx } from './CategorySelect.styles';
import type { CategoryGroup, CategorySelectionChip } from './CategorySelect.types';
import type { CategorySelectState } from './useCategorySelect';

export interface CategoryPanelProps {
  /** The words this panel renders. REQUIRED — no default copy. */
  copy: CategorySelectCopy;
  state: CategorySelectState;
  chips: CategorySelectionChip[];
  rowIds: string[];
  /** True when the applied selection differs from the draft. */
  changed: boolean;
  single: boolean;
  sheet: boolean;
  loading: boolean;
  showCounts: boolean;
  allowParentSelection: boolean;
  ariaLabel: string;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onActivateCategory: (group: CategoryGroup) => void;
  onActivateSubcategory: (id: string) => void;
  onApply: () => void;
  onCancel: () => void;
  onCreateCategory?: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
  listRef: React.RefObject<HTMLDivElement | null>;
  dataTestId: string;
}

/** Search + pinned selection + tree + footer, in the panel's own chrome. */
export function CategoryPanel({
  state,
  chips,
  rowIds,
  changed,
  single,
  sheet,
  loading,
  showCounts,
  allowParentSelection,
  ariaLabel,
  onKeyDown,
  onActivateCategory,
  onActivateSubcategory,
  onApply,
  onCancel,
  onCreateCategory,
  searchInputRef,
  listRef,
  dataTestId,
  copy,
}: CategoryPanelProps): React.JSX.Element {
  return (
    <Box
      onKeyDown={onKeyDown}
      role="dialog"
      aria-label={ariaLabel}
      data-testid={`${dataTestId}-panel`}
      sx={(theme) => ({ ...panelSx(theme), ...(sheet ? sheetSx(theme) : {}) })}
    >
      <CategoryPanelHead
        copy={copy}
        query={state.query}
        placeholder={single ? copy.search.placeholderSingle : copy.search.placeholderMulti}
        sheet={sheet}
        quickActions={
          single ? undefined : <CategoryQuickActions state={state} dataTestId={dataTestId} copy={copy} />
        }
        onQueryChange={state.setQuery}
        searchInputRef={searchInputRef}
        dataTestId={dataTestId}
      />
      {!single && !loading && (
        <PinnedTray state={state} chips={chips} dataTestId={dataTestId} copy={copy} />
      )}
      <CategoryPanelList copy={copy}
        groups={state.visibleGroups}
        query={state.query}
        draft={state.draft}
        rowIds={rowIds}
        activeIndex={state.activeIndex}
        sheet={sheet}
        single={single}
        loading={loading}
        showCounts={showCounts}
        allowParentSelection={allowParentSelection}
        isExpanded={state.isExpanded}
        onToggleExpanded={state.toggleExpanded}
        onActivateCategory={onActivateCategory}
        onActivateSubcategory={onActivateSubcategory}
        onClearQuery={() => state.setQuery('')}
        onCreateCategory={onCreateCategory}
        listRef={listRef}
        dataTestId={dataTestId}
      />
      <PanelFooter
        state={state}
        changed={changed}
        single={single}
        sheet={sheet}
        copy={copy}
        onApply={onApply}
        onCancel={onCancel}
        dataTestId={dataTestId}
      />
    </Box>
  );
}

/** The selected-category chips, wired to remove from the draft. */
function PinnedTray({
  state,
  chips,
  dataTestId,
  copy,
}: Pick<CategoryPanelProps, 'state' | 'chips' | 'dataTestId' | 'copy'>): React.JSX.Element {
  return (
    <CategoryPinnedTray
      copy={copy}
      chips={chips}
      onRemove={(chipId) => state.setDraft(removeChip(state.allGroups, chipId, state.draft))}
      dataTestId={dataTestId}
    />
  );
}

/** Whichever footer the mode calls for. */
function PanelFooter({
  state,
  changed,
  single,
  sheet,
  onApply,
  onCancel,
  dataTestId,
  copy,
}: Pick<
  CategoryPanelProps,
  'state' | 'changed' | 'single' | 'sheet' | 'onApply' | 'onCancel' | 'dataTestId' | 'copy'
>): React.JSX.Element {
  if (single) {
    return (
      <CategorySingleFoot sheet={sheet} onCancel={onCancel} dataTestId={dataTestId} copy={copy} />
    );
  }
  return (
    <CategoryMultiFoot
      count={state.draft.size}
      changed={changed}
      sheet={sheet}
      copy={copy}
      onClear={() => state.setDraft(new Set())}
      onApply={onApply}
      dataTestId={dataTestId}
    />
  );
}
