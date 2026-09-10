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
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Whether following `parentId` up from `startId` ever comes back to a node it
 * already passed.
 *
 * Two levels made a cycle impossible by construction: a child was attached to a
 * ROOT or promoted, so nothing could ever point back down. An arbitrary depth
 * attaches every node to whichever node its `parentId` names, and a payload
 * where two rows name each other would build a ring that every walk below —
 * flattening, filtering, counting leaves — follows until the stack gives out. So
 * the chain is checked rather than trusted, and a node on a ring is promoted to
 * top level, which is what {@link buildCategoryGroups} already does with a
 * parent it cannot resolve.
 */
function onParentCycle(startId: string, parents: ReadonlyMap<string, string>): boolean {
  const seen = new Set<string>([startId]);
  let current = parents.get(startId);
  while (current !== undefined) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parents.get(current);
  }
  return false;
}

/**
 * Nest a flat `parentId` list into a tree of ANY depth, preserving input order
 * at every level.
 *
 * An option whose `parentId` names nothing in the payload is promoted to top
 * level rather than dropped — a category is never invisible just because its
 * parent was filtered out of the response. A duplicate id keeps its first row,
 * so a repeated payload cannot place the same node twice.
 */
export function buildCategoryGroups(options: CategorySelectOption[]): CategoryGroup[] {
  const nodes = new Map<string, CategoryGroup>();
  const parents = new Map<string, string>();
  options.forEach((option) => {
    if (nodes.has(option.id)) return;
    nodes.set(option.id, { category: option, subcategories: [] });
    if (option.parentId && option.parentId !== option.id) parents.set(option.id, option.parentId);
  });

  const roots: CategoryGroup[] = [];
  nodes.forEach((node, id) => {
    const parentId = parents.get(id);
    const parent = parentId === undefined ? undefined : nodes.get(parentId);
    if (parent && !onParentCycle(id, parents)) parent.subcategories.push(node);
    else roots.push(node);
  });
  return roots;
}

/**
 * Whether this node IS the leaf, because nothing sits under it.
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

/** Every selectable leaf id across the whole tree, in display order. */
export function collectLeafIds(groups: CategoryGroup[]): string[] {
  return groups.flatMap((group) => leavesOf(group));
}

/**
 * The leaves a node stands for — every leaf BELOW it, or itself when childless.
 *
 * Recursive rather than one level down, so a category three levels deep still
 * stands for the items at the bottom of it and not for the subcategories in
 * between: the value a caller receives stays uniformly leaves, which is the
 * property that lets a chip, a tri-state checkbox and `Marcar tudo` agree.
 */
export function leavesOf(group: CategoryGroup): string[] {
  if (isLeafCategory(group)) return [group.category.id];
  return group.subcategories.flatMap((sub) => leavesOf(sub));
}

/** Every node that can be unfolded, at any depth — what "Expandir tudo" opens. */
export function collectBranchIds(groups: CategoryGroup[]): string[] {
  return groups.flatMap((group) =>
    isLeafCategory(group) ? [] : [group.category.id, ...collectBranchIds(group.subcategories)],
  );
}

/** The node carrying `id`, searched at every depth. */
export function findGroup(groups: CategoryGroup[], id: string): CategoryGroup | undefined {
  for (const group of groups) {
    if (group.category.id === id) return group;
    const found = findGroup(group.subcategories, id);
    if (found) return found;
  }
  return undefined;
}

/**
 * The names from the top-level category down to `id`, or `null` when absent.
 *
 * The single-select trigger reads this back as `Pai › Filha › Item`, so a chosen
 * row keeps the context that tells `Massas` (mercearia) from `Massas` (pratos
 * principais) once the panel has closed over it.
 */
export function categoryPath(groups: CategoryGroup[], id: string): string[] | null {
  for (const group of groups) {
    if (group.category.id === id) return [group.category.name];
    const below = categoryPath(group.subcategories, id);
    if (below) return [group.category.name, ...below];
  }
  return null;
}

/**
 * How many levels the deepest branch has. A flat list is 1, the classic
 * category/subcategory tree is 2, anything more is a tree with items in it.
 */
export function treeDepth(groups: CategoryGroup[]): number {
  return groups.reduce(
    (deepest, group) => Math.max(deepest, 1 + treeDepth(group.subcategories)),
    0,
  );
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
 * Collapse a raw id set into the chips a human reads: a node that is fully
 * selected becomes ONE chip bearing its name, rather than one chip per leaf —
 * "Bebidas" instead of six drinks.
 *
 * A partly-selected node hands the question down to its own children, so the
 * chip that appears is always the DEEPEST node that is completely selected.
 */
export function summarizeSelection(
  groups: CategoryGroup[],
  selected: ReadonlySet<string>,
): CategorySelectionChip[] {
  return groups.flatMap((group): CategorySelectionChip[] => {
    const state = categoryCheckState(group, selected);
    if (state === 'off') return [];
    if (state === 'on') {
      // `whole` says the chip stands for MORE than itself, so it is the node
      // having children that decides it — not the node being fully selected,
      // which a leaf always is the moment it is picked at all.
      return [
        { id: group.category.id, label: group.category.name, whole: !isLeafCategory(group) },
      ];
    }
    return summarizeSelection(group.subcategories, selected);
  });
}

/**
 * Drop the leaves a chip stands for. A chip naming a node removes everything
 * under it; a chip naming nothing in the tree removes just that id.
 */
export function removeChip(
  groups: CategoryGroup[],
  chipId: string,
  selected: ReadonlySet<string>,
): Set<string> {
  const next = new Set(selected);
  const group = findGroup(groups, chipId);
  if (group) {
    leavesOf(group).forEach((id) => next.delete(id));
    return next;
  }
  next.delete(chipId);
  return next;
}

/**
 * Search every level, keeping each hit under its parents.
 *
 * A node that matches keeps its whole subtree, so "Bebidas" shows the entire
 * group. A node that does not match keeps only the descendants that do — the hit
 * still arrives with its parents visible above it, which is the context that
 * tells "Massas" (mercearia) from "Massas" (pratos principais).
 */
export function filterCategoryGroups(groups: CategoryGroup[], query: string): CategoryGroup[] {
  const needle = foldText(query.trim());
  if (!needle) return groups;
  const walk = (nodes: CategoryGroup[]): CategoryGroup[] =>
    nodes.flatMap((node) => {
      if (foldText(node.category.name).includes(needle)) return [node];
      const subcategories = walk(node.subcategories);
      return subcategories.length > 0 ? [{ category: node.category, subcategories }] : [];
    });
  return walk(groups);
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
  id: string;
  /** 0 for a top-level category, one more for each level below it. */
  depth: number;
  /** True when the row has children to unfold — what → and ← act on. */
  branch: boolean;
  /** Owning node id — lets ← jump from a child back to its parent. */
  parentId?: string;
}

/** The visible rows, in order, honouring which nodes are expanded. */
export function flattenRows(
  groups: CategoryGroup[],
  isExpanded: (categoryId: string) => boolean,
): CategoryRowRef[] {
  const walk = (nodes: CategoryGroup[], depth: number, parentId?: string): CategoryRowRef[] =>
    nodes.flatMap((node) => {
      const id = node.category.id;
      const branch = !isLeafCategory(node);
      const row: CategoryRowRef = { id, depth, branch, ...(parentId ? { parentId } : {}) };
      if (!branch || !isExpanded(id)) return [row];
      return [row, ...walk(node.subcategories, depth + 1, id)];
    });
  return walk(groups, 0);
}
