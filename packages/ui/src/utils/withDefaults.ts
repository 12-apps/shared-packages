/**
 * Fills in the defaults for props the caller left `undefined`.
 *
 * A table plus one loop, rather than a `= default` per destructured prop. Each
 * of those defaults is a branch, and a component with fifteen of them is over
 * the cyclomatic bar before it renders anything.
 *
 * Only `undefined` is replaced, so an explicit `prop={undefined}` still falls
 * back to the default exactly as a destructuring default would, while an
 * explicit `null`, `0`, `''` or `false` is preserved as the caller's choice.
 */
export function withDefaults<T extends object>(props: T, defaults: Partial<T>): T {
  const resolved = { ...props };
  for (const [key, value] of Object.entries(defaults)) {
    if (resolved[key as keyof T] === undefined) {
      Object.assign(resolved, { [key]: value });
    }
  }
  return resolved;
}
