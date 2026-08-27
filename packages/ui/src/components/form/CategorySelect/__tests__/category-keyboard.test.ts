import { describe, expect, it, vi } from 'vitest';

import { handleCategoryKeyDown, type CategoryKeyContext } from '../category-keyboard';
import { buildCategoryGroups } from '../category-tree';
import type { CategorySelectOption } from '../CategorySelect.types';

const OPTIONS: CategorySelectOption[] = [
  { id: 'beb', name: 'Bebidas' },
  { id: 'beb.agua', name: 'Águas', parentId: 'beb' },
  { id: 'beb.refri', name: 'Refrigerantes', parentId: 'beb' },
];

const GROUPS = buildCategoryGroups(OPTIONS);

const ROWS: CategoryKeyContext['rows'] = [
  { kind: 'category', id: 'beb' },
  { kind: 'subcategory', id: 'beb.agua', parentId: 'beb' },
  { kind: 'subcategory', id: 'beb.refri', parentId: 'beb' },
];

function makeContext(overrides: Partial<CategoryKeyContext> = {}): CategoryKeyContext {
  return {
    rows: ROWS,
    activeIndex: -1,
    groups: GROUPS,
    single: false,
    allowParentSelection: false,
    setActiveIndex: vi.fn(),
    toggleExpanded: vi.fn(),
    expand: vi.fn(),
    collapse: vi.fn(),
    toggleCategory: vi.fn(),
    toggleSubcategory: vi.fn(),
    commit: vi.fn(),
    cancel: vi.fn(),
    pick: vi.fn(),
    ...overrides,
  };
}

describe('cursor movement', () => {
  it('steps down from nothing to the first row', () => {
    const context = makeContext();
    handleCategoryKeyDown('ArrowDown', false, context);
    expect(context.setActiveIndex).toHaveBeenCalledWith(0);
  });

  it('stops at the last row rather than wrapping', () => {
    const context = makeContext({ activeIndex: 2 });
    handleCategoryKeyDown('ArrowDown', false, context);
    expect(context.setActiveIndex).toHaveBeenCalledWith(2);
  });

  it('stops at the first row going up', () => {
    const context = makeContext({ activeIndex: 0 });
    handleCategoryKeyDown('ArrowUp', false, context);
    expect(context.setActiveIndex).toHaveBeenCalledWith(0);
  });

  it('ignores movement when there are no rows', () => {
    const context = makeContext({ rows: [] });
    expect(handleCategoryKeyDown('ArrowDown', false, context)).toBe(true);
    expect(context.setActiveIndex).not.toHaveBeenCalled();
  });
});

describe('horizontal arrows', () => {
  it('→ expands the category under the cursor', () => {
    const context = makeContext({ activeIndex: 0 });
    handleCategoryKeyDown('ArrowRight', false, context);
    expect(context.expand).toHaveBeenCalledWith('beb');
  });

  it('→ does nothing on a subcategory: there is nothing deeper', () => {
    const context = makeContext({ activeIndex: 1 });
    handleCategoryKeyDown('ArrowRight', false, context);
    expect(context.expand).not.toHaveBeenCalled();
  });

  it('← collapses a category', () => {
    const context = makeContext({ activeIndex: 0 });
    handleCategoryKeyDown('ArrowLeft', false, context);
    expect(context.collapse).toHaveBeenCalledWith('beb');
  });

  it('← walks a subcategory up to its parent and lands the cursor there', () => {
    const context = makeContext({ activeIndex: 2 });
    handleCategoryKeyDown('ArrowLeft', false, context);
    expect(context.collapse).toHaveBeenCalledWith('beb');
    expect(context.setActiveIndex).toHaveBeenCalledWith(0);
  });
});

describe('Space', () => {
  it('marks a subcategory', () => {
    const context = makeContext({ activeIndex: 1 });
    handleCategoryKeyDown(' ', false, context);
    expect(context.toggleSubcategory).toHaveBeenCalledWith('beb.agua');
  });

  it('expands a category that is only a heading', () => {
    const context = makeContext({ activeIndex: 0 });
    handleCategoryKeyDown(' ', false, context);
    expect(context.toggleExpanded).toHaveBeenCalledWith('beb');
    expect(context.toggleCategory).not.toHaveBeenCalled();
  });

  it('ticks the whole category when parents are selectable', () => {
    const context = makeContext({ activeIndex: 0, allowParentSelection: true });
    handleCategoryKeyDown(' ', false, context);
    expect(context.toggleCategory).toHaveBeenCalledWith(GROUPS[0]);
  });

  it('picks instead of marking in single-select', () => {
    const context = makeContext({ activeIndex: 1, single: true });
    handleCategoryKeyDown(' ', false, context);
    expect(context.pick).toHaveBeenCalledWith('beb.agua');
  });

  it('does nothing with no cursor', () => {
    const context = makeContext({ activeIndex: -1 });
    handleCategoryKeyDown(' ', false, context);
    expect(context.toggleSubcategory).not.toHaveBeenCalled();
  });
});

