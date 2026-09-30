import type { UpdateState } from "./manager";

/**
 * Drawing the updater into an application menu without crashing it.
 *
 * An application menu is rebuilt from scratch on every change it shows, and a
 * download reports progress several times a second. Replacing the menu that
 * often — and above all while one of its popups is OPEN — crashed a Windows
 * agent twice, each time somebody opened the menu during a download. The two
 * halves below are the fix: draw less often, and never under an open popup.
 */

/**
 * The updater state as a MENU shows it: a download without its percent.
 *
 * A percent in a menu nobody holds open is not worth a rebuild several times
 * a second. The window's strip (`updateBanner`) carries the percent, live,
 * without touching the menu.
 */
export function menuUpdateState(state: UpdateState): UpdateState {
  return state.kind === "downloading" ? { ...state, percent: null } : state;
}

/** Whether two states would draw the same menu — rebuild only when not. */
export function sameMenu(a: UpdateState | null, b: UpdateState): boolean {
  return a !== null && JSON.stringify(menuUpdateState(a)) === JSON.stringify(menuUpdateState(b));
}

/**
 * Holds a menu rebuild back while the menu is OPEN.
 *
 * Rebuilding only when the text changes ({@link sameMenu}) makes the crash
 * rare; this makes it impossible: a state that arrives while a menu is open is
 * drawn when the menu closes, and only the newest one. Wire `opened`/`closed`
 * to the menu's `menu-will-show`/`menu-will-close`.
 */
export interface MenuGate<T> {
  /** A state to draw: answered now when the menu is closed, else held (`null`). */
  offer(state: T): T | null;
  opened(): void;
  /** The held state, if any, to draw now that the menu has closed. */
  closed(): T | null;
}

export function createMenuGate<T>(): MenuGate<T> {
  let open = 0;
  let held: { state: T } | null = null;
  return {
    offer(state) {
      if (open === 0) return state;
      held = { state };
      return null;
    },
    opened() {
      open += 1;
    },
    closed() {
      open = Math.max(0, open - 1);
      if (open > 0 || held === null) return null;
      const { state } = held;
      held = null;
      return state;
    },
  };
}
