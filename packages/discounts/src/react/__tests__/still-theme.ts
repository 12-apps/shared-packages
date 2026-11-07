import Fade from "@mui/material/Fade";
import { afterAll, beforeAll } from "vitest";

import { createTheme } from "@12-apps/ui/mui/styles";

/**
 * A theme whose transitions take no time, whose dialogs do not slide and whose
 * modals lock no scroll, for suites that open and close the discount dialog
 * in every case (FUT-4530).
 *
 * jsdom runs MUI's slide and fade on real timers, so each open and each
 * close-after-save waited out its duration before the next query could see
 * the result. Nothing those suites assert depends on an animation: they read
 * what the dialog holds and what Salvar sends.
 *
 * The scroll lock is the dearest part of every open that is left: MUI measures
 * `<body>` and `<html>` with `getComputedStyle` on each modal and menu open,
 * and jsdom answers each call by matching every one of the ~1,000 emotion
 * rules against the element and its ancestors, the `:has()` ones by searching
 * the whole subtree — the whole document, for `<html>`. 100–170 ms per open
 * alone, several times that on a loaded runner, for a lock on a page that
 * cannot scroll. `Menu` and `Dialog` reach `Modal` through `Popover` and
 * directly, so both defaults are set.
 *
 * The dialog's slide is the other: `Slide` reads the panel's computed
 * `transform` as it enters and twice as it leaves, three of those lookups on
 * the panel and its ancestors per case — 200 ms of a case alone, the largest
 * single cost left once the lock was gone. `StackedModal` hands `Dialog` its
 * slide as `TransitionComponent`, and `slots.transition` wins over it, so the
 * dialog fades instead: the same enter and exit callbacks the modal mounts and
 * unmounts its panel on, in no time and with no style lookup.
 */
export const STILL_THEME = createTheme({
  transitions: {
    create: () => "none",
    duration: {
      shortest: 0,
      shorter: 0,
      short: 0,
      standard: 0,
      complex: 0,
      enteringScreen: 0,
      leavingScreen: 0,
    },
  },
  components: {
    MuiModal: { defaultProps: { disableScrollLock: true } },
    MuiPopover: { defaultProps: { disableScrollLock: true } },
    MuiDialog: { defaultProps: { slots: { transition: Fade } } },
  },
});

/**
 * Give jsdom's `<html>` the root font size every browser has (FUT-4530).
 *
 * jsdom computes no `font-size` for the root, so `@12-apps/ui`'s `remPx`
 * finds nothing to cache and measures `<html>` again on every render of the
 * admin's grid — the dearest `getComputedStyle` there is, for the same 16 px
 * each time. With the browser's default set, it measures once per worker.
 */
export function browserRootFontForThisFile(): void {
  // Set for the file's suites and taken off after them, so nothing it changes
  // outlives the file. Register it before the file's other `beforeAll` hooks:
  // they run in order, and the warm-up mount needs the font in place.
  const root = document.documentElement;
  beforeAll(() => {
    root.style.setProperty("font-size", "16px");
  });
  afterAll(() => {
    root.style.removeProperty("font-size");
  });
}
