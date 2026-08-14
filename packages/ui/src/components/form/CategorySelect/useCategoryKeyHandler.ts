import { useCallback } from 'react';

import { handleCategoryKeyDown } from './category-keyboard';
import type { CategoryActions } from './useCategoryCommit';
import type { CategorySelectState } from './useCategorySelect';

interface UseCategoryKeyHandlerArgs {
  state: CategorySelectState;
  single: boolean;
  allowParentSelection: boolean;
  actions: CategoryActions;
}

/**
 * Bind the panel's keydown to the tree navigator.
 *
 * `preventDefault` fires only for keys the navigator actually consumed, so an
 * unhandled key still reaches the search box — otherwise typing would be dead.
 */
export function useCategoryKeyHandler({
  state,
  single,
  allowParentSelection,
  actions,
}: UseCategoryKeyHandlerArgs): (event: React.KeyboardEvent) => void {
  const { isExpanded, toggleExpanded } = state;

  const expand = useCallback(
    (id: string) => {
      if (!isExpanded(id)) toggleExpanded(id);
    },
    [isExpanded, toggleExpanded],
  );

  const collapse = useCallback(
    (id: string) => {
      if (isExpanded(id)) toggleExpanded(id);
    },
    [isExpanded, toggleExpanded],
  );

  return useCallback(
    (event: React.KeyboardEvent) => {
      const inSearchField = (event.target as HTMLElement | null)?.tagName === 'INPUT';
      const editingText = inSearchField && state.query.length > 0;
      const consumed = handleCategoryKeyDown(event.key, editingText, {
        rows: state.rows,
        activeIndex: state.activeIndex,
        groups: state.visibleGroups,
        single,
        allowParentSelection,
        setActiveIndex: state.setActiveIndex,
        toggleExpanded,
        expand,
        collapse,
        toggleCategory: state.toggleCategory,
        toggleSubcategory: state.toggleSubcategory,
        commit: actions.commit,
        cancel: actions.cancel,
        pick: actions.pick,
      });
      if (consumed) event.preventDefault();
    },
    [state, single, allowParentSelection, toggleExpanded, expand, collapse, actions],
  );
}
