import * as React from 'react';
import {
  Keyboard,
  Platform,
  type KeyboardEvent,
  type KeyboardEventName,
  type LayoutChangeEvent,
} from 'react-native';

/**
 * HOW FAR THE SOFT KEYBOARD COVERS A FULL-WINDOW VIEW, AND NOTHING MORE.
 *
 * React Native's `Modal` asks Android for `SOFT_INPUT_ADJUST_RESIZE`, and under
 * edge-to-edge that asks for nothing: the window keeps its full height and the
 * keyboard is drawn over it. iOS never resized a modal at all. So an overlay
 * that fills the modal has its bottom under the keyboard, and whatever sits
 * there — a dialog's actions — is hidden until the keyboard goes away.
 *
 * This reads the keyboard's own top edge from the `Keyboard` events and the
 * view's own bottom edge from its layout, and answers the difference. Reading
 * the OVERLAP rather than the keyboard's height is what keeps it right when the
 * window DID resize (a host that is not edge-to-edge): the view then already
 * ends at the keyboard, the overlap is zero, and nothing is lifted twice. No
 * soft-input mode is set here, deliberately — a second one would fight the one
 * `Modal` already asks for.
 *
 * The view's layout `y` is relative to its parent, so the view is expected to
 * be the root of a window that starts at the top of the screen — which a
 * `transparent` modal is, on iOS and under Android edge-to-edge alike.
 */
export function keyboardOverlap(viewBottom: number | null, keyboardTop: number | null): number {
  if (viewBottom === null || keyboardTop === null) return 0;
  return Math.max(0, viewBottom - keyboardTop);
}

/** iOS announces the keyboard before it moves; Android only once it has. */
const KEYBOARD_EVENTS: { show: KeyboardEventName; hide: KeyboardEventName } =
  Platform.OS === 'ios'
    ? { show: 'keyboardWillShow', hide: 'keyboardWillHide' }
    : { show: 'keyboardDidShow', hide: 'keyboardDidHide' };

export interface KeyboardOverlap {
  /** How many dp of the view the keyboard covers; `0` while it is down. */
  overlap: number;
  /** Goes on the view being measured. */
  onLayout: (event: LayoutChangeEvent) => void;
}

/**
 * The keyboard's overlap with the view `onLayout` is put on. Android re-sends
 * `keyboardDidShow` when the keyboard changes height while it stays up (an
 * emoji panel, a suggestion strip), so the overlap follows those too.
 */
export function useKeyboardOverlap(): KeyboardOverlap {
  const [viewBottom, setViewBottom] = React.useState<number | null>(null);
  const [keyboardTop, setKeyboardTop] = React.useState<number | null>(null);

  React.useEffect(() => {
    const shown = Keyboard.addListener(KEYBOARD_EVENTS.show, (event: KeyboardEvent) => {
      setKeyboardTop(event.endCoordinates.screenY);
    });
    const hidden = Keyboard.addListener(KEYBOARD_EVENTS.hide, () => {
      setKeyboardTop(null);
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const onLayout = React.useCallback((event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    setViewBottom(y + height);
  }, []);

  return { overlap: keyboardOverlap(viewBottom, keyboardTop), onLayout };
}
