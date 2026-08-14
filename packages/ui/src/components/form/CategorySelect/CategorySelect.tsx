'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useMediaQuery, useTheme } from '@mui/material';

import { summarizeSelection } from './category-tree';
import { CategoryPanel } from './CategoryPanel';
import { CategoryPanelSurface } from './CategoryPanelSurface';
import { CategoryTrigger } from './CategoryTrigger';
import { METRICS } from './CategorySelect.styles';
import type { CategoryGroup, CategorySelectProps } from './CategorySelect.types';
import { useCategoryCommit } from './useCategoryCommit';
import { useCategoryKeyHandler } from './useCategoryKeyHandler';
import { useCategorySelect } from './useCategorySelect';
import { FormControl, FormLabel, FormMessage } from '../Form';

/** The applied selection, always as an array — the two modes differ in shape. */
function appliedIds(props: CategorySelectProps): string[] {
  if (props.mode === 'single') return props.value ? [props.value] : [];
  return props.value;
}

/** True when the draft differs from what is already applied. */
function draftChanged(draft: ReadonlySet<string>, applied: readonly string[]): boolean {
  return draft.size !== applied.length || applied.some((id) => !draft.has(id));
}

/** "Pai › Filha" for a chosen id, so the trigger carries its context. */
function singleLabel(groups: CategoryGroup[], value: string | null): string | undefined {
  if (!value) return undefined;
  const asCategory = groups.find((group) => group.category.id === value);
  if (asCategory) return asCategory.category.name;
  const owner = groups.find((group) => group.subcategories.some((sub) => sub.id === value));
  const sub = owner?.subcategories.find((candidate) => candidate.id === value);
  return sub && owner ? `${owner.category.name} › ${sub.name}` : undefined;
}

/** The optional props, resolved once so the component body stays branch-free. */
interface ResolvedConfig {
  single: boolean;
  placeholder: string;
  disabled: boolean;
  loading: boolean;
  fullWidth: boolean;
  showCounts: boolean;
  allowParentSelection: boolean;
  dataTestId: string;
}

function resolveConfig(props: CategorySelectProps): ResolvedConfig {
  const single = props.mode === 'single';
  return {
    single,
    placeholder: props.placeholder ?? (single ? 'Mover para…' : 'Categoria'),
    disabled: props.disabled ?? false,
    loading: props.loading ?? false,
    fullWidth: props.fullWidth ?? false,
    showCounts: props.showCounts ?? false,
    allowParentSelection: props.allowParentSelection ?? false,
    dataTestId: props.dataTestId ?? 'category-select',
  };
}

/** Focus the search box on open, and keep the keyboard cursor in view. */
function usePanelFocus(
  open: boolean,
  activeIndex: number,
  searchInputRef: React.RefObject<HTMLInputElement | null>,
  listRef: React.RefObject<HTMLDivElement | null>,
): void {
  // The first thing an admin does with ten categories is type; focusing here
  // saves the extra click every single time the panel opens.
  useEffect(() => {
    if (!open) return undefined;
    const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, searchInputRef]);

  useEffect(() => {
    if (activeIndex < 0) return;
    const rows = listRef.current?.querySelectorAll('[role="option"], [role="button"]');
    rows?.[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, listRef]);
}

/**
 * A hierarchical category picker: categories as the frame, subcategories as the
 * thing you choose.
 *
 * Two modes off one component. `multi` is the FILTER — ticks accumulate in a
 * draft and reach `onChange` only on Apply, so the list behind the panel does not
 * reload on every click. `single` is the "move to…" picker, where choosing a row
 * commits immediately because there is nothing to batch.
 *
 * The tree opens fully expanded: nothing a search could match is hidden behind a
 * disclosure. Selected categories pin above the list so they survive scrolling
 * and searching, search is accent-insensitive (`agua` finds `Águas`), and the
 * whole tree is keyboard-drivable — ↑↓ to move, → to open, ← to close, Space to
 * mark, Enter to apply, Esc to cancel.
 *
 * Under {@link METRICS.sheetBreakpoint} the panel becomes a bottom sheet, which
 * is the only way a 290px-tall list stays usable one-handed.
 */
export function CategorySelect(props: CategorySelectProps): React.JSX.Element {
  const { options, label, error, onCreateCategory } = props;
  const {
    single,
    placeholder,
    disabled,
    loading,
    fullWidth,
    showCounts,
    allowParentSelection,
    dataTestId,
  } = resolveConfig(props);

  const theme = useTheme();
  const sheet = useMediaQuery(theme.breakpoints.down(METRICS.sheetBreakpoint));
  const applied = appliedIds(props);

  const state = useCategorySelect({ options, selected: applied });
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  usePanelFocus(state.open, state.activeIndex, searchInputRef, listRef);

  const chips = useMemo(
    () => summarizeSelection(state.allGroups, state.draft),
    [state.allGroups, state.draft],
  );
  const rowIds = useMemo(() => state.rows.map((row) => row.id), [state.rows]);

  const actions = useCategoryCommit({ props, state, single, allowParentSelection });
  const onKeyDown = useCategoryKeyHandler({ state, single, allowParentSelection, actions });

  return (
    <FormControl fullWidth={fullWidth} error={Boolean(error)}>
      {label && <FormLabel error={Boolean(error)}>{label}</FormLabel>}
      <CategoryTrigger
        placeholder={placeholder}
        selectionLabel={
          props.mode === 'single' ? singleLabel(state.allGroups, props.value) : undefined
        }
        count={single ? undefined : applied.length}
        open={state.open}
        disabled={disabled}
        fullWidth={fullWidth}
        onOpen={state.openPanel}
        onClear={applied.length > 0 ? actions.clearSelection : undefined}
        triggerRef={state.triggerRef}
        dataTestId={dataTestId}
      />
      <CategoryPanelSurface
        open={state.open}
        sheet={sheet}
        anchorEl={state.triggerRef.current}
        onClose={actions.cancel}
      >
        <CategoryPanel
          state={state}
          chips={chips}
          rowIds={rowIds}
          changed={draftChanged(state.draft, applied)}
          single={single}
          sheet={sheet}
          loading={loading}
          showCounts={showCounts}
          allowParentSelection={allowParentSelection}
          ariaLabel={label ?? placeholder}
          onKeyDown={onKeyDown}
          onActivateCategory={actions.activateCategory}
          onActivateSubcategory={actions.activateSubcategory}
          onApply={actions.commit}
          onCancel={actions.cancel}
          onCreateCategory={onCreateCategory}
          searchInputRef={searchInputRef}
          listRef={listRef}
          dataTestId={dataTestId}
        />
      </CategoryPanelSurface>
      {error && <FormMessage error dataTestId={`${dataTestId}-message`}>{error}</FormMessage>}
    </FormControl>
  );
}
