/**
 * WEB ATTRIBUTES REACT NATIVE DOES NOT DECLARE.
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
  /**
   * A field's validity and whether it must be filled. React Native's
   * `accessibilityState` has neither — its five flags are disabled, selected,
   * checked, busy and expanded — so these are web-only, and a device reads the
   * error text instead. react-native-web forwards both.
   */
  'aria-invalid'?: boolean;
  'aria-required'?: boolean;
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

/**
 * `disabled` for a react-native-web form control.
 *
 * React Native's `TextInput` has `editable` and no `disabled`, because a
 * device has no disabled state to speak of — an uneditable field simply does
 * not take the keyboard. The DOM does: only a real `disabled` attribute takes
 * an `<input>` out of the tab order, and it is what `toBeDisabled()` reads. So
 * a native field spreads this ALONGSIDE `editable={false}` and
 * `aria-disabled`: react-native-web puts the attribute on the input, and a
 * device ignores a prop it does not know.
 */
export function webDisabled(disabled: boolean): object {
  return disabled ? { disabled: true } : {};
}

/**
 * `onClick` for a react-native-web element whose React Native twin has no
 * click of its own.
 *
 * react-native-web's `TextInput` forwards `onClick` to the DOM input and drops
 * `onPressIn`; a device does the opposite. A field that must answer a press on
 * both renderers spreads this ALONGSIDE `onPressIn`, and exactly one of the two
 * fires on each side — never both.
 */
export function webClick<E>(handler: ((event: E) => void) | undefined): object {
  return handler === undefined ? {} : { onClick: handler };
}

/**
 * A `role` React Native's own union does not carry.
 *
 * `Role` (0.83) stops at `list` and `menu`: `listbox`, the role a dropdown's
 * option list owes a screen reader, is not in it. react-native-web forwards
 * whatever string it is given, and a device ignores a role it does not know —
 * the same trade `webAria` makes for the attributes below it.
 */
export function webRole(role: string): object {
  return { role };
}

/** The half of a DOM keyboard event a component needs, without the DOM lib. */
export interface WebKeyEvent {
  key: string;
}

/**
 * `onKeyDown` for a react-native-web element.
 *
 * React Native has no key events on a `View` — a phone has no keyboard to
 * press Escape on — so nothing here is typed by react-native and nothing here
 * fires on a device. react-native-web forwards it to the DOM, which is what
 * lets a native dropdown still answer Escape and the arrow keys in a browser.
 */
export function webKeyDown(handler: (event: WebKeyEvent) => void): object {
  return { onKeyDown: handler };
}
