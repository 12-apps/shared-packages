import { useCallback, useMemo } from 'react';

import { isLeafCategory } from './category-tree';
import type { CategoryGroup, CategorySelectProps } from './CategorySelect.types';
import type { CategorySelectState } from './useCategorySelect';

/** The verbs a row, a footer button or a key press can invoke. */
export interface CategoryActions {
  /** Publish the draft to the caller and close (multi-select). */
  commit: () => void;
  /** Choose one id and close (single-select). */
  pick: (id: string) => void;
  /** Close without publishing, returning focus to the trigger. */
  cancel: () => void;
  /** Empty the APPLIED selection straight from the closed trigger. */
  clearSelection: () => void;
  activateCategory: (group: CategoryGroup) => void;
  activateSubcategory: (id: string) => void;
}

interface UseCategoryCommitArgs {
  props: CategorySelectProps;
  state: CategorySelectState;
  single: boolean;
  allowParentSelection: boolean;
}

/**
 * The commit semantics, which are the one thing the two modes genuinely differ
 * on: multi-select batches into a draft and publishes on Apply, single-select
 * publishes the moment a row is chosen.
 */
export function useCategoryCommit({
  props,
  state,
  single,
  allowParentSelection,
}: UseCategoryCommitArgs): CategoryActions {
  const { closePanel, triggerRef, toggleCategory, toggleSubcategory, toggleExpanded } = state;

  const closeAndRefocus = useCallback(() => {
    closePanel();
    triggerRef.current?.focus();
  }, [closePanel, triggerRef]);

  const commit = useCallback(() => {
    if (props.mode === 'single') return;
    props.onChange([...state.draft]);
    closeAndRefocus();
  }, [props, state.draft, closeAndRefocus]);

  const pick = useCallback(
    (id: string) => {
      if (props.mode !== 'single') return;
      props.onChange(id);
      closeAndRefocus();
    },
    [props, closeAndRefocus],
  );

  const clearSelection = useCallback(() => {
    if (props.mode === 'single') props.onChange(null);
    else props.onChange([]);
  }, [props]);

  // A category row means different things per mode: pick the whole category,
  // tick all its leaves, or — when it is only a heading — just fold it. A
  // CHILDLESS category is never the last of those: it is the leaf, so it acts
  // like one even in the leaf-only default.
  const activateCategory = useCallback(
    (group: CategoryGroup) => {
      const selectable = allowParentSelection || isLeafCategory(group);
      if (!selectable) {
        toggleExpanded(group.category.id);
        return;
      }
      if (single) {
        pick(group.category.id);
        return;
      }
      toggleCategory(group);
    },
    [allowParentSelection, single, pick, toggleCategory, toggleExpanded],
  );

  const activateSubcategory = useCallback(
    (id: string) => {
      if (single) pick(id);
      else toggleSubcategory(id);
    },
    [single, pick, toggleSubcategory],
  );

  return useMemo(
    () => ({
      commit,
      pick,
      cancel: closeAndRefocus,
      clearSelection,
      activateCategory,
      activateSubcategory,
    }),
    [commit, pick, closeAndRefocus, clearSelection, activateCategory, activateSubcategory],
  );
}
