import { describe, expect, it } from 'vitest';

import {
  buildCategoryGroups,
  categoryCheckState,
  categoryPath,
  collectBranchIds,
  collectLeafIds,
  filterCategoryGroups,
  findGroup,
  flattenRows,
  isLeafCategory,
  foldText,
  highlightSegments,
  leavesOf,
  removeChip,
  summarizeSelection,
  toggleCategoryLeaves,
  toggleLeaf,
  treeDepth,
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
    expect(makeGroups()[0]?.subcategories.map((sub) => sub.category.id)).toEqual([
      'beb.agua',
      'beb.refri',
    ]);
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
    expect(found[0]?.subcategories.map((sub) => sub.category.id)).toEqual(['beb.agua']);
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

describe('isLeafCategory', () => {
  it('is the one thing the leaf reading turns on', () => {
    expect(makeGroups().map(isLeafCategory)).toEqual([false, false, true]);
  });

  it('agrees with what the category stands for', () => {
    const groups = makeGroups();
    groups.forEach((group) => {
      expect(leavesOf(group)).toEqual(
        isLeafCategory(group)
          ? [group.category.id]
          : group.subcategories.map((sub) => sub.category.id),
      );
    });
  });
});

/**
 * The third storey: ITEMS filed under a subcategory.
 *
 * The tree used to stop at two levels — anything deeper was promoted to top
 * level as an orphan, which put every product next to the categories instead of
 * inside one. These describe the level below the subcategories: it nests, it
 * folds, it searches, and a category still stands for the leaves at the BOTTOM
 * of it rather than for the subcategories in between.
 */
describe('a tree deeper than two levels', () => {
  const DEEP: CategorySelectOption[] = [
    { id: 'beb', name: 'Bebidas' },
    { id: 'beb.refri', name: 'Refrigerantes', parentId: 'beb' },
    { id: 'p.coca', name: 'Coca-Cola', parentId: 'beb.refri' },
    { id: 'p.guarana', name: 'Guaraná', parentId: 'beb.refri' },
    { id: 'sem', name: 'Sem categoria' },
    { id: 'p.gelo', name: 'Gelo', parentId: 'sem' },
  ];
  const deepGroups = (): ReturnType<typeof buildCategoryGroups> => buildCategoryGroups(DEEP);

  it('nests the item under its subcategory instead of promoting it', () => {
    const [bebidas] = deepGroups();
    expect(bebidas?.subcategories.map((sub) => sub.category.id)).toEqual(['beb.refri']);
    expect(bebidas?.subcategories[0]?.subcategories.map((sub) => sub.category.id)).toEqual([
      'p.coca',
      'p.guarana',
    ]);
  });

  it('keeps the top level in the order it was given, uncategorised last', () => {
    expect(deepGroups().map((group) => group.category.id)).toEqual(['beb', 'sem']);
  });

  it('makes a category stand for the items at the bottom, not the subcategory', () => {
    expect(leavesOf(deepGroups()[0]!)).toEqual(['p.coca', 'p.guarana']);
    expect(collectLeafIds(deepGroups())).toEqual(['p.coca', 'p.guarana', 'p.gelo']);
  });

  it('counts every foldable node, at every depth', () => {
    expect(collectBranchIds(deepGroups())).toEqual(['beb', 'beb.refri', 'sem']);
    expect(treeDepth(deepGroups())).toBe(3);
  });

  it('reports a two-level tree as two, so the flat case can tell itself apart', () => {
    expect(treeDepth(makeGroups())).toBe(2);
  });

  it('finds a node at any depth, and reads back the path to it', () => {
    expect(findGroup(deepGroups(), 'p.coca')?.category.name).toBe('Coca-Cola');
    expect(categoryPath(deepGroups(), 'p.coca')).toEqual([
      'Bebidas',
      'Refrigerantes',
      'Coca-Cola',
    ]);
    expect(categoryPath(deepGroups(), 'nope')).toBeNull();
  });

  it('hides an item behind its subcategory until that is unfolded too', () => {
    const topOnly = flattenRows(deepGroups(), (id) => id === 'beb');
    expect(topOnly.map((row) => row.id)).toEqual(['beb', 'beb.refri', 'sem']);

    const all = flattenRows(deepGroups(), () => true);
    expect(all.map((row) => row.id)).toEqual([
      'beb',
      'beb.refri',
      'p.coca',
      'p.guarana',
      'sem',
      'p.gelo',
    ]);
    expect(all.find((row) => row.id === 'p.coca')).toEqual({
      id: 'p.coca',
      depth: 2,
      branch: false,
      parentId: 'beb.refri',
    });
  });

  it('keeps a matched item under both of its parents', () => {
    const found = filterCategoryGroups(deepGroups(), 'guarana');
    expect(found.map((group) => group.category.id)).toEqual(['beb']);
    expect(found[0]?.subcategories[0]?.subcategories.map((sub) => sub.category.id)).toEqual([
      'p.guarana',
    ]);
  });

  it('chips the DEEPEST node that is completely selected', () => {
    expect(summarizeSelection(deepGroups(), new Set(['p.coca']))).toEqual([
      { id: 'p.coca', label: 'Coca-Cola', whole: false },
    ]);
    expect(summarizeSelection(deepGroups(), new Set(['p.coca', 'p.guarana']))).toEqual([
      { id: 'beb', label: 'Bebidas', whole: true },
    ]);
  });

  it('removes every item under a chip naming a category', () => {
    const next = removeChip(deepGroups(), 'beb', new Set(['p.coca', 'p.guarana', 'p.gelo']));
    expect([...next]).toEqual(['p.gelo']);
  });

  it('promotes a node on a parent ring rather than looping forever', () => {
    // A payload naming two rows as each other's parent used to be impossible:
    // a child was attached to a ROOT or promoted, so nothing could point back
    // down. Attaching at any depth makes it expressible, and a ring would be
    // walked until the stack gave out.
    const ringed = buildCategoryGroups([
      { id: 'a', name: 'A', parentId: 'b' },
      { id: 'b', name: 'B', parentId: 'a' },
    ]);
    expect(ringed.map((group) => group.category.id)).toEqual(['a', 'b']);
    expect(ringed.every((group) => group.subcategories.length === 0)).toBe(true);
  });

  it('keeps the first row of a duplicated id, and places it once', () => {
    const doubled = buildCategoryGroups([
      { id: 'beb', name: 'Bebidas' },
      { id: 'beb', name: 'Bebidas (again)' },
    ]);
    expect(doubled).toHaveLength(1);
    expect(doubled[0]?.category.name).toBe('Bebidas');
  });
});
