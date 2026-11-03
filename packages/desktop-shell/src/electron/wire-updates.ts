import type { Telemetry } from "../telemetry";
import {
  createAutoInstall,
  updateBanner,
  type AppMenuItem,
  type MenuCopy,
  type UpdateBanner,
  type UpdateBannerCopy,
  type UpdateManager,
  type UpdateState,
} from "../updates";
import { installAppMenu, type AppMenu } from "./app-menu";

/**
 * The updater, the menu bar that reports on it, and the moments it asks —
 * plus breadcrumbs for the crash reports and an update that installs itself.
 *
 * Call it BEFORE `startDesktopShell`: the shell opens its first window during
 * start-up, and a window created ahead of the menu wears Electron's default
 * `File Edit View Window Help`.
 *
 * The manager handed back installs through ONE path — the host's button, the
 * menu, the manual check's box and the automatic restart alike — and that path
 * writes the target version into the session marker first
 * (`telemetry.installing`), so a restart that comes back as the old version is
 * reported (`../telemetry`).
 */
export type WireUpdatesOptions = WireUpdatesBaseOptions &
  (WireUpdatesMenuOptions | WireUpdatesNoMenuOptions) &
  (WireUpdatesBannerOptions | WireUpdatesNoBannerOptions);

/** What the host passes whether or not it has a menu bar. */
export interface WireUpdatesBaseOptions {
  /**
   * Build the host's `UpdateManager` around the listener this wiring needs.
   *
   * A construction seam rather than a manager: `UpdateManager` has no
   * subscription after it is built, and every state change must reach the
   * menu, the banner, the breadcrumbs and auto-install.
   */
  create: (onState: (state: UpdateState) => void) => UpdateManager;
  telemetry: Pick<Telemetry, "breadcrumb" | "installing" | "failedInstall">;
  /** Whether work a restart must not cut is running — see `createAutoInstall`. */
  busy: () => boolean;
  /** The "update by itself" switch, read at the moment of the attempt. */
  autoUpdate: () => boolean;
  /**
   * Register a listener for "the host's window was just shown": this wiring
   * asks for an update then. Shown, not loaded — a tray agent hides its window
   * on close and raises the same one again, so a check hung on the load would
   * run once per process.
   */
  onWindowShown?: (listener: () => void) => void;
}

/** The window strip: its words and the way it reaches the host's window, together. */
export interface WireUpdatesBannerOptions {
  /** The window strip's words — see `updateBanner`. */
  bannerCopy: UpdateBannerCopy;
  /**
   * Put the strip on the host's window, on every state change. `null` is
   * nothing to show. How it reaches the window (a channel, which window) is
   * the host's.
   */
  showBanner: (banner: UpdateBanner | null) => void;
}

/** No strip: neither the words nor the way to show them. */
export interface WireUpdatesNoBannerOptions {
  bannerCopy?: never;
  showBanner?: never;
}

/** The default: the shell installs the application menu and keeps it current. */
export interface WireUpdatesMenuOptions {
  /** Omit, or `true`, to get the application menu. */
  menu?: true;
  /** Every word of the menu bar and the manual check; `updates` is the updater's. */
  menuCopy: MenuCopy;
  /** The host's own File entries, placed before Quit. */
  extraMenuItems?: readonly AppMenuItem[];
}

/**
 * For a host that has no application menu on purpose (every key belongs to its
 * page): `installAppMenu` is never called and nothing is rendered on a state
 * change. The install path, auto-install, breadcrumbs, banner and
 * `onWindowShown` behave as with a menu. Its words and entries have nowhere to
 * go, so the type refuses them. `menu: false` leaves the menu bar to the host;
 * remove Electron's default with `Menu.setApplicationMenu(null)`.
 */
export interface WireUpdatesNoMenuOptions {
  menu: false;
  menuCopy?: never;
  extraMenuItems?: never;
}

export function wireUpdates(options: WireUpdatesOptions): UpdateManager {
  const { telemetry } = options;
  const menuRef: { current: AppMenu | null } = { current: null };
  const last = { crumb: "" };

  const installNow = async (): Promise<void> => {
    const state = inner.state;
    if (state.kind !== "ready") return;
    telemetry.breadcrumb(`installing ${state.version}`);
    await telemetry.installing(state.version);
    inner.install();
  };
  const autoInstall = createAutoInstall({
    autoUpdate: options.autoUpdate,
    busy: options.busy,
    failedBefore: () => telemetry.failedInstall(),
    install: () => void installNow(),
  });

  const inner = options.create((state) => {
    menuRef.current?.render(state);
    if (options.showBanner) options.showBanner(updateBanner(state, options.bannerCopy));
    const crumb = updateCrumb(state);
    if (crumb !== last.crumb) telemetry.breadcrumb(crumb);
    last.crumb = crumb;
    autoInstall(state);
  });
  const updates: UpdateManager = {
    get state() {
      return inner.state;
    },
    check: (checkOptions) => inner.check(checkOptions),
    install: () => void installNow(),
    stop: () => inner.stop(),
  };

  if (options.menu !== false) {
    menuRef.current = installAppMenu({
      copy: options.menuCopy,
      updates,
      ...(options.extraMenuItems === undefined ? {} : { extraMenuItems: options.extraMenuItems }),
      onMenu: (open) => telemetry.breadcrumb(open ? "menu open" : "menu closed"),
    });
  }
  // Opening the window is the "every time I open it" half of a daily
  // cadence; the start-up half is the host's own check after sign-in.
  options.onWindowShown?.(() => {
    telemetry.breadcrumb("window shown");
    void updates.check();
  });
  return updates;
}

/** A download reported in tens, so a breadcrumb trail is not thirty percents. */
function updateCrumb(state: UpdateState): string {
  if (state.kind === "downloading") {
    const tens = state.percent === null ? "…" : `${Math.floor(state.percent / 10) * 10}%`;
    return `update downloading ${state.version} ${tens}`;
  }
  return "version" in state ? `update ${state.kind} ${state.version}` : `update ${state.kind}`;
}
