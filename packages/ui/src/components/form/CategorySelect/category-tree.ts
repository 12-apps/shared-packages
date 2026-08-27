import type {
  CategoryGroup,
  CategorySelectionChip,
  CategorySelectOption,
} from './CategorySelect.types';

/**
 * Fold a string to its comparison form: no diacritics, lower case.
 *
 * Portuguese category names are full of them ("Águas", "Cápsulas", "Grãos"), and
 * an admin typing "agua" or "graos" on a hurried phone keyboard means the same
 * thing. Comparing folded forms on both sides makes the search accent-blind in
 * both directions.
 */
export function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Group a flat `parentId` list into top level + children, preserving input order.
 *
 * An option whose `parentId` names no top-level row is promoted to top level
 * rather than dropped — a category is never invisible just because its parent
 * was filtered out of the payload, or because the tree is deeper than two levels.
 */
export function buildCategoryGroups(options: CategorySelectOption[]): CategoryGroup[] {
  const roots = options.filter((option) => !option.parentId);
  const rootIds = new Set(roots.map((root) => root.id));
  const groups = new Map<string, CategoryGroup>(
    roots.map((root) => [root.id, { category: root, subcategories: [] }]),
  );
  const orphans: CategoryGroup[] = [];

  options.forEach((option) => {
    if (!option.parentId) return;
    const parent = groups.get(option.parentId);
    if (parent) {
      parent.subcategories.push(option);
      return;
    }
    if (!rootIds.has(option.id)) orphans.push({ category: option, subcategories: [] });
  });

  return [...groups.values(), ...orphans];
}

/**
 * Whether this category IS the leaf, because nothing sits under it.
 *
 * The leaf-only default makes a category a heading and the subcategory the thing
 * you pick — but a childless category has no subcategory to offer instead, so
 * that reading leaves it unpickable and the row does nothing at all. It is the
 * leaf, so it is selectable in its own right, whatever `allowParentSelection`
 * says. Everything below already agreed; only the rows and the activation did
 * not, which is what made a childless category unselectable on the estoque
 * filter while `Marcar tudo` could still select it.
 */
export function isLeafCategory(group: CategoryGroup): boolean {
  return group.subcategories.length === 0;
}

/** Every selectable leaf id across all groups, in display order. */
export function collectLeafIds(groups: CategoryGroup[]): string[] {
  return groups.flatMap((group) => leavesOf(group));
}

/** The leaves a category stands for — its subcategories, or itself when childless. */
export function leavesOf(group: CategoryGroup): string[] {
  return isLeafCategory(group) ? [group.category.id] : group.subcategories.map((sub) => sub.id);
}

export type CategoryCheckState = 'off' | 'partial' | 'on';

/** Whether none, some, or all of a category's leaves are selected. */
export function categoryCheckState(
  group: CategoryGroup,
  selected: ReadonlySet<string>,
): CategoryCheckState {
  const leaves = leavesOf(group);
  const hits = leaves.filter((id) => selected.has(id)).length;
  if (hits === 0) return 'off';
  return hits === leaves.length ? 'on' : 'partial';
}

/** Select every leaf of a category, or clear them all when already complete. */
export function toggleCategoryLeaves(
  group: CategoryGroup,
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  const leaves = leavesOf(group);
  const turningOff = categoryCheckState(group, selected) === 'on';
  leaves.forEach((id) => (turningOff ? next.delete(id) : next.add(id)));
  return next;
}

/** Add an id when absent, remove it when present. */
export function toggleLeaf(id: string, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * Collapse a raw id set into the chips a human reads: a category that is fully
 * selected becomes ONE chip bearing the category's name, rather than one chip
 * per subcategory — "Bebidas" instead of six drinks.
 */
export function summarizeSelection(
  groups: CategoryGroup[],
  selected: ReadonlySet<string>,
): CategorySelectionChip[] {
  return groups.flatMap((group): CategorySelectionChip[] => {
    const state = categoryCheckState(group, selected);
    if (state === 'off') return [];
    if (state === 'on') {
      return [{ id: group.category.id, label: group.category.name, whole: true }];
    }
    return group.subcategories
      .filter((sub) => selected.has(sub.id))
      .map((sub) => ({ id: sub.id, label: sub.name, whole: false }));
  });
}

/**
 * Drop the leaves a chip stands for. A `whole` chip removes the whole category;
 * any other chip removes just that leaf.
 */
export function removeChip(
  groups: CategoryGroup[],
  chipId: string,
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  const group = groups.find((candidate) => candidate.category.id === chipId);
  if (group) {
    leavesOf(group).forEach((id) => next.delete(id));
    return next;
  }
  next.delete(chipId);
  return next;
}

/**
 * Search across BOTH levels, keeping every hit under its parent.
 *
 * A category that matches keeps all of its subcategories, so "Bebidas" shows the
 * whole group. A category that does not match keeps only the subcategories that
 * do — the hit still arrives with its parent visible above it, which is the
 * context that tells "Massas" (mercearia) from "Massas" (pratos principais).
 */
export function filterCategoryGroups(groups: CategoryGroup[], query: string): CategoryGroup[] {
  const needle = foldText(query.trim());
  if (!needle) return groups;
  return groups.flatMap((group) => {
    if (foldText(group.category.name).includes(needle)) return [group];
    const subcategories = group.subcategories.filter((sub) =>
      foldText(sub.name).includes(needle),
    );
    return subcategories.length > 0 ? [{ category: group.category, subcategories }] : [];
  });
}

/** A run of text, flagged when it is the part that matched the query. */
interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Split a label around the query hit so the view can mark it.
 *
 * Slicing uses indices from the FOLDED text but cuts the ORIGINAL, which is safe
 * because folding is per-character here: NFD-stripping combining marks and
 * lower-casing both preserve offsets for the scripts these names use.
 */
export function highlightSegments(text: string, query: string): HighlightSegment[] {
  const needle = foldText(query.trim());
  if (!needle) return [{ text, match: false }];
  const at = foldText(text).indexOf(needle);
  if (at < 0) return [{ text, match: false }];
  return [
    { text: text.slice(0, at), match: false },
    { text: text.slice(at, at + needle.length), match: true },
    { text: text.slice(at + needle.length), match: false },
  ].filter((segment) => segment.text.length > 0);
}

/** A flattened row, so keyboard navigation can walk what is actually on screen. */
export interface CategoryRowRef {
  kind: 'category' | 'subcategory';
  id: string;
  /** Owning category id — lets ← jump from a subcategory back to its parent. */
  parentId?: string;
}

/** The visible rows, in order, honouring which categories are expanded. */
export function flattenRows(
  groups: CategoryGroup[],
  isExpanded: (categoryId: string) => boolean,
): CategoryRowRef[] {
  return groups.flatMap((group) => {
    const head: CategoryRowRef = { kind: 'category', id: group.category.id };
    if (!isExpanded(group.category.id)) return [head];
    return [
      head,
      ...group.subcategories.map(
        (sub): CategoryRowRef => ({
          kind: 'subcategory',
          id: sub.id,
          parentId: group.category.id,
        }),
      ),
    ];
  });
}
