import * as React from 'react';

import type { DialogBaseProps } from './Dialog.base';

/**
 * The defaults, and the slot detection, BOTH renderers run.
 *
 * Neither imports a renderer: the defaults are plain values and the slot check
 * is told which component identities count, because `DialogContent` on the web
 * and `DialogContent` on React Native are different functions answering to the
 * same name.
 */

type DialogDefaultedKeys =
  | 'variant'
  | 'size'
  | 'showCloseButton'
  | 'backdrop'
  | 'persistent'
  | 'glass'
  | 'gradient'
  | 'glow'
  | 'pulse'
  | 'borderRadius';

export const DIALOG_DEFAULTS: Required<Pick<DialogBaseProps, DialogDefaultedKeys>> = {
  variant: 'default',
  size: 'md',
  showCloseButton: true,
  backdrop: true,
  persistent: false,
  glass: false,
  gradient: false,
  glow: false,
  pulse: false,
  borderRadius: 'lg',
};

/** The renderer's own props with every defaulted field guaranteed present. */
export type DialogPropsWithDefaults<P extends DialogBaseProps> = P &
  Required<Pick<DialogBaseProps, DialogDefaultedKeys>>;

/**
 * Apply {@link DIALOG_DEFAULTS} exactly like parameter defaults would: only a
 * missing/`undefined` prop falls back (a loop, so the component's cyclomatic
 * complexity doesn't pay one branch per defaulted prop).
 */
export function withDialogDefaults<P extends DialogBaseProps>(props: P): DialogPropsWithDefaults<P> {
  const merged = { ...props } as Record<string, unknown>;
  for (const [key, value] of Object.entries(DIALOG_DEFAULTS)) {
    if (merged[key] === undefined) merged[key] = value;
  }
  return merged as unknown as DialogPropsWithDefaults<P>;
}

/**
 * Does this hand us a spacing slot? Fragments are transparent: `<>` is a way of
 * passing several children, not a child that owns them, and a consumer who
 * groups a `DialogContent` and a `DialogActions` in one has still passed both.
 *
 * Only the slots themselves count, and only at the top. A `DialogContent`
 * genuinely nested inside a `<div>` is that div's content, and the dialog
 * padding the div is right.
 *
 * `slots` is passed in rather than closed over so the two renderers can hand it
 * their own `DialogContent` / `DialogActions`.
 */
export function hasSpacingSlot(children: React.ReactNode, slots: readonly unknown[]): boolean {
  return React.Children.toArray(children).some((child) => {
    if (!React.isValidElement(child)) return false;
    if (slots.includes(child.type)) return true;
    if (child.type !== React.Fragment) return false;
    return hasSpacingSlot((child.props as { children?: React.ReactNode }).children, slots);
  });
}
