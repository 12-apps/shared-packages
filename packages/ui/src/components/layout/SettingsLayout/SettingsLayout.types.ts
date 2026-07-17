import type { ElementType, ReactNode } from 'react';

/**
 * A single navigable configuration entry inside a {@link SettingsNavGroup}. The
 * `id` drives the active highlight and `data-testid`; `label` (plus optional
 * `keywords`) is what the rail search field matches against.
 */
export interface SettingsNavItem {
  /** Stable id — drives the active highlight + `data-testid`; never derived from `href`. */
  id: string;
  /** Visible label; also matched (case-insensitive) by the search field. */
  label: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Optional link target; rendered through `linkComponent` when set. */
  href?: string;
  /** Extra search terms so an item is findable beyond its visible label. */
  keywords?: string[];
}

/** A labelled category grouping related items in the left rail. */
export interface SettingsNavGroup {
  /** Stable id for the group header's `data-testid`. */
  id: string;
  /** Category header label (uppercased in the rail). */
  label: string;
  /** Optional one-line description shown under the header. */
  description?: string;
  /** The subcategories/items in this group. */
  items: SettingsNavItem[];
}

/**
 * Props for {@link SettingsLayout} — an agnostic, data-driven two-pane settings
 * shell (search + grouped left rail, central panel). It renders navigation from
 * `groups` and the selected screen from `children`; the host owns routing.
 */
export interface SettingsLayoutProps {
  /** Heading shown above the search field (e.g. "Configuração"). */
  title?: ReactNode;
  /** Grouped navigation for the left rail. */
  groups: SettingsNavGroup[];
  /** Id of the currently-open item — highlighted in the rail. */
  activeItemId?: string;
  /** Fired with an item's id when a non-link item is chosen. */
  onSelectItem?: (id: string) => void;
  /** Placeholder for the search field. Defaults to `"Search settings"`. */
  searchPlaceholder?: string;
  /** Shown when the search matches no items. Defaults to a generic string. */
  emptySearchLabel?: ReactNode;
  /**
   * Element type used to render an item that has an `href` (e.g. a Next.js
   * `Link`). Rendered as the `ListItemButton` `component`, so navigation stays a
   * single interactive element. Items without `href` fall back to `onSelectItem`.
   */
  linkComponent?: ElementType;
  /** The central panel content (the selected configuration screen). */
  children: ReactNode;
  /** Prefix for `data-testid` attributes. Defaults to `"settings"`. */
  testIdPrefix?: string;
}
