'use client';

import Box from '@mui/material/Box/index.js';

import type { CategorySelectCopy } from '../../../copy';
import { CheckGlyph, DisclosureGlyph } from './CategoryIcons';
import { highlightSegments, type CategoryCheckState } from './category-tree';
import {
  checkboxBarSx,
  checkboxSx,
  chevronButtonSx,
  markSx,
  METRICS,
  radioSx,
  rowIndent,
  rowMetaSx,
  rowNameSx,
  rowSx,
  sectionHeadSx,
} from './CategorySelect.styles';
import type { CategorySelectOption } from './CategorySelect.types';

/** A label with the search hit marked. */
export function HighlightedName({
  text,
  query,
}: {
  text: string;
  query: string;
}): React.JSX.Element {
  const segments = highlightSegments(text, query);
  return (
    <>
      {segments.map((segment, index) =>
        segment.match ? (
          <Box component="mark" key={`${segment.text}-${index}`} sx={markSx}>
            {segment.text}
          </Box>
        ) : (
          <span key={`${segment.text}-${index}`}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/** Tri-state checkbox. `partial` draws the bar the prototype uses for "some". */
export function CategoryCheckbox({ state }: { state: CategoryCheckState }): React.JSX.Element {
  return (
    <Box sx={(theme) => checkboxSx(theme, state)} aria-hidden="true">
      {state === 'on' && <CheckGlyph />}
      {state === 'partial' && <Box sx={checkboxBarSx} />}
    </Box>
  );
}

export function CategoryRadio({ on }: { on: boolean }): React.JSX.Element {
  return <Box sx={(theme) => radioSx(theme, on)} aria-hidden="true" />;
}

interface CategoryTreeRowProps {
  option: CategorySelectOption;
  query: string;
  /** 0 for a top-level category; each level below indents one more step. */
  depth: number;
  /** True when there is something under this row to fold. */
  branch: boolean;
  expanded: boolean;
  active: boolean;
  sheet: boolean;
  /** Absent where the row cannot be picked — a category acting as a frame. */
  checkState?: CategoryCheckState;
  /** Single-select draws a radio for the control: choosing a row is exclusive. */
  single: boolean;
  selectedCount: number;
  showCounts: boolean;
  onToggleExpanded: () => void;
  onActivate: () => void;
  dataTestId: string;
  copy: CategorySelectCopy;
}

/** The trailing number: how many leaves are picked below, else the item count. */
function rowMeta(
  selectedCount: number,
  showCounts: boolean,
  count: number | undefined,
): { text: string; selected: boolean } | null {
  if (selectedCount > 0) return { text: String(selectedCount), selected: true };
  if (showCounts && count !== undefined) return { text: String(count), selected: false };
  return null;
}

/** The disclosure chevron, or the space it would have taken on a leaf row. */
function RowDisclosure({
  option,
  expanded,
  branch,
  onToggleExpanded,
  dataTestId,
  copy,
}: Pick<
  CategoryTreeRowProps,
  'option' | 'expanded' | 'branch' | 'onToggleExpanded' | 'dataTestId' | 'copy'
>): React.JSX.Element {
  if (!branch) {
    return <Box sx={{ width: METRICS.chevronButton, flex: '0 0 auto' }} />;
  }
  return (
    <Box
      component="button"
      type="button"
      tabIndex={-1}
      aria-label={expanded ? copy.collapseCategory(option.name) : copy.expandCategory(option.name)}
      data-testid={`${dataTestId}-expand-${option.id}`}
      sx={(theme) => chevronButtonSx(theme, expanded)}
      onClick={(event: React.MouseEvent) => {
        event.stopPropagation();
        onToggleExpanded();
      }}
    >
      <DisclosureGlyph />
    </Box>
  );
}

/** The row's selection control, or the space it would have taken on a frame. */
function RowControl({
  checkState,
  single,
}: Pick<CategoryTreeRowProps, 'checkState' | 'single'>): React.JSX.Element {
  if (!checkState) return <Box sx={{ width: METRICS.boxSize, flex: '0 0 auto' }} />;
  // Single-select commits the moment a row is chosen, so the control is a radio
  // there: a checkbox would promise the accumulation this mode does not do.
  if (single) return <CategoryRadio on={checkState === 'on'} />;
  return <CategoryCheckbox state={checkState} />;
}

/**
 * The test id a row answers to.
 *
 * Keyed on DEPTH rather than on whether the row has children, because that is
 * what the ids meant when the tree was two levels and specs were written against
 * them: `-category-<id>` is a top-level row — childless or not — and `-option-`
 * is anything filed under one.
 */
function rowTestId(dataTestId: string, depth: number, id: string): string {
  return depth === 0 ? `${dataTestId}-category-${id}` : `${dataTestId}-option-${id}`;
}

/**
 * One row of the tree: disclosure chevron, optional control, name, meta.
 *
 * The chevron is its OWN button inside the row — clicking it only folds, while
 * clicking the row does the row's job (expand as a frame, or mark when the row
 * is selectable). A LEAF has neither a fold nor a frame to be: it draws no
 * chevron, and it always carries the control, because it is what you pick.
 */
export function CategoryTreeRow({
  option,
  query,
  depth,
  branch,
  expanded,
  active,
  sheet,
  checkState,
  single,
  selectedCount,
  showCounts,
  onToggleExpanded,
  onActivate,
  dataTestId,
  copy,
}: CategoryTreeRowProps): React.JSX.Element {
  const meta = rowMeta(selectedCount, showCounts, option.count);
  return (
    <Box
      component="div"
      role={checkState ? 'option' : 'button'}
      aria-selected={checkState ? checkState === 'on' : undefined}
      aria-expanded={branch ? expanded : undefined}
      data-testid={rowTestId(dataTestId, depth, option.id)}
      sx={(theme) => ({ ...rowSx(theme, active, sheet), ...rowIndent(depth) })}
      onClick={onActivate}
    >
      <RowDisclosure
        option={option}
        expanded={expanded}
        branch={branch}
        onToggleExpanded={onToggleExpanded}
        dataTestId={dataTestId}
        copy={copy}
      />
      <RowControl checkState={checkState} single={single} />
      <Box component="span" sx={(theme) => rowNameSx(theme, depth === 0)}>
        <HighlightedName text={option.name} query={query} />
      </Box>
      {meta && (
        <Box component="span" sx={(theme) => rowMetaSx(theme, meta.selected)}>
          {meta.text}
        </Box>
      )}
    </Box>
  );
}

/** The category as a non-interactive heading (single-select, leaf-only). */
export function CategorySectionHeading({
  option,
  query,
}: {
  option: CategorySelectOption;
  query: string;
}): React.JSX.Element {
  return (
    <Box sx={sectionHeadSx}>
      <HighlightedName text={option.name} query={query} />
    </Box>
  );
}
