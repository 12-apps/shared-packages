'use client';

import { Box, Button, Skeleton } from '@mui/material';

import { categoryCheckState } from './category-tree';
import {
  CategoryHeadRow,
  CategorySectionHeading,
  SubcategoryRow,
} from './CategoryRows';
import { emptySx, listSx, skeletonSx } from './CategorySelect.styles';
import type { CategoryGroup } from './CategorySelect.types';

/** The design sets these labels in sentence case, not MUI's default caps. */
const SENTENCE_CASE = { textTransform: 'none' } as const;

/** How many skeleton rows stand in for the catalogue while it loads. */
const SKELETON_ROWS = 6;

interface PanelListProps {
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
}: {
  onCreateCategory?: (name?: string) => void;
  dataTestId: string;
}): React.JSX.Element {
  return (
    <Box sx={emptySx} data-testid={`${dataTestId}-empty-catalogue`}>
      <strong>Nenhuma categoria ainda</strong>
      <p>Categorias organizam o cardápio e os filtros da loja.</p>
      {onCreateCategory && (
        <Button variant="contained" size="small" sx={SENTENCE_CASE} onClick={() => onCreateCategory()}>
          Criar categoria
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
}: {
  query: string;
  onClearQuery: () => void;
  onCreateCategory?: (name?: string) => void;
  dataTestId: string;
}): React.JSX.Element {
  return (
    <Box sx={emptySx} data-testid={`${dataTestId}-no-results`}>
      <strong>Nada encontrado para “{query}”</strong>
      <p>Tente outro termo ou verifique a grafia.</p>
      <Box sx={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
        <Button variant="outlined" size="small" sx={SENTENCE_CASE} onClick={onClearQuery}>
          Limpar busca
        </Button>
        {onCreateCategory && (
          <Button
            variant="contained"
            size="small"
            sx={SENTENCE_CASE}
            data-testid={`${dataTestId}-create`}
            onClick={() => onCreateCategory(query.trim())}
          >
            Criar “{query.trim()}”
          </Button>
        )}
      </Box>
    </Box>
  );
}

/** One group: its heading or head row, then whichever children are visible. */
function CategoryGroupRows({
  group,
  props,
}: {
  group: CategoryGroup;
  props: PanelListProps;
}): React.JSX.Element {
  const { draft, query, single, allowParentSelection, rowIds, activeIndex, sheet } = props;
  const categoryId = group.category.id;
  const expanded = props.isExpanded(categoryId);
  const asHeading = single && !allowParentSelection;
  const selectedCount = group.subcategories.filter((sub) => draft.has(sub.id)).length;

  return (
    <>
      {asHeading ? (
        <CategorySectionHeading option={group.category} query={query} />
      ) : (
        <CategoryHeadRow
          option={group.category}
          query={query}
          expanded={expanded}
          active={rowIds[activeIndex] === categoryId}
          sheet={sheet}
          checkState={
            allowParentSelection ? categoryCheckState(group, draft) : undefined
          }
          selectedCount={selectedCount}
          showCounts={props.showCounts}
          onToggleExpanded={() => props.onToggleExpanded(categoryId)}
          onActivate={() => props.onActivateCategory(group)}
          dataTestId={props.dataTestId}
        />
      )}
      {(expanded || asHeading) &&
        group.subcategories.map((sub) => (
          <SubcategoryRow
            key={sub.id}
            option={sub}
            query={query}
            selected={draft.has(sub.id)}
            active={rowIds[activeIndex] === sub.id}
            sheet={sheet}
            single={single}
            showCounts={props.showCounts}
            onActivate={() => props.onActivateSubcategory(sub.id)}
            dataTestId={props.dataTestId}
          />
        ))}
    </>
  );
}

/** The scrolling body of the panel, including its three non-list states. */
export function CategoryPanelList(props: PanelListProps): React.JSX.Element {
  const { groups, loading, query, listRef, sheet, dataTestId } = props;

  const body = (): React.JSX.Element => {
    if (loading) return <LoadingRows />;
    if (groups.length === 0 && query.trim().length > 0) {
      return (
        <NoResults
          query={query}
          onClearQuery={props.onClearQuery}
          onCreateCategory={props.onCreateCategory}
          dataTestId={dataTestId}
        />
      );
    }
    if (groups.length === 0) {
      return (
        <EmptyCatalogue
          onCreateCategory={props.onCreateCategory}
          dataTestId={dataTestId}
        />
      );
    }
    return (
      <>
        {groups.map((group) => (
          <CategoryGroupRows key={group.category.id} group={group} props={props} />
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
