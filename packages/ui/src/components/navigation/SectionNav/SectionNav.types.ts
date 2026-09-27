import type { ElementType, ReactNode } from 'react';

import type { SectionNavCopy } from '../../../copy';

/**
 * One place the section leads to — a bar slot on a phone, a row in the rail.
 */
export interface SectionNavDestination {
  /** Stable key. Also the suffix of the slot's `data-testid`. */
  id: string;
  label: string;
  icon: ReactNode;
  href: string;
  /**
   * How many things behind this destination wait on the viewer. `0` and
   * `undefined` render no badge — "nothing waiting" and "not known yet" are
   * different claims and neither is a number.
   */
  badge?: number;
  /** The destination the viewer is on. The host decides; the nav never reads the URL. */
  active?: boolean;
}

/**
 * One entry inside a menu — a sheet tile on a phone, a row in the rail.
 *
 * An entry either LEADS somewhere (`href`, rendered through `linkComponent`)
 * or DOES something (`onSelect`). Give it one or the other.
 */
export interface SectionNavEntry {
  id: string;
  label: string;
  /** A second line under the label. Shown by `list` groups and in the rail. */
  description?: string;
  icon: ReactNode;
  href?: string;
  onSelect?: () => void;
  badge?: number;
  active?: boolean;
}

/** A titled run of entries inside a menu. */
export interface SectionNavGroup {
  id: string;
  /** Heading above the entries. Omit for a group that needs none. */
  title?: string;
  /**
   * How the phone sheet draws the entries: `grid` is three tiles across,
   * `list` one row each with its description. The rail always lists.
   * Defaults to `list`.
   */
  layout?: 'grid' | 'list';
  entries: SectionNavEntry[];
}

/**
 * A menu the nav opens: the centred primary action, or the "more" slot.
 *
 * On a phone it opens as a bottom sheet over the page. In the rail there is
 * room for everything, so its groups are listed under `title` instead of
 * hiding behind a trigger.
 */
export interface SectionNavMenu {
  /** The trigger's accessible name, and the visible label of the "more" slot. */
  label: string;
  icon: ReactNode;
  /** The sheet's heading, and the rail section's. */
  title: string;
  groups: SectionNavGroup[];
}

/** The way out of the section, drawn at the top of the rail. */
export interface SectionNavBack {
  label: string;
  href: string;
  icon?: ReactNode;
}

export interface SectionNavProps {
  /**
   * `bar` — a bottom tab bar for a phone: the destinations, `more` as the last
   * slot, and `primary` as a raised button in the middle.
   *
   * `rail` — a vertical list for a wide screen, with `back` and `heading` on
   * top and every menu's entries listed rather than folded away.
   */
  layout: 'bar' | 'rail';
  /** The navigation landmark's accessible name. */
  label: string;
  destinations: SectionNavDestination[];
  /** The raised action in the middle of the bar. */
  primary?: SectionNavMenu;
  /** The last slot of the bar. Its badge is the sum of its entries' badges. */
  more?: SectionNavMenu;
  /** Rail only: the way back out of the section. */
  back?: SectionNavBack;
  /** Rail only: a heading above the destinations. */
  heading?: string;
  /**
   * The component every `href` renders through — a router's link adapter that
   * takes `href`. Omitted, a plain `<a>` is used and navigation reloads.
   */
  linkComponent?: ElementType;
  /** The nav's own words. REQUIRED — the component carries none. */
  copy: SectionNavCopy;
  /** Prefix for every `data-testid`. Defaults to `"section-nav"`. */
  dataTestId?: string;
}
