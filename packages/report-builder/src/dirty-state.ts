/**
 * Has this report changed since it was last saved? (FUT-391)
 *
 * The plan's acceptance is the whole design: **dragging a block and dropping it
 * where it started must leave the report clean**. That rules out the obvious
 * implementation — a `setDirty(true)` on every edit callback — because a drag
 * that lands in place, a resize back to the same width and a name retyped to
 * what it already was all fire those callbacks while changing nothing.
 *
 * So dirtiness is a COMPARISON against the last-saved baseline, not a flag an
 * edit raises. The cost is a structural compare per keystroke; the benefit is
 * that "unsaved changes" means what it says, and a navigation guard built on it
 * never blocks someone who has changed nothing. A guard that cries wolf is one
 * people learn to click through, which loses the edit it existed to protect.
 */

/**
 * Structural equality over the JSON shapes a draft is made of.
 *
 * `JSON.stringify` would be shorter and wrong: it is key-order sensitive, so
 * `{a,b}` and `{b,a}` — the same draft rebuilt by a setter that spreads in a
 * different order — would compare as different and mark a clean report dirty.
 * That is exactly the false positive this module exists to avoid.
 */
function sameArray(a: readonly unknown[], b: unknown): boolean {
  if (!Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, index) => deepEqual(item, b[index]));
}

function sameObject(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  // An explicit `undefined` and an absent key mean the same thing in a draft —
  // `{title: undefined}` is the shape a cleared optional field takes, and
  // treating it as different from `{}` marks a no-op edit dirty. Walking the
  // UNION of both key sets is what makes those compare equal.
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}

function bothObjects(a: unknown, b: unknown): boolean {
  return typeof a === 'object' && a !== null && typeof b === 'object' && b !== null;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // NaN never equals itself, but two drafts both carrying NaN are unchanged.
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (!bothObjects(a, b)) return false;
  // An array is never equal to a plain object, even one with numeric keys.
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return sameArray(a, b);
  return sameObject(a as object, b as object);
}

/**
 * Whether the working copy differs from the baseline in any way that would be
 * SAVED. Anything the save payload does not carry — a period selection, which
 * block is selected, whether a panel is open — must not be part of `current`,
 * or the guard fires on choosing a different date range.
 */
export function isDirty<T>(saved: T, current: T): boolean {
  return !deepEqual(saved, current);
}