describe('Enter and Escape', () => {
  it('Enter applies the draft in multi-select', () => {
    const context = makeContext({ activeIndex: 1 });
    handleCategoryKeyDown('Enter', false, context);
    expect(context.commit).toHaveBeenCalled();
  });

  it('Enter applies even with no cursor', () => {
    const context = makeContext();
    handleCategoryKeyDown('Enter', false, context);
    expect(context.commit).toHaveBeenCalled();
  });

  it('Enter picks the cursor row in single-select', () => {
    const context = makeContext({ activeIndex: 2, single: true });
    handleCategoryKeyDown('Enter', false, context);
    expect(context.pick).toHaveBeenCalledWith('beb.refri');
  });

  it('Escape cancels', () => {
    const context = makeContext();
    handleCategoryKeyDown('Escape', false, context);
    expect(context.cancel).toHaveBeenCalled();
  });
});

describe('yielding to the search field', () => {
  // The panel opens focused on an EMPTY search box. Yielding these keys
  // unconditionally would leave the tree undrivable from the keyboard.
  it.each([' ', 'ArrowLeft', 'ArrowRight'])(
    'claims %s while the field is empty',
    (key) => {
      expect(handleCategoryKeyDown(key, false, makeContext({ activeIndex: 1 }))).toBe(true);
    },
  );

  it.each([' ', 'ArrowLeft', 'ArrowRight'])(
    'yields %s once the field holds text',
    (key) => {
      expect(handleCategoryKeyDown(key, true, makeContext({ activeIndex: 1 }))).toBe(false);
    },
  );

  it('still navigates and applies while typing', () => {
    const context = makeContext({ activeIndex: 0 });
    expect(handleCategoryKeyDown('ArrowDown', true, context)).toBe(true);
    expect(handleCategoryKeyDown('Enter', true, context)).toBe(true);
    expect(handleCategoryKeyDown('Escape', true, context)).toBe(true);
  });

  it('leaves an unrelated key alone', () => {
    expect(handleCategoryKeyDown('a', false, makeContext())).toBe(false);
  });
});

/**
 * A childless category is the LEAF, so every input path has to treat it as one.
 * The tree helpers always did (`leavesOf` returns the category's own id), but
 * the keyboard read it as a heading and only folded a row with nothing under it
 * to fold — the estoque filter's unselectable parents.
 */
describe('a category with no children', () => {
  const LEAF_OPTIONS: CategorySelectOption[] = [{ id: 'combo', name: 'Combos' }];
  const LEAF_GROUPS = buildCategoryGroups(LEAF_OPTIONS);

  const leafContext = (overrides: Partial<CategoryKeyContext> = {}): CategoryKeyContext =>
    makeContext({
      rows: [{ kind: 'category', id: 'combo' }],
      groups: LEAF_GROUPS,
      activeIndex: 0,
      ...overrides,
    });

  it('marks with Space instead of folding, in the leaf-only default', () => {
    const context = leafContext();
    handleCategoryKeyDown(' ', false, context);
    expect(context.toggleCategory).toHaveBeenCalledWith(LEAF_GROUPS[0]);
    expect(context.toggleExpanded).not.toHaveBeenCalled();
  });

  it('picks with Space in single-select', () => {
    const context = leafContext({ single: true });
    handleCategoryKeyDown(' ', false, context);
    expect(context.pick).toHaveBeenCalledWith('combo');
  });

  it('picks with Enter in single-select', () => {
    const context = leafContext({ single: true });
    handleCategoryKeyDown('Enter', false, context);
    expect(context.pick).toHaveBeenCalledWith('combo');
  });
});

/**
 * Enter, Space and the row click are one decision. Enter used to pick ANY row in
 * single-select, so a category the panel drew as an inert heading was still
 * choosable from the keyboard — a value the mouse could not produce.
 */
describe('Enter agrees with Space on a heading category', () => {
  it('folds rather than picking, in single-select leaf-only', () => {
    const context = makeContext({ activeIndex: 0, single: true });
    handleCategoryKeyDown('Enter', false, context);
    expect(context.pick).not.toHaveBeenCalled();
    expect(context.toggleExpanded).toHaveBeenCalledWith('beb');
  });

  it('picks the whole category when parents are selectable', () => {
    const context = makeContext({ activeIndex: 0, single: true, allowParentSelection: true });
    handleCategoryKeyDown('Enter', false, context);
    expect(context.pick).toHaveBeenCalledWith('beb');
  });
});
