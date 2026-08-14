import { describe, expect, it } from 'vitest';

import {
  buildCategoryGroups,
  categoryCheckState,
  collectLeafIds,
  filterCategoryGroups,
  flattenRows,
  foldText,
  highlightSegments,
  leavesOf,
  removeChip,
  summarizeSelection,
  toggleCategoryLeaves,
  toggleLeaf,
} from '../category-tree';
import type { CategorySelectOption } from '../CategorySelect.types';

const OPTIONS: CategorySelectOption[] = [
  { id: 'beb', name: 'Bebidas' },
  { id: 'beb.agua', name: 'Águas', parentId: 'beb' },
  { id: 'beb.refri', name: 'Refrigerantes', parentId: 'beb' },
  { id: 'merc', name: 'Mercearia' },
  { id: 'merc.massa', name: 'Massas', parentId: 'merc' },
  { id: 'combo', name: 'Combos' },
];

/** Built fresh per test, so no test can observe another test's tree. */
const makeGroups = (): ReturnType<typeof buildCategoryGroups> =>
  buildCategoryGroups(OPTIONS);

describe('buildCategoryGroups', () => {
  it('nests children under their parent, preserving input order', () => {
    expect(makeGroups().map((group) => group.category.id)).toEqual(['beb', 'merc', 'combo']);
    expect(makeGroups()[0]?.subcategories.map((sub) => sub.id)).toEqual(['beb.agua', 'beb.refri']);
  });

  it('keeps a childless category as its own group', () => {
    expect(makeGroups()[2]?.subcategories).toEqual([]);
  });

  it('promotes an orphan rather than dropping it', () => {
    // A payload where the parent was filtered out must not swallow the child.
    const orphaned = buildCategoryGroups([{ id: 'x', name: 'Órfã', parentId: 'missing' }]);
    expect(orphaned).toHaveLength(1);
    expect(orphaned[0]?.category.id).toBe('x');
  });
});

describe('leaf helpers', () => {
  it('treats a childless category as its own leaf', () => {
    expect(leavesOf(makeGroups()[2]!)).toEqual(['combo']);
  });

  it('collects every selectable leaf', () => {
    expect(collectLeafIds(makeGroups())).toEqual(['beb.agua', 'beb.refri', 'merc.massa', 'combo']);
  });
});

describe('categoryCheckState', () => {
  it.each([
    [[], 'off'],
    [['beb.agua'], 'partial'],
    [['beb.agua', 'beb.refri'], 'on'],
  ])('reports %j as %s', (selected, expected) => {
    expect(categoryCheckState(makeGroups()[0]!, new Set(selected as string[]))).toBe(expected);
  });
});

describe('toggling', () => {
  it('selects all of a category when partly selected', () => {
    const next = toggleCategoryLeaves(makeGroups()[0]!, new Set(['beb.agua']));
    expect([...next].sort()).toEqual(['beb.agua', 'beb.refri']);
  });

  it('clears a category that is already complete', () => {
    const next = toggleCategoryLeaves(makeGroups()[0]!, new Set(['beb.agua', 'beb.refri']));
    expect([...next]).toEqual([]);
  });

  it('flips a single leaf both ways', () => {
    expect([...toggleLeaf('beb.agua', new Set())]).toEqual(['beb.agua']);
    expect([...toggleLeaf('beb.agua', new Set(['beb.agua']))]).toEqual([]);
  });

  it('does not mutate the set it was given', () => {
    const original = new Set(['beb.agua']);
    toggleLeaf('beb.refri', original);
    expect([...original]).toEqual(['beb.agua']);
  });
});

describe('summarizeSelection', () => {
  it('collapses a fully selected category into one chip', () => {
    const chips = summarizeSelection(makeGroups(), new Set(['beb.agua', 'beb.refri']));
    expect(chips).toEqual([{ id: 'beb', label: 'Bebidas', whole: true }]);
  });

  it('lists individual leaves when the category is partial', () => {
    const chips = summarizeSelection(makeGroups(), new Set(['beb.agua']));
    expect(chips).toEqual([{ id: 'beb.agua', label: 'Águas', whole: false }]);
  });

  it('omits categories with nothing selected', () => {
    expect(summarizeSelection(makeGroups(), new Set())).toEqual([]);
  });
});

describe('removeChip', () => {
  it('drops every leaf of a whole-category chip', () => {
    const next = removeChip(makeGroups(), 'beb', new Set(['beb.agua', 'beb.refri', 'merc.massa']));
    expect([...next]).toEqual(['merc.massa']);
  });

  it('drops just the one leaf otherwise', () => {
    const next = removeChip(makeGroups(), 'beb.agua', new Set(['beb.agua', 'beb.refri']));
    expect([...next]).toEqual(['beb.refri']);
  });
});

describe('foldText', () => {
  it.each([
    ['Águas', 'aguas'],
    ['Grãos e farináceos', 'graos e farinaceos'],
    ['CÁPSULAS', 'capsulas'],
  ])('folds %s to %s', (input, expected) => {
    expect(foldText(input)).toBe(expected);
  });
});

describe('filterCategoryGroups', () => {
  it('returns everything for an empty query', () => {
    expect(filterCategoryGroups(makeGroups(), '   ')).toHaveLength(3);
  });

  it('matches a subcategory without its accents and keeps its parent', () => {
    const found = filterCategoryGroups(makeGroups(), 'agua');
    expect(found).toHaveLength(1);
    expect(found[0]?.category.id).toBe('beb');
    expect(found[0]?.subcategories.map((sub) => sub.id)).toEqual(['beb.agua']);
  });

  it('keeps every child when the category itself matches', () => {
    const found = filterCategoryGroups(makeGroups(), 'bebidas');
    expect(found[0]?.subcategories).toHaveLength(2);
  });

  it('returns nothing when there is no hit', () => {
    expect(filterCategoryGroups(makeGroups(), 'tapioca')).toEqual([]);
  });
});

describe('highlightSegments', () => {
  it('marks the matching run and keeps the original accents', () => {
    expect(highlightSegments('Águas', 'agua')).toEqual([
      { text: 'Água', match: true },
      { text: 's', match: false },
    ]);
  });

  it('returns one unmatched segment when nothing matches', () => {
    expect(highlightSegments('Sucos', 'zzz')).toEqual([{ text: 'Sucos', match: false }]);
  });

  it('drops empty leading/trailing segments', () => {
    expect(highlightSegments('Sucos', 'sucos')).toEqual([{ text: 'Sucos', match: true }]);
  });
});

describe('flattenRows', () => {
  it('lists only the children of expanded categories', () => {
    const rows = flattenRows(makeGroups(), (id) => id === 'beb');
    expect(rows.map((row) => row.id)).toEqual(['beb', 'beb.agua', 'beb.refri', 'merc', 'combo']);
  });

  it('tags a subcategory with the parent ArrowLeft should jump to', () => {
    const rows = flattenRows(makeGroups(), () => true);
    expect(rows.find((row) => row.id === 'beb.agua')?.parentId).toBe('beb');
  });
});
