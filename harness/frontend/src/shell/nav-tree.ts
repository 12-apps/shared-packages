import { NAV_GROUPS, PAGES, type HarnessNavGroup, type HarnessPage } from '../pages/registry';

/**
 * The nav TREE, derived from the registry.
 *
 * future-pay's admin hand-writes its equivalent (`shell/nav-groups.ts`) because
 * every one of its rows carries gates the sidebar has to resolve. Nothing here
 * is gated, so deriving keeps the promise `registry.ts` makes: registering a
 * page is one edit, in one file.
 */

/** A row the sidebar draws: a destination, plus the rows nested under it. */
export interface NavRow {
  /** Stable key — drives the row's `data-testid`. */
  key: string;
  label: string;
  slug: string;
  /**
   * The package this row is about, shown under the label. Top-level rows only:
   * under a parent, every child shares the parent's package, and thirteen
   * repetitions of one name is the noise that made the flat list unreadable.
   */
  pkg?: string;
  children: readonly NavRow[];
}

export interface NavSection {
  key: string;
  label: string;
  rows: readonly NavRow[];
}

function leafRow(page: HarnessPage, showPkg: boolean): NavRow {
  return {
    key: page.slug,
    label: page.title,
    slug: page.slug,
    ...(showPkg ? { pkg: page.pkg } : {}),
    children: [],
  };
}

function parentRows(group: HarnessNavGroup, inGroup: readonly HarnessPage[]): readonly NavRow[] {
  return (group.parents ?? [])
    .map((parent) => ({
      key: parent.key,
      label: parent.label,
      slug: parent.slug,
      pkg: inGroup.find((page) => page.slug === parent.slug)?.pkg,
      children: inGroup
        .filter((page) => page.parent === parent.key)
        .map((page) => leafRow(page, false)),
    }))
    // A parent with nothing under it is the one-item group all over again: a
    // disclosure that only ever reveals the row you already clicked.
    .filter((row) => row.children.length > 0);
}

export function buildHarnessNav(
  pages: readonly HarnessPage[] = PAGES,
  groups: readonly HarnessNavGroup[] = NAV_GROUPS,
): readonly NavSection[] {
  return groups.map((group) => {
    const inGroup = pages.filter((page) => page.group === group.key);
    return {
      key: group.key,
      label: group.label,
      rows: [
        ...parentRows(group, inGroup),
        ...inGroup.filter((page) => page.parent === undefined).map((page) => leafRow(page, true)),
      ],
    };
  });
}

/** Is this row, or one of its children, the page currently on screen? */
export function rowHoldsSlug(row: NavRow, slug: string): boolean {
  return row.slug === slug || row.children.some((child) => child.slug === slug);
}
