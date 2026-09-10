'use client';

import type { CategorySelectCopy } from "../../../copy";
import Box from '@mui/material/Box/index.js';
import Button from '@mui/material/Button/index.js';
import Skeleton from '@mui/material/Skeleton/index.js';

import { categoryCheckState, isLeafCategory, leavesOf } from './category-tree';
import { CategorySectionHeading, CategoryTreeRow } from './CategoryRows';
import { emptySx, listSx, skeletonSx } from './CategorySelect.styles';
import type { CategoryGroup } from './CategorySelect.types';

/** The design sets these labels in sentence case, not MUI's default caps. */
const SENTENCE_CASE = { textTransform: 'none' } as const;

/** How many skeleton rows stand in for the catalogue while it loads. */
const SKELETON_ROWS = 6;

interface PanelListProps {
  /** The words this panel renders. REQUIRED — no default copy. */
  copy: CategorySelectCopy;
  groups: CategoryGroup[];
  query: string;
  draft: ReadonlySet<string>;
  rowIds: string[];
  activeIndex: number;
  sheet: boolean;
  single: boolean;
  loading: boolean;
  showCounts: boolean;
  allowParentSelection: boolean;
  /**
   * True when the tree has a level BELOW the subcategories. It turns the
   * section-heading treatment off — see {@link CategoryNodeRows}. Derived from
   * the options the panel state already holds, never a caller's decision.
   */
  deepTree: boolean;
  isExpanded: (categoryId: string) => boolean;
  onToggleExpanded: (categoryId: string) => void;
  onActivateCategory: (group: CategoryGroup) => void;
  onActivateSubcategory: (id: string) => void;
  onClearQuery: () => void;
  onCreateCategory?: (name?: string) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
  dataTestId: string;
}

function LoadingRows(): React.JSX.Element {
  return (
    <>
      {Array.from({ length: SKELETON_ROWS }, (_unused, index) => (
        <Skeleton key={index} variant="rounded" sx={skeletonSx} />
      ))}
    </>
  );
}

/** No categories exist at all — an onboarding moment, not an error. */
function EmptyCatalogue({
  onCreateCategory,
  dataTestId,
  copy,
}: {
  onCreateCategory?: (name?: string) => void;
  dataTestId: string;
  copy: CategorySelectCopy;
}): React.JSX.Element {
  return (
    <Box sx={emptySx} data-testid={`${dataTestId}-empty-catalogue`}>
      <strong>{copy.emptyTitle}</strong>
      <p>{copy.purpose}</p>
      {onCreateCategory && (
        <Button variant="contained" size="small" sx={SENTENCE_CASE} onClick={() => onCreateCategory()}>
          {copy.createCategory}
        </Button>
      )}
    </Box>
  );
}

/** The search found nothing — offer creation, or the way back. */
function NoResults({
  query,
  onClearQuery,
  onCreateCategory,
  dataTestId,
  copy,
}: {
  query: string;
  onClearQuery: () => void;
  onCreateCategory?: (name?: string) => void;
  dataTestId: string;
  copy: CategorySelectCopy;
}): React.JSX.Element {
  return (
    <Box sx={emptySx} data-testid={`${dataTestId}-no-results`}>
      <strong>{copy.noResults.title(query)}</strong>
      <p>{copy.noResults.hint}</p>
      <Box sx={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
        <Button variant="outlined" size="small" sx={SENTENCE_CASE} onClick={onClearQuery}>
          {copy.noResults.clearSearch}
        </Button>
        {onCreateCategory && (
          <Button
            variant="contained"
            size="small"
            sx={SENTENCE_CASE}
            data-testid={`${dataTestId}-create`}
            onClick={() => onCreateCategory(query.trim())}
          >
            {copy.noResults.create(query.trim())}
          </Button>
        )}
      </Box>
    </Box>
  );
}

/**
 * One node: its heading or its row, then whichever children are visible.
 *
 * The SECTION-HEADING treatment — an inert uppercase label with its children
 * always on show — belongs to a two-level tree and only there. It is what makes
 * the "mover para…" picker read as "category, then the subcategory you pick",
 * and it works because a two-level category has nothing to fold TO: everything
 * under it is already the thing you came for. A third level breaks both halves
 * at once — the heading has no chevron, so the panel opens onto every item in
 * the catalogue, which is the flat list this component exists to replace. So a
 * deep tree drops the treatment and every frame becomes a foldable row instead.
 */
function CategoryNodeRows({
  node,
  depth,
  props,
}: {
  node: CategoryGroup;
  depth: number;
  props: PanelListProps;
}): React.JSX.Element {
  const { draft, query, single, allowParentSelection, rowIds, activeIndex, sheet } = props;
  const categoryId = node.category.id;
  const leaf = isLeafCategory(node);
  const expanded = props.isExpanded(categoryId);
  // A childless category is the leaf, so it is selectable whatever the mode says
  // — the heading reading has no subcategory to point at, and would leave the
  // row inert.
  const selectable = allowParentSelection || leaf;
  const asHeading = single && !selectable && !props.deepTree;
  const selectedCount = leaf ? 0 : leavesOf(node).filter((id) => draft.has(id)).length;

  return (
    <>
      {asHeading ? (
        <CategorySectionHeading option={node.category} query={query} />
      ) : (
        <CategoryTreeRow
          option={node.category}
          query={query}
          depth={depth}
          branch={!leaf}
          expanded={expanded}
          active={rowIds[activeIndex] === categoryId}
          sheet={sheet}
          {...(selectable ? { checkState: categoryCheckState(node, draft) } : {})}
          single={single}
          selectedCount={selectedCount}
          showCounts={props.showCounts}
          onToggleExpanded={() => props.onToggleExpanded(categoryId)}
          onActivate={() =>
            leaf ? props.onActivateSubcategory(categoryId) : props.onActivateCategory(node)
          }
          dataTestId={props.dataTestId}
          copy={props.copy}
        />
      )}
      {(expanded || asHeading) &&
        node.subcategories.map((sub) => (
          <CategoryNodeRows key={sub.category.id} node={sub} depth={depth + 1} props={props} />
        ))}
    </>
  );
}

/** The scrolling body of the panel, including its three non-list states. */
export function CategoryPanelList(props: PanelListProps): React.JSX.Element {
  const { groups, loading, query, listRef, sheet, dataTestId, copy } = props;

  const body = (): React.JSX.Element => {
    if (loading) return <LoadingRows />;
    if (groups.length === 0 && query.trim().length > 0) {
      return (
        <NoResults copy={copy}
          query={query}
          onClearQuery={props.onClearQuery}
          onCreateCategory={props.onCreateCategory}
          dataTestId={dataTestId}
        />
      );
    }
    if (groups.length === 0) {
      return (
        <EmptyCatalogue copy={copy}
          onCreateCategory={props.onCreateCategory}
          dataTestId={dataTestId}
        />
      );
    }
    return (
      <>
        {groups.map((group) => (
          <CategoryNodeRows key={group.category.id} node={group} depth={0} props={props} />
        ))}
      </>
    );
  };

  return (
    <Box
      ref={listRef}
      role="listbox"
      aria-multiselectable={props.single ? undefined : true}
      tabIndex={-1}
      data-testid={`${dataTestId}-list`}
      sx={listSx(sheet)}
    >
      {body()}
    </Box>
  );
}
