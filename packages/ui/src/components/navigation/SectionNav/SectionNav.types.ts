import type { ElementType, ReactNode } from 'react';

import type { SectionNavCopy } from '../../../copy';

/**
 * One slot of the section — a bar slot on a phone, a row in the rail.
 *
 * A slot either LEADS somewhere (`href`, rendered through `linkComponent`) or
 * DOES something (`onSelect`), the way a menu entry does. A bar of places is a
 * section's navigation; a bar of verbs is a screen's actions pinned at its
 * foot, and it is the same bar, so the two cannot be drawn two ways. Give a
 * slot one or the other.
 */
export interface SectionNavDestination {
  /** Stable key. Also the suffix of the slot's `data-testid`. */
  id: string;
  label: string;
  icon: ReactNode;
  href?: string;
  /**
   * What the slot does, for an action slot. Ignored while `disabled` or
   * `loading`; still called while `dimmed`.
   */
  onSelect?: () => void;
  /**
   * Drawn dimmed and not operable: the act exists here, and cannot be done
   * now. A native `disabled` button — a tap does nothing, and `onSelect` is
   * not called.
   */
  disabled?: boolean;
  /**
   * Drawn exactly like `disabled`, but still TAPPABLE: for an act the screen
   * cannot do now and should EXPLAIN when tapped. It reports
   * `aria-disabled="true"`, stays focusable, never lights up, and its
   * `onSelect` still fires so the host can answer with a message (why not,
   * and what would make it possible).
   */
  dimmed?: boolean;
  /**
   * A write this slot started is in flight — a spinner replaces the icon, the
   * slot reports `aria-busy` and `aria-disabled`, and a tap is ignored. It
   * stays focusable, so the keyboard does not lose its place mid-write.
   */
  loading?: boolean;
  /**
   * The control's own `data-testid`, in place of the one the nav derives. For
   * a host whose suites already drive an id of their own shape.
   */
  dataTestId?: string;
  /**
   * How many things behind this destination wait on the viewer. `0` and
   * `undefined` render no badge — "nothing waiting" and "not known yet" are
   * different claims and neither is a number.
   */
  badge?: number;
  /**
   * For a link: the destination the viewer is on (`aria-current="page"`). For
   * an action slot: a toggle that is ON (`aria-pressed`). The host decides;
   * the nav never reads the URL.
   */
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
  /** Drawn dimmed and not operable — a print already on its way, an act this state refuses. */
  disabled?: boolean;
  /**
   * The control's own `data-testid`, in place of the one the nav derives. For
   * a host whose suites already drive an id of their own shape.
   */
  dataTestId?: string;
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
  /** The trigger is drawn dimmed and does not open; in the rail every row of it is inert. */
  disabled?: boolean;
  /**
   * The control's own `data-testid`, in place of the one the nav derives. For
   * a host whose suites already drive an id of their own shape.
   */
  dataTestId?: string;
}

/**
 * The raised primary as a plain ACTION rather than a menu: one act, done on
 * tap. Its label is drawn under the button, because a bar of verbs names the
 * act it is for rather than leaving it to an icon.
 */
export interface SectionNavAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  /** A native `disabled` button: a tap does nothing. */
  disabled?: boolean;
  /** In flight: a spinner, `aria-busy`, `aria-disabled`; focusable, and a tap is ignored. */
  loading?: boolean;
  /**
   * The control's own `data-testid`, in place of the one the nav derives. For
   * a host whose suites already drive an id of their own shape.
   */
  dataTestId?: string;
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
  /**
   * The raised button in the middle of the bar: a menu it opens as a sheet,
   * or an action it does on tap (drawn with its label under it).
   */
  primary?: SectionNavMenu | SectionNavAction;
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
