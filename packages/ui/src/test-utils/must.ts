/**
 * Narrows an indexed/optional read to its defined value, or fails loudly.
 *
 * Under this project's `noUncheckedIndexedAccess`, `array[i]` (and similar
 * "might not be there" reads coming out of Testing Library, e.g.
 * `getAllByRole(...)[i]`) types as `T | undefined`. A story's `play` function
 * knows the element exists — that is what the test is asserting — so this
 * turns the type-level "might be missing" into a real, test-failing error
 * instead of silencing it with a non-null assertion (`!`).
 */
export function must<T>(value: T | undefined | null, description = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${description} to be defined`);
  }
  return value;
}
