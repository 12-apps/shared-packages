# `@12-apps/pwa`

Making a web app installable, and telling people it is.

Captures `beforeinstallprompt` without ever firing it, recognises the iOS
browsers where installation is a manual share-sheet action, and ships an invite
that leads with the reason rather than the instruction. Host-agnostic: every
string comes from an overridable pt-BR messages layer.

## Usage

```tsx
import { InstallInvite } from "@12-apps/pwa/react";
import { reportWarning } from "@12-apps/observability-frontend";

<InstallInvite
  what={store.displayName}
  enabled={isStoreOwnDomain}
  onDiagnostic={reportWarning}
/>
```

| entry | what it is |
|---|---|
| `@12-apps/pwa` | `useInstallPrompt`, `isIosInstallable`, `isStandalone`, `isHandheld`, the messages layer, `registerServiceWorker` / `postToServiceWorker`, and the **reload** half — `needsPullToRefresh`, `isInstalledHandheld`, `reloadApp`, `createPullTracker` |
| `@12-apps/pwa/react` | `InstallInvite`, `ShareIcon`, `PullToRefresh` |
| `@12-apps/pwa/server` | `createApiPwa({ resolveApp })` — the per-host **manifest endpoint** and the packaged service worker; also `buildWebAppManifest` and `pwaServiceWorkerSource` |
| `@12-apps/pwa/hono` | `pwaRouter({ resolveApp })`, mounted at the origin root. `hono` is an OPTIONAL peer |

The root entry is framework-free, so a host that only needs "can this be
installed" does not pull React in through a barrel it did not ask for.

**[ADOPTING.md](./ADOPTING.md) is the adoption contract** — the config table and
the five wiring rules that bite.

## What makes an app installABLE (12-23)

The invite above only *asks*. Two things have to exist first, and both ship here:

1. **A manifest, as an ENDPOINT — never a static file.** A PWA's identity IS its
   origin, and a bundle has exactly one `index.html` for every tenant it serves,
   so a static `manifest.webmanifest` cannot vary by the store the visitor is
   looking at. `resolveApp` returning `null` is a 404, and that 404 is the whole
   installability gate.
2. **A REGISTERED service worker, on every visit.** `registerServiceWorker()`
   belongs at app boot, not behind a settings screen: the origin host registered its
   worker only from `enableWebPush()`, so a visitor who never opened notification
   preferences had no worker — and the browser never offered to install the store.

```ts
const pwa = pwaRouter({ resolveApp: ({ host }) => appForHost(host) });
app.route('/', pwa.router);           // the manifest, at the ORIGIN ROOT
registerServiceWorker();              // in the SPA's entry, once
```

**The packaged worker is network-first for documents, and that is not a
preference.** Every hashed filename in a bundled SPA dies with the deploy that
produced it, and a history fallback answers a vanished chunk with `index.html` —
which fails on the MIME type, reaches `React.lazy`, and renders the page blank. A
naive cache-first worker pins that old shell and makes the blank page PERMANENT;
on an installed app "force-refresh" is advice the user cannot follow.

## Getting the reload back

Installing the app takes the address bar away, and with it the reload button —
which is fine right up to the moment the app is wedged: a shell from an old
deploy, a session that expired without the page noticing, a screen whose one
fetch failed. This package already says what that costs, in rule 5 of
[ADOPTING.md](./ADOPTING.md): *on an installed app "force-refresh" is advice the
user cannot follow.* The worker fixes the half that can be fixed without the
user. `PullToRefresh` is the other half.

```tsx
import { PullToRefresh } from "@12-apps/pwa/react";
import { PULL_TO_REFRESH_MESSAGES } from "@12-apps/pwa";

<PullToRefresh messages={PULL_TO_REFRESH_MESSAGES["pt-BR"]} onDiagnostic={reportWarning}>
  <App />
</PullToRefresh>
```

**Wrapping the whole app costs nothing where it is not needed**, because there
it mounts nothing at all. `needsPullToRefresh()` is the gate, and it is true on
exactly one combination:

| where | has a reload? | why |
|---|---|---|
| any browser tab | yes | address bar, plus the browser's own overscroll refresh |
| Chromium standalone (Android) | yes | **it keeps that overscroll refresh when installed** — unless the app itself opted out with `overscroll-behavior-y: contain \| none` |
| desktop standalone | yes | no address bar, but `Ctrl+R` and a context menu |
| **iOS home screen** | **no** | no chrome, and the pull gesture that reloads in Safari does not reload a standalone web app. The workaround in the wild is *delete the icon and add it again* |

So by default the gesture ships to iOS and nowhere else — not because it would
be *unsafe* elsewhere, but because a platform gesture that already works has
native feel and haptics and cannot be lost to a JavaScript failure.

**To use it on Android too, pass `platform={isInstalledHandheld}`.** That is a
supported choice, not a workaround, and the handover is clean rather than
doubled: mounting sets `overscroll-behavior-y: contain`, which is exactly the
property that switches Chromium's own overscroll refresh off. One pull, one
gesture, and it is yours — same indicator and same threshold on both platforms.
It also fails in the safe direction: if the bundle never runs, the property is
never set and Chromium's gesture is still there.

