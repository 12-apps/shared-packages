import type { CategoryRowRef } from './category-tree';
import type { CategoryGroup } from './CategorySelect.types';

/** What a key handler is allowed to do to the panel. */
export interface CategoryKeyContext {
  rows: CategoryRowRef[];
  activeIndex: number;
  groups: CategoryGroup[];
  /** Single-select mode picks on Enter/Space instead of toggling a draft. */
  single: boolean;
  /** Categories are headings, not checkboxes, unless parents are selectable. */
  allowParentSelection: boolean;
  setActiveIndex: (next: number) => void;
  toggleExpanded: (categoryId: string) => void;
  expand: (categoryId: string) => void;
  collapse: (categoryId: string) => void;
  toggleCategory: (group: CategoryGroup) => void;
  toggleSubcategory: (id: string) => void;
  commit: () => void;
  cancel: () => void;
  pick: (id: string) => void;
}

/** The row under the keyboard cursor, if the cursor is on one. */
function activeRow(context: CategoryKeyContext): CategoryRowRef | undefined {
  return context.activeIndex >= 0 ? context.rows[context.activeIndex] : undefined;
}

function groupOf(context: CategoryKeyContext, id: string): CategoryGroup | undefined {
  return context.groups.find((group) => group.category.id === id);
}

function moveCursor(context: CategoryKeyContext, delta: number): void {
  const { rows, activeIndex } = context;
  if (rows.length === 0) return;
  const next =
    delta > 0
      ? Math.min(rows.length - 1, activeIndex + 1)
      : Math.max(0, activeIndex - 1);
  context.setActiveIndex(next);
}

/** → opens a category. On a subcategory it is a no-op: there is nothing deeper. */
function handleRight(context: CategoryKeyContext): void {
  const row = activeRow(context);
  if (row?.kind === 'category') context.expand(row.id);
}

/** ← collapses a category, or walks a subcategory back up to its parent. */
function handleLeft(context: CategoryKeyContext): void {
  const row = activeRow(context);
  if (!row) return;
  if (row.kind === 'category') {
    context.collapse(row.id);
    return;
  }
  if (!row.parentId) return;
  context.collapse(row.parentId);
  const parentIndex = context.rows.findIndex(
    (candidate) => candidate.kind === 'category' && candidate.id === row.parentId,
  );
  if (parentIndex >= 0) context.setActiveIndex(parentIndex);
}

/**
 * Space marks. On a category that is only a HEADING it expands instead — the
 * row has no checkbox, so "mark" has nothing to mean there.
 */
function handleSpace(context: CategoryKeyContext): void {
  const row = activeRow(context);
  if (!row) return;
  if (context.single) {
    context.pick(row.id);
    return;
  }
  if (row.kind === 'subcategory') {
    context.toggleSubcategory(row.id);
    return;
  }
  const group = groupOf(context, row.id);
  if (!group) return;
  if (context.allowParentSelection) context.toggleCategory(group);
  else context.toggleExpanded(row.id);
}

function handleEnter(context: CategoryKeyContext): void {
  const row = activeRow(context);
  if (context.single) {
    if (row) context.pick(row.id);
    return;
  }
  context.commit();
}

/** Key → behaviour. A map keeps this dispatch flat instead of a long if-chain. */
const HANDLERS: Record<string, (context: CategoryKeyContext) => void> = {
  ArrowDown: (context) => moveCursor(context, 1),
  ArrowUp: (context) => moveCursor(context, -1),
  ArrowRight: handleRight,
  ArrowLeft: handleLeft,
  ' ': handleSpace,
  Enter: handleEnter,
  Escape: (context) => context.cancel(),
};

/**
 * Keys the SEARCH BOX has a claim on: Space types a space, and the horizontal
 * arrows move the caret.
 *
 * They are only yielded while the field actually holds text. The panel opens
 * with focus in an EMPTY search box, so yielding unconditionally — as the
 * prototype does — would make Space and ←/→ dead on arrival for anyone driving
 * the tree from the keyboard, which is most of the point of having it. With no
 * text there is no caret to move and no word to space, so the tree takes them;
 * type one character and they revert to the field.
 */
const TEXT_ENTRY_KEYS = new Set([' ', 'ArrowLeft', 'ArrowRight']);

/**
 * Drive the tree from the keyboard.
 *
 * Returns `true` when the key was consumed, so the caller can `preventDefault`
 * only for keys this actually handled — an unhandled key must still reach the
 * search input untouched.
 */
export function handleCategoryKeyDown(
  key: string,
  editingSearchText: boolean,
  context: CategoryKeyContext,
): boolean {
  if (editingSearchText && TEXT_ENTRY_KEYS.has(key)) return false;
  const handler = HANDLERS[key];
  if (!handler) return false;
  handler(context);
  return true;
}
