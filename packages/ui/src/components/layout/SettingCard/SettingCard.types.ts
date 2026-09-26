import type { SxProps, Theme } from '@mui/material/styles/index.js';
import type { ReactNode } from 'react';

import type { SettingCardCopy, SettingSwitchCopy } from '../../../copy';
import type { ColorValue } from '../../../tokens/vocabulary';

export type { SettingCardCopy, SettingSwitchCopy } from '../../../copy';

/**
 * What a save handler may return. A promise holds the card in its saving
 * state until it settles; a rejection is the failure path. A plain return is
 * a synchronous success.
 */
export type SettingSaveResult = void | Promise<unknown>;

/**
 * Turns whatever a rejected save threw into the sentence the card shows.
 * Return `undefined` to fall back to the copy's `saveFailed`. The card never
 * renders an `Error.message` on its own: that string is usually written for a
 * developer, in the developer's language.
 */
export type SettingErrorFormatter = (error: unknown) => string | undefined;

/** The heading level a card's title renders at, so it fits the page outline. */
export type SettingHeadingLevel = 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

/** The pill beside a closed card's title: the setting's current state, in words. */
export interface SettingStatus {
  /** What the state IS, in the host's language: "On", "Not configured". */
  label: string;
  /** A house colour. Colour is never the only carrier: `label` is always shown. Defaults to `neutral`. */
  color?: ColorValue;
}

/** What every card in the family shares. */
interface SettingSurfaceProps {
  /** The setting's name. Also the accessible name of the card's region. */
  title: string;
  /** The heading level of `title`. Defaults to `h3`. */
  headingLevel?: SettingHeadingLevel;
  /** A decorative glyph before the title. */
  icon?: ReactNode;
  /** Maps a rejected save to the sentence shown; see {@link SettingErrorFormatter}. */
  formatError?: SettingErrorFormatter;
  /** Root test id. Parts derive theirs from it (`<id>-edit`, `<id>-save`, …). */
  dataTestId?: string;
  className?: string;
  sx?: SxProps<Theme>;
}

export interface SettingCardProps extends SettingSurfaceProps {
  /** The chrome words (Edit, Cancel, Save, …). REQUIRED — no default copy. */
  copy: SettingCardCopy;
  /** The one line a closed card shows under its title: the setting's current value. */
  summary?: ReactNode;
  /** The pill beside the title. Omit for none. */
  status?: SettingStatus;
  /** The form, rendered only while the card is open (so an uncontrolled draft is discarded on close). */
  children: ReactNode;
  /** Longer explanation behind a "learn more" disclosure in the open card. Omit for no disclosure. */
  learnMore?: ReactNode;
  /**
   * Persist the draft. The card stays in its saving state while a returned
   * promise is pending, closes when it resolves, and STAYS OPEN showing the
   * error when it rejects.
   */
  onSave: () => SettingSaveResult;
  /** The card closed without saving — reset the host's draft here. */
  onCancel?: () => void;
  /** Controlled open state. Pair with `onOpenChange`. */
  open?: boolean;
  /** Uncontrolled initial open state. */
  defaultOpen?: boolean;
  /** Every open/close request: Edit, Cancel, Escape, and a successful save. */
  onOpenChange?: (open: boolean) => void;
  /** Disables Edit on a closed card (the setting cannot be changed from here). */
  disabled?: boolean;
  /** Disables Save — for a draft the host knows is invalid. */
  saveDisabled?: boolean;
}

interface SettingSwitchProps extends SettingSurfaceProps {
  /** The saving and failure words. REQUIRED — no default copy. */
  copy: SettingSwitchCopy;
  /** Explanation under the title. Read to screen readers as the switch's description. */
  summary?: ReactNode;
  /** The persisted value. The switch shows the flip optimistically while it saves, then this again. */
  checked: boolean;
  /**
   * Persist a flip. The switch shows the new value and a saving state while a
   * returned promise is pending; a rejection reverts it and shows the error.
   */
  onChange: (checked: boolean) => SettingSaveResult;
  /** Disables the switch. */
  disabled?: boolean;
}

/**
 * `card` draws the surface; `row` draws the same content flat, for a
 * dependent row inside a `SettingGroup` (a card inside a card reads as two
 * subjects).
 */
export type SettingToggleVariant = 'card' | 'row';

export interface SettingToggleProps extends SettingSwitchProps {
  /** Defaults to `card`. */
  variant?: SettingToggleVariant;
}

export interface SettingGroupProps extends SettingSwitchProps {
  /**
   * Why the dependent rows are inactive while the main switch is off —
   * "Turn on notifications to choose which ones you get". Shown only then.
   */
  inactiveHint: string;
  /** The dependent rows. Stay rendered while the main switch is off, dimmed and inert. */
  children: ReactNode;
}

/** The most columns a `SettingGrid` lays out. */
export type SettingGridColumns = 1 | 2 | 3;

export interface SettingGridProps {
  children: ReactNode;
  /**
   * The narrowest a column may get, in design px (scaled with the type
   * scale). The grid adds a column each time its OWN width fits one more.
   * Defaults to 320.
   */
  minColumnWidth?: number;
  /** Defaults to 3. */
  maxColumns?: SettingGridColumns;
  /** Gap between cards, in theme spacing units. Defaults to 2. */
  gap?: number;
  /** Accessible name. When set the grid renders as a labelled `region`. */
  'aria-label'?: string;
  dataTestId?: string;
  className?: string;
  sx?: SxProps<Theme>;
}
