import type { UpdateState } from "./manager";

/**
 * The strip across the top of the agent's window when a new version is on its
 * way.
 *
 * A menu can report the updater, but nobody opens a menu to find out: the
 * update belongs on screen the moment the program is opened, with a button.
 * So a version downloading says so, and a version on disk offers the restart
 * there and then — the same `install()` as any menu's "restart and update".
 * Every other state is nothing to show.
 *
 * Every word is the host's: this decides WHICH sentence and whether there is a
 * button, never what either says.
 */

export interface UpdateBannerCopy {
  downloading: (version: string, percent: number | null) => string;
  ready: (version: string) => string;
  install: string;
  /** Under a ready version: what pressing the button does to the machine. */
  restartHint: string;
}

export interface UpdateBanner {
  text: string;
  /** The button's label, when there is something to press. */
  action: string | null;
  hint: string | null;
}

export function updateBanner(state: UpdateState, copy: UpdateBannerCopy): UpdateBanner | null {
  switch (state.kind) {
    case "downloading":
      return { text: copy.downloading(state.version, state.percent), action: null, hint: null };
    case "ready":
      return { text: copy.ready(state.version), action: copy.install, hint: copy.restartHint };
    default:
      return null;
  }
}
