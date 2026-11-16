/**
 * The helper text's id first, then a caller's (`total-form`'s `SelectField`
 * passes its error message's): a caller's id used to replace the helper's on
 * the menu and to be dropped by the search box.
 *
 * Space-separated element ids for an `aria-describedby`, blanks dropped, or
 * `undefined` when none is left, so the attribute is not written empty.
 */
export function joinIds(...ids: (string | undefined)[]): string | undefined {
  const kept = ids.map((id) => id?.trim()).filter(Boolean);
  return kept.length > 0 ? kept.join(' ') : undefined;
}
