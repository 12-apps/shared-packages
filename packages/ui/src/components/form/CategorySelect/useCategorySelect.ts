import { useCallback, useMemo, useRef, useState } from 'react';

import {
  buildCategoryGroups,
  collectBranchIds,
  filterCategoryGroups,
  flattenRows,
  toggleCategoryLeaves,
  toggleLeaf,
  treeDepth,
  type CategoryRowRef,
} from './category-tree';
import type { CategoryGroup, CategorySelectOption } from './CategorySelect.types';

/** Which categories are unfolded, and the ways that set changes. */
interface ExpansionState {
  isExpanded: (categoryId: string) => boolean;
  toggleExpanded: (categoryId: string) => void;
  setAllExpanded: (expanded: boolean) => void;
  expandAll: (groups: CategoryGroup[]) => void;
}

/**
 * The expanded set.
 *
 * `searching` short-circuits the lookup instead of mutating the set: a query must
 * reveal every hit, but clearing it has to restore whatever the admin had folded,
 * which an overwrite would have destroyed.
 */
function useExpandedCategories(
  allGroups: CategoryGroup[],
  searching: boolean,
): ExpansionState {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());

  const isExpanded = useCallback(
    (categoryId: string) => searching || expanded.has(categoryId),
    [searching, expanded],
  );

  const toggleExpanded = useCallback((categoryId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(categoryId)) next.add(categoryId);
      return next;
    });
  }, []);

  // Every foldable node at EVERY depth, so "Expandir tudo" opens the tree rather
  // than only its first storey.
  const setAllExpanded = useCallback(
    (shouldExpand: boolean) => {
      setExpanded(shouldExpand ? new Set(collectBranchIds(allGroups)) : new Set());
    },
    [allGroups],
  );

  // Opening unfolds the TOP level only. On a two-level tree that is the whole
  // thing on show, which is what the panel has always done; on a deeper one it
  // is the categories and their subcategories, with the items behind one more
  // click — the alternative being the flat list the tree replaces. A search
  // still reveals every hit: `searching` short-circuits the lookup above.
  const expandAll = useCallback((groups: CategoryGroup[]) => {
    setExpanded(new Set(groups.map((group) => group.category.id)));
  }, []);

  return { isExpanded, toggleExpanded, setAllExpanded, expandAll };
}

/** The pending selection and the two ways a row changes it. */
interface DraftState {
  draft: ReadonlySet<string>;
  setDraft: (next: ReadonlySet<string>) => void;
  toggleCategory: (group: CategoryGroup) => void;
  toggleSubcategory: (id: string) => void;
}

function useDraftSelection(initial: readonly string[]): DraftState {
  const [draft, setDraftState] = useState<ReadonlySet<string>>(() => new Set(initial));

  const toggleCategory = useCallback((group: CategoryGroup) => {
    setDraftState((current) => toggleCategoryLeaves(group, current));
  }, []);

  const toggleSubcategory = useCallback((id: string) => {
    setDraftState((current) => toggleLeaf(id, current));
  }, []);

  const setDraft = useCallback((next: ReadonlySet<string>) => setDraftState(next), []);

  return { draft, setDraft, toggleCategory, toggleSubcategory };
}

/** Everything the panel and trigger need to render and drive one select. */
export interface CategorySelectState extends ExpansionState, DraftState {
  open: boolean;
  query: string;
  /** Groups after the search filter — what is actually on screen. */
  visibleGroups: CategoryGroup[];
  /** All groups, unfiltered — the basis for chips and "select all". */
  allGroups: CategoryGroup[];
  /** True when the tree runs deeper than category/subcategory. */
  deepTree: boolean;
  rows: CategoryRowRef[];
  activeIndex: number;
  setQuery: (next: string) => void;
  setActiveIndex: (next: number) => void;
  openPanel: () => void;
  closePanel: () => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

interface UseCategorySelectArgs {
  options: CategorySelectOption[];
  /** The applied selection to seed the draft from each time the panel opens. */
  selected: readonly string[];
}

/**
 * Panel state for one CategorySelect.
 *
 * The DRAFT is the load-bearing idea. Ticks land here, not on the caller's
 * `value`, so the list behind the panel does not refetch on every click; Apply
 * publishes, dismissing discards. Opening re-seeds the draft from the applied
 * value, which is what makes "cancel" mean cancel.
 */
export function useCategorySelect({
  options,
  selected,
}: UseCategorySelectArgs): CategorySelectState {
  const [open, setOpen] = useState(false);
  const [query, setQueryState] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const allGroups = useMemo(() => buildCategoryGroups(options), [options]);
  const visibleGroups = useMemo(
    () => filterCategoryGroups(allGroups, query),
    [allGroups, query],
  );

  const deepTree = useMemo(() => treeDepth(allGroups) > 2, [allGroups]);

  const expansion = useExpandedCategories(allGroups, query.trim().length > 0);
  const selection = useDraftSelection(selected);
  const rows = useMemo(
    () => flattenRows(visibleGroups, expansion.isExpanded),
    [visibleGroups, expansion.isExpanded],
  );

  const openPanel = useCallback(() => {
    selection.setDraft(new Set(selected));
    expansion.expandAll(allGroups);
    setQueryState('');
    setActiveIndex(-1);
    setOpen(true);
  }, [selected, allGroups, selection, expansion]);

  const closePanel = useCallback(() => {
    setOpen(false);
    setQueryState('');
    setActiveIndex(-1);
  }, []);

  const setQuery = useCallback((next: string) => {
    setQueryState(next);
    setActiveIndex(-1);
  }, []);

  return {
    ...expansion,
    ...selection,
    open,
    query,
    visibleGroups,
    allGroups,
    deepTree,
    rows,
    activeIndex,
    setQuery,
    setActiveIndex,
    openPanel,
    closePanel,
    triggerRef,
  };
}
