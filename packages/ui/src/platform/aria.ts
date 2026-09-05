/**
 * ARIA ATTRIBUTES REACT NATIVE DOES NOT DECLARE.
 *
 * React Native's `ViewProps` (0.83) type a dozen `aria-*` props and stop:
 * `aria-level`, `aria-atomic` and `aria-describedby` are not among them.
 * react-native-web forwards all three to the DOM — and `aria-level` also
 * picks the heading tag, so a `role="heading"` at level 3 renders an `<h3>`
 * exactly as the MUI half's `component="h3"` does — while a device ignores
 * them. A native component spreads them through here rather than widening
 * the element's props type or casting at every call site.
 */
export interface WebAria {
  'aria-level'?: 1 | 2 | 3 | 4 | 5 | 6;
  'aria-atomic'?: 'true' | 'false';
  'aria-describedby'?: string;
}

/**
 * `attrs` as something JSX can spread onto a react-native element without
 * that element's props type having to know them.
 *
 * `aria-atomic` travels under react-native-web's own older name. Its
 * `createDOMProps` (0.20.0) reads `aria-activedescendant` where it means
 * `aria-atomic` — `_ariaAtomic = ariaAtomic != null ? ariaActiveDescendant :
 * accessibilityAtomic` — so the modern spelling never reaches the DOM and
 * the legacy one, still accepted and still emitted as `aria-atomic`, does.
 * Neither name exists on a device, so nothing is lost there.
 */
export function webAria(attrs: WebAria): object {
  const { 'aria-atomic': atomic, ...rest } = attrs;
  return atomic === undefined ? rest : { ...rest, accessibilityAtomic: atomic };
}
