/**
 * The layout family's words — the filter shell a grid mounts around itself.
 *
 * Split out of `copy.ts`, which is a barrel over this folder: one file
 * listing every family is the file that grows on every port, and it stopped
 * fitting the 400-line budget the rest of this package holds itself to.
 */

export interface TableFilterCopy {
  /** Drop every applied filter, and the keyword box's own clear. */
  clearAllFilters: string;
  clearKeyword: string;
  /** A numeric range whose maximum is below its minimum. */
  invalidRange: string;
  /** The two free-text bounds, which carry no visible label of their own. */
  rangeMin: string;
  rangeMax: string;
}
