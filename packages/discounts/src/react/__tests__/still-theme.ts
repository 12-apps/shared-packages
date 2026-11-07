import { createTheme } from "@12-apps/ui/mui/styles";

/**
 * A theme whose transitions take no time, for suites that open and close the
 * discount dialog in every case (FUT-4530).
 *
 * jsdom runs MUI's slide and fade on real timers, so each open and each
 * close-after-save waited out its duration before the next query could see
 * the result. Nothing those suites assert depends on an animation: they read
 * what the dialog holds and what Salvar sends.
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
});
