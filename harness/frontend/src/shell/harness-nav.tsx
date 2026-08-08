import { useState, type CSSProperties, type JSX } from 'react';

import { NAV_GROUPS, PAGES, type HarnessNavGroup, type HarnessPage } from '../pages/registry';

/**
 * The harness sidebar, structured like future-pay's admin one
 * (`apps/admin/src/shell/admin-sidebar-nav.tsx`).
 *
 * Four behaviours are borrowed, and each answers something the flat list got
 * wrong once seventeen pages were registered:
 *
 *  - **Labelled groups**, ordered by how often you open them.
 *  - **A caret on the group header and nowhere else.** A per-row chevron sat a
 *    few pixels under the header's, pointing at a different thing.
 *  - **Parent rows whose disclosure IS the route.** A parent opens because you
 *    are inside it and closes when you leave, so there is no stale-open
 *    disclosure and no way for the sidebar to disagree with the page you are
 *    on.
 *  - **Sections that stay collapsed once you collapse them**, including the
 *    one holding the active page.
 *
 * Deliberately NOT borrowed: MUI, the permission/entitlement gates, and the
 * badge counts. Gates are the admin's reason for existing; here every page is
 * always reachable, and a harness that pulled in a component library to draw
 * its own chrome would put that library between a reader and the package they
 * came to look at.
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

/**
 * Derive the sections from the registry, so adding a page stays ONE edit in
 * `registry.ts` — the promise that file makes, and the reason the tree is not
 * hand-written here the way the admin's is.
 */
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

const SECTIONS = buildHarnessNav();

function rowHoldsSlug(row: NavRow, slug: string): boolean {
  return row.slug === slug || row.children.some((child) => child.slug === slug);
}

const linkStyle = (active: boolean, depth: number): CSSProperties => ({
  display: 'block',
  padding: depth === 0 ? '6px 8px' : '5px 8px 5px 20px',
  borderRadius: 4,
  fontSize: depth === 0 ? 14 : 13,
  fontWeight: active ? 700 : 400,
  color: active ? '#1a1a1a' : '#2952cc',
  background: active ? '#eef2ff' : 'transparent',
  textDecoration: 'none',
});

function NavLink({
  row,
  active,
  depth,
}: {
  row: NavRow;
  active: boolean;
  depth: number;
}): JSX.Element {
  return (
    <a
      href={`#/${row.slug}`}
      data-testid={`harness-nav-${row.key}`}
      aria-current={active ? 'page' : undefined}
      style={linkStyle(active, depth)}
    >
      {row.label}
      {row.pkg !== undefined && (
        <span style={{ display: 'block', fontSize: 11, color: '#888', fontWeight: 400 }}>
          {row.pkg}
        </span>
      )}
    </a>
  );
}

/** One top-level row, with its children shown while you are inside it. */
function NavEntry({ row, activeSlug }: { row: NavRow; activeSlug: string }): JSX.Element {
  const childActive = row.children.some((child) => child.slug === activeSlug);
  return (
    <li style={{ margin: '2px 0' }}>
      {/* The parent row lands on one of its own children, so when that child is
          the active page the CHILD carries the highlight and the parent does
          not — two highlighted rows for one destination reads as two pages. */}
      <NavLink row={row} active={row.slug === activeSlug && !childActive} depth={0} />
      {row.children.length > 0 && rowHoldsSlug(row, activeSlug) && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '2px 0 6px' }}>
          {row.children.map((child) => (
            <li key={child.key}>
              <NavLink row={child} active={child.slug === activeSlug} depth={1} />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function NavSectionBlock({
  section,
  activeSlug,
  open,
  onToggle,
}: {
  section: NavSection;
  activeSlug: string;
  open: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <section data-testid={`harness-nav-group-${section.key}`} style={{ marginBottom: 12 }}>
      <button
        type="button"
        onClick={onToggle}
        data-testid={`harness-nav-section-toggle-${section.key}`}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          padding: '6px 8px',
          border: 0,
          background: 'transparent',
          cursor: 'pointer',
          color: '#666',
          font: 'inherit',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        {section.label}
        <span aria-hidden style={{ color: '#aaa' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {section.rows.map((row) => (
            <NavEntry key={row.key} row={row} activeSlug={activeSlug} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function HarnessNav({ activeSlug }: { activeSlug: string }): JSX.Element {
  const [collapsed, setCollapsed] = useState<readonly string[]>([]);
  const toggle = (key: string) =>
    setCollapsed((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <nav
      data-testid="harness-nav"
      style={{ width: 260, flexShrink: 0, borderRight: '1px solid #ddd', padding: 16 }}
    >
      <h1 style={{ fontSize: 14, textTransform: 'uppercase', color: '#666' }}>Published surfaces</h1>
      {SECTIONS.map((section) => (
        <NavSectionBlock
          key={section.key}
          section={section}
          activeSlug={activeSlug}
          // A collapsed section hides its rows even when you are standing in
          // one of them, exactly as the admin's does. Forcing it back open was
          // the first version here, and it made the header look broken: you
          // click collapse on the section you are in and nothing happens.
          // Where you are is never in doubt anyway — the page is on screen.
          open={!collapsed.includes(section.key)}
          onToggle={() => toggle(section.key)}
        />
      ))}
    </nav>
  );
}
