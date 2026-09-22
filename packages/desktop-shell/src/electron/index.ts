/**
 * `@12-apps/desktop-shell/electron` — the adapter.
 *
 * Everything Electron-shaped lives behind this subpath so the rest of the
 * package stays testable in a plain Node process. The split is not
 * bookkeeping: `electron` cannot be imported outside an Electron runtime at
 * all, so a single stray import in the core would take the whole package's
 * test suite down with it.
 *
 * What is here is deliberately GLUE. Every decision it makes —  what the menu
 * contains, whether a window may open, what the tray says — is a pure function
 * from one of the other subpaths, asserted there.
 */
export { BACKGROUND_FLAG, startedInBackground } from "./background";
export {
  buildTrayMenu,
  type TrayActions,
  type TrayCopy,
  type TrayMenuInput,
  type TrayMenuItem,
} from "./tray-menu";
export {
  startDesktopShell,
  type DesktopShell,
  type DesktopShellOptions,
  type ShellContext,
} from "./shell";