Reach for it when you want one gesture to design and support across every phone,
or for an Android browser whose installed apps do *not* keep the native one.
Note what you give up: on Android you are replacing a gesture the platform
maintains with one you maintain.

`isInstalledHandheld` deliberately excludes a DESKTOP installed app — no address
bar, but `Ctrl+R`, a context menu, and no touchscreen to pull on. An end-to-end
test driving a desktop browser passes `() => true`.

### `reloadApp()` is not quite `location.reload()`

The open document is controlled by whichever worker was active when it loaded,
and the browser's own update check races the navigation rather than preceding
it — so a reload issued the moment a deploy lands can still be served by the
outgoing worker, handing back the very shell the user was trying to escape.
`reloadApp()` asks for the update first and waits for it, bounded (2s by
default) because the person who just pulled down is usually the person whose
network is having a bad day. Every failure path still reloads: a reload the user
asked for is never something the app declines to do.

### What the gesture will not take

Three things it must not break, each prevented by construction rather than by a
check somebody has to remember:

- **Scrolling.** The first 12px of travel are *watched and not consumed* —
  `preventDefault()` is called only once the tracker claims the gesture, which
  it never does for a finger moving up or sideways.
- **Anything in a portal.** The listeners are on the component's own subtree,
  so a MUI `Drawer` or `Dialog` — rendered into `document.body`, a sibling of
  everything inside — cannot reach them.
- **Nested scrollers.** A list already scrolled down keeps its own pull. A
  region that wants its vertical drags for something else says so in the markup:
  `data-pull-refresh="off"`.

The wrapper is `display: contents`, so it changes no layout: children stay their
parent's own flex or grid items. `offsetTop` and `zIndex` place the indicator
above the host's fixed chrome — exposed rather than hard-coded, because the app
that adopted the install invite had to override *its* fixed placement with
`!important`.

## Two platforms that share nothing

**Chromium** fires `beforeinstallprompt`, which is captured and **held** — never
fired automatically. A browser lets a page ask once, and asking on a first
visit, before the visitor knows what the app is, spends that one chance on a
near-certain "no" the browser then remembers for a long time. The button is the
visitor's.

Note it fires on **desktop** as readily as on Android, so the copy is chosen by
`(pointer: coarse)` rather than assuming a phone.

**iOS has no API at all**, in any browser. Not provisionally: there is no
`beforeinstallprompt` in Safari 26.0–26.6 or 27 beta, MDN's compat data records
`safari: false` with `safari_ios` and `webview_ios` mirroring it — and
`webview_ios` is what every iOS browser is, Chrome included — and WebKit's
standards position on the Web Install API (`navigator.install`) is **oppose**.
Design for the share sheet.

`isIosInstallable()` deliberately does not check *which* browser. Excluding
`CriOS`/`FxiOS`/`EdgiOS` was right before March 2023 and a bug since: iOS 16.4
opened "Add to Home Screen" to any browser with the
`com.apple.developer.web-browser` entitlement, so excluding them told a large
share of iPhone users nothing at all.

## The iOS instruction is where the design work is

A one-tap button converts on its own. A written instruction has to survive being
read, understood, and then acted on against a control the person has never
deliberately looked at — in the two seconds they spend glancing at a banner.
Three things follow, each replacing something the obvious version got wrong:

1. **The reason leads.** The first version opened with "add to your Home
   Screen" and demoted the payoff to grey caption text. Nobody adds a site to
   their Home Screen because they want to add a site to their Home Screen. On
   iOS the payoff is also literally gated — web push does not exist outside an
   installed app — so "get told when it is ready" is *unavailable* until they do
   it. That is the headline.
2. **The glyph, not the word.** "Tap Share" asks for a translation from a word
   to a shape. `ShareIcon` is the same shape that is in the browser chrome, so
   there is nothing to translate. Drawn inline: the SF Symbol is Apple's, and an
   icon font would be a network round-trip in a component whose whole job is to
   be understood immediately.
3. **It points.** Safari's share control is in the **bottom** bar, and a banner
   at the top of the page points at nothing. `placement="anchored"` (the
   default) fixes the card just above the control and aims a chevron at it.
   `placement="inline"` opts out when the host is already placing it low.

**Be honest about the ceiling.** None of this makes iOS install *well* — Apple
gives no API and conversion is poor everywhere. This is a discovery affordance,
not a funnel, and worth measuring rather than assuming.

## Diagnostics

An invite that declines to appear fails **silently**: nothing throws, so a
broken one looks exactly like a healthy page. `onDiagnostic` is told once per
mount, with a payload that reads as a decision table:

| field | what `false` means |
|---|---|
| `earlyScriptPresent` | the document predates the inline capture — deploy |
| `earlyEventHeld` | the browser never judged the page installable |
| `earlyEventFiredAt` set but `hasDeferred` false | the stash is not being adopted |
| `installed` / `dismissed` true | working as designed, not a fault |

## Tests

```bash
pnpm --filter @12-apps/pwa test
```
