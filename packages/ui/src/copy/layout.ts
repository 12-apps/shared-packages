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

/**
 * The chrome words of an editable `SettingCard`. The card's own title, summary
 * and status are per-card props; these are the words every card repeats.
 */
export interface SettingCardCopy {
  /** The closed card's trigger. Its accessible name also carries the card's title. */
  edit: string;
  /** Discard the draft and close. */
  cancel: string;
  save: string;
  /** Announced (and shown to sighted users as the Save label) while the save is pending. */
  saving: string;
  /** The disclosure that reveals the card's longer explanation. */
  learnMore: string;
  /** Shown when the save rejected and the host's `formatError` gave no sentence of its own. */
  saveFailed: string;
}

/**
 * What a switch that saves the moment it flips says about that save — shared
 * by `SettingToggle` and `SettingGroup`'s main switch.
 */
export interface SettingSwitchCopy {
  /** Announced while the flip is being saved. */
  saving: string;
  /** Shown when the save rejected and the host's `formatError` gave no sentence of its own. */
  saveFailed: string;
}
