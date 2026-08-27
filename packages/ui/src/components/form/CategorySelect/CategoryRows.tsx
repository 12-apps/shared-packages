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

interface CategoryHeadRowProps {
  option: CategorySelectOption;
  query: string;
  expanded: boolean;
  active: boolean;
  sheet: boolean;
  /** Absent in leaf-only mode, where the category is a heading with no checkbox. */
  checkState?: CategoryCheckState;
  /** Single-select draws a radio for the control: choosing a row is exclusive. */
  single: boolean;
  /** False for a childless category — there is nothing under it to disclose. */
  expandable: boolean;
  selectedCount: number;
  showCounts: boolean;
  onToggleExpanded: () => void;
  onActivate: () => void;
  dataTestId: string;
  copy: CategorySelectCopy;
}

/** The trailing number: how many children are picked, else the item count. */
function rowMeta(
  selectedCount: number,
  showCounts: boolean,
  count: number | undefined,
): { text: string; selected: boolean } | null {
  if (selectedCount > 0) return { text: String(selectedCount), selected: true };
  if (showCounts && count !== undefined) return { text: String(count), selected: false };
  return null;
}

/** The disclosure chevron, or the space it would have taken on a childless row. */
function HeadRowDisclosure({
  option,
  expanded,
  expandable,
  onToggleExpanded,
  dataTestId,
  copy,
}: Pick<
  CategoryHeadRowProps,
  'option' | 'expanded' | 'expandable' | 'onToggleExpanded' | 'dataTestId' | 'copy'
>): React.JSX.Element {
  if (!expandable) {
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

/** The row's selection control, or the space it would have taken on a heading. */
function HeadRowControl({
  checkState,
  single,
}: Pick<CategoryHeadRowProps, 'checkState' | 'single'>): React.JSX.Element {
  if (!checkState) return <Box sx={{ width: METRICS.boxSize, flex: '0 0 auto' }} />;
  // Single-select commits the moment a row is chosen, so the control is a radio
  // there: a checkbox would promise the accumulation this mode does not do.
  if (single) return <CategoryRadio on={checkState === 'on'} />;
  return <CategoryCheckbox state={checkState} />;
}

/**
 * A top-level category row: disclosure chevron, optional checkbox, name, meta.
 *
 * The chevron is its OWN button inside the row button — clicking it only folds,
 * while clicking the row does the row's job (expand as a heading, or tick when
 * the category is selectable). A CHILDLESS category has neither a fold nor a
 * heading to be: it draws no chevron, and it carries the control, because it is
 * itself the leaf.
 */
export function CategoryHeadRow({
  option,
  query,
  expanded,
  active,
  sheet,
  checkState,
  single,
  expandable,
  selectedCount,
  showCounts,
  onToggleExpanded,
  onActivate,
  dataTestId,
  copy,
}: CategoryHeadRowProps): React.JSX.Element {
  const meta = rowMeta(selectedCount, showCounts, option.count);
  return (
    <Box
      component="div"
      role={checkState ? 'option' : 'button'}
      aria-selected={checkState ? checkState === 'on' : undefined}
      aria-expanded={expandable ? expanded : undefined}
      data-testid={`${dataTestId}-category-${option.id}`}
      sx={(theme) => rowSx(theme, active, sheet)}
      onClick={onActivate}
    >
      <HeadRowDisclosure
        option={option}
        expanded={expanded}
        expandable={expandable}
        onToggleExpanded={onToggleExpanded}
        dataTestId={dataTestId}
        copy={copy}
      />
      <HeadRowControl checkState={checkState} single={single} />
      <Box component="span" sx={(theme) => rowNameSx(theme, true)}>
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

interface SubcategoryRowProps {
  option: CategorySelectOption;
  query: string;
  selected: boolean;
  active: boolean;
  sheet: boolean;
  /** Single-select mode draws a radio; multi-select draws a checkbox. */
  single: boolean;
  showCounts: boolean;
  onActivate: () => void;
  dataTestId: string;
}

export function SubcategoryRow({
  option,
  query,
  selected,
  active,
  sheet,
  single,
  showCounts,
  onActivate,
  dataTestId,
}: SubcategoryRowProps): React.JSX.Element {
  return (
    <Box
      component="div"
      role="option"
      aria-selected={selected}
      data-testid={`${dataTestId}-option-${option.id}`}
      sx={(theme) => ({ ...rowSx(theme, active, sheet), paddingLeft: '14px' })}
      onClick={onActivate}
    >
      <Box sx={{ width: METRICS.chevronButton, flex: '0 0 auto' }} />
      {single ? (
        <CategoryRadio on={selected} />
      ) : (
        <CategoryCheckbox state={selected ? 'on' : 'off'} />
      )}
      <Box component="span" sx={(theme) => rowNameSx(theme, false)}>
        <HighlightedName text={option.name} query={query} />
      </Box>
      {showCounts && option.count !== undefined && (
        <Box component="span" sx={(theme) => rowMetaSx(theme, false)}>
          {option.count}
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
