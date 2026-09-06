/**
 * KEY EVENTS REACT NATIVE DOES NOT DECLARE.
 *
 * There is no `onKeyDown` on React Native's `ViewProps` or `PressableProps`,
 * because there is no keyboard behind a `View` on a device. react-native-web
 * DOES forward one to the DOM, and a component that stands in for a native
 * control — a chip that removes on Delete, a listbox option that activates on
 * Space — carries those conventions as part of its contract on the web.
 *
 * `webKeyDown` spreads the handler onto a react-native element without that
 * element's props type having to know it, the way `./aria.ts` does for the
 * `aria-*` attributes React Native leaves out. On a device it is simply never
 * called, which is the honest outcome: the gesture is the input there.
 *
 * The event is typed structurally rather than as a DOM `KeyboardEvent`, because
 * the native type program is checked WITHOUT the DOM lib.
 */
export interface WebKeyEvent {
  key: string;
  preventDefault: () => void;
}

export type WebKeyHandler = (event: WebKeyEvent) => void;

/** `{ onKeyDown }` as something JSX can spread onto a react-native element. */
export function webKeyDown(handler: WebKeyHandler | undefined): object {
  return handler === undefined ? {} : { onKeyDown: handler };
}
