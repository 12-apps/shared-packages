import type { ReactNode } from 'react';

import type { HeaderButtonProps } from '../HeaderButton';

/**
 * One page-header action, declared as DATA rather than composed as an element.
 *
 * That is the whole point of the type. A header that composes its buttons as
 * JSX can only ever render all of them, because nothing can count a fragment's
 * children without walking React internals — so "three actions" and "seven
 * actions" produce the same row, and the seventh button is what wraps the line
 * on a laptop. A list can be measured, so the component can decide.
 */
export interface HeaderActionItem {
  /**
   * Stable identity. Used as the React key, and as the `data-testid` fallback
   * so an action that MOVES into the overflow menu keeps the selector it had
   * as a button — a suite driving it by id must not care where it ended up.
   */
  id: string;
  /** The label. Shown beside the icon as a button; alone in the menu row. */
  text: ReactNode;
  /** Leading icon. Always visible as a button, and in the menu row. */
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /**
   * Drop this action entirely when false. Present so a caller can declare a
   * permission- or plan-gated action inline, instead of building the array
   * conditionally and losing the reason it is missing.
   *
   * @default true
   */
  visible?: boolean;
  /** Overrides the `data-testid`, which otherwise falls back to {@link id}. */
  dataTestId?: string;
  /** MUI variant for the PRIMARY rendering. Ignored inside the menu. */
  variant?: HeaderButtonProps['variant'];
  /** MUI color for the PRIMARY rendering. Ignored inside the menu. */
  color?: HeaderButtonProps['color'];
}

/** Props for {@link HeaderActions}. */
export interface HeaderActionsProps {
  /**
   * The actions, in priority order — the first is the one that stays a button.
   *
   * `false`/`null`/`undefined` entries are dropped, so a caller can write
   * `[edit, canDelete && del]` without pre-filtering.
   */
  actions: Array<HeaderActionItem | false | null | undefined>;
  /**
   * The overflow trigger's label, which is also its accessible name. REQUIRED:
   * this package ships no copy of its own, in any language.
   */
  moreLabel: string;
  /** Width below which every button collapses to icon-only. @default 'md' */
  collapseBelow?: HeaderButtonProps['collapseBelow'];
  /**
   * Prefix for the overflow trigger's and menu's own test ids. The ACTIONS
   * keep their own ids either way. @default 'header-actions'
   */
  testIdPrefix?: string;
}
