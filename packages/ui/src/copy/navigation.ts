/**
 * The navigation family's words — the command palette and the breadcrumb
 * trail.
 *
 * Split out of `copy.ts`, which is a barrel over this folder: one file
 * listing every family is the file that grows on every port, and it stopped
 * fitting the 400-line budget the rest of this package holds itself to.
 */

/** The command palette's footer hints and its empty state. */
export interface CommandPaletteCopy {
  /** The three keyboard hints, each a chip in the footer. */
  execute: string;
  navigate: string;
  close: string;
  /** The recent-commands group, and the nudge under "nothing found". */
  recent: string;
  tryAnotherTerm: string;
}

/**
 * `SectionNav`'s own words — only the chrome it draws around the host's
 * destinations. Every destination and menu label is the host's, per prop.
 */
export interface SectionNavCopy {
  /** The open primary trigger's accessible name, and the sheet's close button. */
  close: string;
  /** A badge's accessible name — "3 pending", for a count of 3. */
  badge: (count: number) => string;
}

/** The breadcrumb's overflow control, in its two spellings. */
export interface BreadcrumbCopy {
  showMore: string;
  moreItems: string;
}
