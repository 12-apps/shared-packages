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
| `@12-apps/pwa` | `useInstallPrompt`, `isIosInstallable`, `isStandalone`, `isHandheld`, the messages layer |
| `@12-apps/pwa/react` | `InstallInvite`, `ShareIcon` |

The root entry is framework-free, so a host that only needs "can this be
installed" does not pull React in through a barrel it did not ask for.

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
