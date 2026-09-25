# Adopting @12-apps/desktop-shell

A **leaf library for a second process.** It mounts nothing in your web app: it
is consumed by an Electron main process that talks to your host over HTTP, so
there is no route to register, no table to migrate and no manifest to wire.
(Recorded as an argued exemption in `.wiring-conformance.json`.)

## The standardized surfaces

| Surface | Export | What the host does |
|---|---|---|
| **Status** | `@12-apps/desktop-shell` | `deriveShellStatus(state)` → the one word every surface says. `createSupervisor({ run })` keeps a loop alive with the same backoff curve `@12-apps/realtime` uses. |
| **Autostart** | `…/autostart` | `createAutostart({ platform, id, entry, backgroundArgs, loginItem, files })` → `{ isEnabled, enable, disable, set }`. |
| **Session** | `…/session` | `createSessionWatch({ jar, spec })` and `guardSession(fetch, onUnauthorized)`. |
| **Electron** | `…/electron` | `startDesktopShell(options)` → the tray, the windows, the single-instance lock. Returns `null` when this process is a second copy. |
| **Telemetry** | `…/telemetry`, `…/electron` | `startCrashReporting()` → `{ telemetry, started }`, before `app.whenReady()`. `telemetry.breadcrumb(text)` as things happen; `telemetry.flush(send)` whenever there is a session to send with. |
| **Updates** | `…/updates`, `…/electron` | `createUpdateManager({ updater: autoUpdater, cookie, platform, settings, onState })`; feed `onState` into `createAutoInstall({ autoUpdate, busy, failedBefore, install })`. |
| **Releases** | bin `desktop-shell-upload-release` | Run from CI after `electron-builder`, with `@aws-sdk/client-s3` in the host's devDependencies. |
| **Prisma** | — | **None.** This package owns no tables. |
| **Wiring manifest** | — | **None, deliberately.** Nothing here is wired into a web host. |

## What the host must supply

1. **The session cookie's NAME.** Taken as config rather than derived, because
   the derivation belongs to whichever auth library you run. An Auth.js host
   passes `sessionCookieName(...)` from `@12-apps/auth/server`, which mirrors
   the `__Secure-` prefix rule the server side already applies. A name guessed
   here would fail **silently** — the agent would report itself signed out
   while holding a perfectly good session.

2. **A copy pack and an icon per status.** `TrayCopy.status` is a record over
   every `ShellStatus`, so a state added upstream stops your build rather than
   rendering an empty tooltip.

3. **The work.** `onSignedIn(context)` is where your app starts. The context
   carries a `fetch` bound to the shell's partition (so the cookie rides every
   request), `setLink` and `setFault`.

## The five rules that bite

1. **Register the background flag, and read it.** `backgroundArgs:
   ["--background"]` is not decoration: it is the ONLY signal that exists on
   Windows and Linux for "the session started me". Without it every boot opens
   a window, which is the fastest way to get an agent uninstalled. macOS also
   answers `wasOpenedAtLogin`; pass both to `startedInBackground`.

2. **`Hidden=true` means switched OFF.** The XDG key reads like "start
   invisibly" and means the opposite. `desktopEntryFile` writes `Hidden=false`
   and a test pins it.

3. **Quote the Exec path.** Done for you — and the reason is a home directory
   with a space in it, where an unquoted entry starts `/home/maria` and reports
   nothing at all.

4. **Windows hide, they do not close.** The shell intercepts every `close`.
   Do not add `app.quit()` to a window handler: the tray's Quit is the only
   way out, and `window-all-closed` is deliberately a no-op.

5. **Read the autostart state BACK after setting it.** Every platform can
   refuse silently — a policy, a read-only home, a sandbox — and a checkbox
   that ticks itself on a change that did not happen is worse than one that
   refuses to move. `startDesktopShell` does this; a host driving `createAutostart`
   directly must too.

## Wiring the updater

```ts
import { autoUpdater } from "electron-updater";
import { createAutoInstall, createUpdateManager } from "@12-apps/desktop-shell/updates";
import {
  sessionCookieReader,
  startCrashReporting,
  updaterFileLogger,
  type SessionRef,
} from "@12-apps/desktop-shell/electron";

const { telemetry } = startCrashReporting();
const sessionRef: SessionRef = { current: null }; // set in onSignedIn
autoUpdater.logger = updaterFileLogger();

const updates = createUpdateManager({
  updater: autoUpdater,
  cookie: sessionCookieReader(sessionRef, cookieName), // omit for a public feed
  platform: process.platform,
  settings: () => ({ autoUpdate: prefs.autoUpdate, feedUrl: feedFor(prefs) }),
  onState: createAutoInstall({
    autoUpdate: () => prefs.autoUpdate,
    busy: () => workInProgress,
    failedBefore: () => telemetry.failedInstall(),
    install: async (version) => {
      await telemetry.installing(version);
      updates.install();
    },
  }),
});
```

Four things to get right:

1. **The feed URL is yours.** `settings().feedUrl` is read before every check,
   so it can depend on who is signed in. `null` means "nothing to ask yet" and
   answers `idle`, not `failed`.
2. **Call `telemetry.installing(version)` before `updates.install()`.** It is
   the only way the next start can tell a failed install from a clean one.
3. **Gate the menu.** A host that draws the updater into an application menu
   rebuilds only when `sameMenu` says it changed, and through `createMenuGate`
   wired to `menu-will-show`/`menu-will-close` — replacing a menu under an open
   popup crashes Windows.
4. **Crash reporting takes the single-instance lock first.** Call it before
   `startDesktopShell`; a second copy then leaves the running copy's marker
   alone, and an update's relaunch waits for the old process to let go.

## Packaging

This package ships TypeScript source, like the rest of the repo. Bundling the
main process (esbuild/electron-vite) and producing installers
(`electron-builder`) is the host's, because the artefact is branded: an icon, a
product name, a signing certificate and an update feed are all things a library
cannot own. Uploading the artefacts is not: `desktop-shell-upload-release` reads
`S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (and optionally
`S3_REGION`, `S3_ENDPOINT`, `S3_FORCE_PATH_STYLE=1`) and uploads each file
under `<key-prefix>/`, installer before channel file in the order given.

**Unsigned builds run but are refused-looking.** Windows SmartScreen shows an
"unrecognized app" wall and macOS Gatekeeper refuses an un-notarized bundle
outright. For a shop owner, either is where the feature ends. That is a
certificate and a release pipeline, not code.
