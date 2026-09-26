/**
 * The pure half of `NumberField`: what a keystroke may add, what a string of
 * digits is worth, and where an arrow key lands. Kept apart from the component
 * so every rule is a plain function a unit test can hold.
 */

/**
 * The most digits the field keeps. Fifteen is the longest run that is always
 * a safe integer (`Number.MAX_SAFE_INTEGER` has sixteen, but not every
 * sixteen-digit number is below it), so a pasted serial number can never turn
 * into a rounded float.
 */
export const MAX_DIGITS = 15;

export interface NumberBounds {
  min?: number;
  max?: number;
}

/** Everything that is not a digit, removed; then cut to {@link MAX_DIGITS}. */
export function digitsOf(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, MAX_DIGITS);
}

/**
 * What the field's text is worth. An empty field is `null` — never `0`, and
 * never `NaN` — so "cleared" and "zero" stay two different answers.
 */
export function parseDigits(raw: string): number | null {
  const digits = digitsOf(raw);
  return digits === '' ? null : Number(digits);
}

/** The text a value shows as. */
export function formatValue(value: number | null): string {
  return value === null || !Number.isFinite(value) ? '' : String(value);
}

/** `value`, held inside whichever bounds are set. */
export function clamp(value: number, { min, max }: NumberBounds): number {
  if (max !== undefined && value > max) return max;
  if (min !== undefined && value < min) return min;
  return value;
}

/**
 * Where ArrowUp (`+1`) or ArrowDown (`-1`) takes the value.
 *
 * From empty, either arrow lands on the floor (`min`, else 0) rather than
 * stepping past it: the first press says "give me a number", and the floor is
 * the only one both directions agree on.
 */
export function stepValue(
  value: number | null,
  direction: 1 | -1,
  step: number,
  bounds: NumberBounds,
): number {
  if (value === null) return clamp(bounds.min ?? 0, bounds);
  return clamp(value + direction * step, bounds);
}

/**
 * A key that would type a character the field refuses. Shortcuts (Ctrl/Cmd +
 * a letter — copy, paste, select all) and the named keys (`Backspace`,
 * `ArrowLeft`, `Tab`) are left alone: only a single printable character that
 * is not a digit is blocked.
 */
export function isRefusedKey(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1 && !/\d/.test(event.key);
}
