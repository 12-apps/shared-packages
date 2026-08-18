import type { ElementType, ReactNode } from 'react';

/**
 * How an entry is doing, as a marker beside its label.
 *
 * The host RESOLVES this — the rail never derives it from the screen behind the
 * row. A settings shell cannot know whether "Endereço" counts as configured, and
 * a rail that guesses disagrees with the screen the moment the rule moves.
 *
 * - `ok` — set up and working.
 * - `off` — exists, switched off.
 * - `new` — never opened.
 * - `locked` — the plan does not include it, so it has no configuration state at
 *   all. Rendered as a padlock rather than a coloured dot for exactly that
 *   reason: a locked row is not "off", and colouring it grey would say it is.
 */
export type SettingsNavStatus = 'ok' | 'off' | 'new' | 'locked';

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
  /** Host-resolved situation marker. Omit to render no marker at all. */
  status?: SettingsNavStatus;
  /**
   * What the marker MEANS, in the host's language — "Ligado", "Não visitado",
   * "Incluído no plano Pro". Rendered as text only a screen reader reaches, so
   * colour is never the sole carrier of the meaning. Required alongside
   * `status`: a marker nobody can name is decoration.
   */
  statusLabel?: string;
  /**
   * Render the entry as inert text rather than a control.
   *
   * For a row that is listed but not reachable from here. It is deliberately not
   * a disabled button: disabled says "you cannot", and the honest statement is
   * "not from this screen".
   */
  inert?: boolean;
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
 * Which width the rail appears at — and, in `drilldown`, where the whole shell
 * changes shape. Below it the list is the page and a chip strip carries the
 * sibling sections; at and above it the rail takes the left column.
 *
 * A raw pixel number is as valid as a breakpoint name, because a settings area's
 * structural switch is a design decision and not always one of five named
 * widths — 1024px, the tablet-landscape switch, is nowhere in MUI's defaults
 * (`lg` is 1200), and rounding to the nearest name would move 176px of
 * behaviour to keep a string tidy.
 */
export type SettingsRailBreakpoint = 'sm' | 'md' | 'lg' | 'xl' | number;

/**
 * How navigation behaves BELOW {@link SettingsLayoutProps.railBreakpoint}.
 *
 * - `switcher` (default) — the rail folds into a collapsed disclosure stacked
 *   above the panel. Backwards-compatible, and right for a shell whose panel is
 *   always the point.
 * - `drilldown` — list first, then screen, with a way back. At the area's index
 *   the LIST is the page; inside a section the panel is the page and a scrollable
 *   chip strip carries its siblings. This is what every mobile settings app
 *   does, and what fits at 375px, where a 300px rail would leave 75px of content.
 */
export type SettingsNavVariant = 'switcher' | 'drilldown';

/** The exit offered inside the empty-search state, so the dead end has a door. */
export interface SettingsEmptySearchAction {
  /** Button label, e.g. `"Limpar a busca"`. */
  label: ReactNode;
  /**
   * Extra work to do on top of clearing the field. The layout always clears its
   * own query; a host that mirrors the term elsewhere clears that here.
   */
  onClear?: () => void;
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
   * A way OUT of the empty-search state, rendered inside it.
   *
   * Without one the search that matches nothing is a screen with no next step —
   * the operator's only move is to guess which characters to delete.
   */
  emptySearchAction?: SettingsEmptySearchAction;
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
  /** Width at which the rail takes its own column. Defaults to `"md"`. */
  railBreakpoint?: SettingsRailBreakpoint;
  /** Narrow-width navigation shape. Defaults to `"switcher"`. */
  navVariant?: SettingsNavVariant;
  /**
   * True when the router is at the area's index rather than inside a section.
   *
   * `drilldown` only. It decides which of the two — the list or the panel — is
   * the page below the breakpoint. Both are always in the DOM; only `display`
   * moves, so the two widths cannot drift apart in what they offer.
   */
  atIndex?: boolean;
  /** Where "back" goes in `drilldown`: the area's index. */
  indexHref?: string;
  /** Label on the back control. Defaults to `"Back"`. */
  backLabel?: string;
  /**
   * The sibling sections carried by the narrow-width chip strip — usually the
   * open item's own group.
   *
   * The strip lives in the DOM at EVERY width and is hidden by CSS above the
   * breakpoint, alongside the rail that replaces it. That is the whole point:
   * navigation chosen by a JS media query is navigation that can exist at one
   * width and not the other, and nothing catches it.
   */
  sectionChips?: SettingsNavItem[];
}
