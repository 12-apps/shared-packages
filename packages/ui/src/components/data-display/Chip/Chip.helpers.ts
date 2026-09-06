/** `${dataTestId}-label`, or `chip-label` when the caller named nothing. */
export const makeTestId =
  (dataTestId?: string) =>
  (suffix: string): string =>
    dataTestId ? `${dataTestId}-${suffix}` : `chip-${suffix}`;

/** `option` when the chip belongs to a selectable set, `button` when it merely acts. */
export const chipRole = (
  selectable?: boolean,
  // `unknown`, because the two renderers hand this a differently-typed handler
  // and all that is asked of it here is whether the caller supplied one.
  onClick?: unknown,
): 'option' | 'button' | undefined => {
  if (selectable) return 'option';
  return onClick ? 'button' : undefined;
};

export const isClickable = (
  disabled?: boolean,
  onClick?: unknown,
  selectable?: boolean,
): boolean => !disabled && (Boolean(onClick) || Boolean(selectable));

/** What a key press on a chip means, if anything. */
export type ChipKeyAction = 'delete' | 'activate' | null;

const DELETE_KEYS = new Set(['Delete', 'Backspace']);
const ACTIVATE_KEYS = new Set(['Enter', ' ']);

export interface ChipKeyArgs {
  disabled?: boolean;
  deletable?: boolean;
  selectable?: boolean;
  onClick?: unknown;
  onDelete?: unknown;
}

/**
 * A chip is not a native control, so the two keyboard conventions it stands in
 * for are decided by hand: Delete/Backspace removes it, Enter/Space activates
 * it. Both renderers read this one decision — the web wires it to the DOM
 * handler, the native half to react-native-web's (see `Chip.native.tsx`).
 */
export function chipKeyAction(key: string, a: ChipKeyArgs): ChipKeyAction {
  if (a.disabled) return null;
  if (DELETE_KEYS.has(key) && a.deletable && a.onDelete) return 'delete';
  if (ACTIVATE_KEYS.has(key) && (a.onClick || a.selectable)) return 'activate';
  return null;
}
