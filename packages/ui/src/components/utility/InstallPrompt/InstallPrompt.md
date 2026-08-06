# InstallPrompt

A dismissible "install this app" invitation, plus the `usePwaInstall` hook behind it.

## The problem this solves

A manifest and a service worker make a site **installable**. They do not make it
**install**. Chromium signals its willingness by firing `beforeinstallprompt` and
then does nothing further on its own beyond a small address-bar icon most users
never notice. If no page code calls `preventDefault()` on that event and keeps a
reference to it, the handle is gone and the app can never ask.

So a site can pass every installability criterion a browser checks — HTTPS,
manifest, matching icons, a service worker with a fetch handler — and still never
offer to install, because nothing in it captures the event. That is the gap this
component fills.

On iOS Safari the event never fires at all: there is no programmatic install, only
Share → Add to Home Screen. Collapsing that into "unsupported" hides the affordance
from the largest slice of a mobile storefront's traffic, so it is handled as its own
case with instructions in place of a button.

## Usage

```tsx
import { InstallPrompt } from '@12-apps/ui/utility/InstallPrompt';

export const StorefrontHeader = () => (
  <InstallPrompt
    title="Instalar o FutureDrink"
    description="Peça mais rápido na próxima visita, direto da tela de início."
    installLabel="Instalar"
    dismissLabel="Dispensar"
  />
);
```

Mount it unconditionally. It returns `null` unless an install affordance should
genuinely be shown, so there is nothing to gate at the call site.

### Headless

When the built-in presentation does not fit, use the hook and render your own:

```tsx
import { usePwaInstall } from '@12-apps/ui/utility/InstallPrompt';

const InstallLink = () => {
  const { canInstall, platform, promptInstall } = usePwaInstall();

  if (!canInstall) return null;
  if (platform === 'ios') return <IosHint />;

  return <button onClick={() => void promptInstall()}>Instalar</button>;
};
```

`promptInstall()` must be called from a user gesture — browsers reject a prompt
raised from a timer or an effect.

## When it renders nothing

| Condition | Why |
|---|---|
| Already installed | `display-mode: standalone`, or `navigator.standalone` on iOS |
| Recently dismissed | A stored timestamp inside the `dismissForDays` window |
| No install route | Not Chromium, and not iOS Safari — e.g. Chrome on iOS, which cannot add to the home screen at all |
| Event not yet captured | Chromium has not (yet) offered a prompt |

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | `'Install this app'` | Headline text |
| `description` | `string` | — | Supporting line |
| `installLabel` | `string` | `'Install'` | Install button label (Chromium only) |
| `iosInstructions` | `ReactNode` | Share → Add to Home Screen | Replaces the built-in iOS wording |
| `dismissLabel` | `string` | `'Dismiss install prompt'` | Accessible label for the close button |
| `icon` | `ReactNode` | install glyph | Leading icon |
| `onInstall` | `(outcome: InstallOutcome) => void` | — | Called after the native prompt resolves |
| `onDismiss` | `() => void` | — | Called when dismissed |
| `storageKey` | `string` | `'pwa-install-dismissed'` | localStorage key for the dismissal |
| `dismissForDays` | `number` | `30` | Dismissal lifetime; `0` means permanent |

All copy defaults to English and every string is a prop — this package is
locale-neutral and the consuming app supplies its own wording.

## Wiring the capture

**Required on Chromium.** Without it this component can never offer an install,
and it will fail silently — no error, no warning, just an affordance that never
appears.

Chromium fires `beforeinstallprompt` once, during page load, as soon as it has a
manifest and a registered worker. That is before hydration, and in a code-split
app it can be before the chunk holding this component has been downloaded at
all. No React hook can attach a listener in time, and the event is not reissued
on request. So the capture has to run outside React, and first.

Paste this into `<head>`, above the app bundle. A classic inline script is the
only thing guaranteed to beat a deferred module:

```html
<script>
  (function () {
    var stash = (window.__pwaInstall = { event: null, firedAt: null, installedAt: null });
    window.addEventListener('beforeinstallprompt', function (event) {
      event.preventDefault();
      stash.event = event;
      stash.firedAt = Date.now();
      window.dispatchEvent(new Event('pwa-install-available'));
    });
    window.addEventListener('appinstalled', function () {
      stash.installedAt = Date.now();
      stash.event = null;
    });
  })();
</script>
```

Or call `capturePwaInstallEvent()` as the first statement of your entry module,
before `createRoot`. Simpler to wire, but a module is still deferred, so a very
early event can outrun it. Doing both is safe — the capture is idempotent.

```ts
import { capturePwaInstallEvent } from '@12-apps/ui/utility/InstallPrompt';

capturePwaInstallEvent();
```

`readPwaInstallStash()` exposes what was captured (`event`, `firedAt`,
`installedAt`), which is worth logging when the prompt does not appear:
`firedAt` set with no visible affordance means something downstream suppressed
it, whereas an absent stash means the wiring above is missing.

## Hook API

`usePwaInstall(options)` returns:

- `canInstall` — whether to render an affordance at all
- `platform` — `'prompt'` (Chromium), `'ios'` (Safari on iOS/iPadOS), or `'unsupported'`
- `isInstalled` — running as an installed app
- `promptInstall()` — fires the native prompt; resolves `'accepted' | 'dismissed' | 'unavailable'`
- `dismiss()` — suppresses the affordance for `dismissForDays`

## Notes

- **SSR-safe.** Every environment probe runs in an effect, never during render, so
  there is no hydration mismatch. The first paint reports `canInstall: false` and
  corrects itself on mount.
- **The deferred event is single-use.** After `prompt()` resolves it is discarded;
  Chromium emits a fresh one if the app is still installable.
- **Declining the native dialog counts as a dismissal**, or the affordance would
  reappear on the next render.
- **Storage failures are swallowed.** `localStorage` throws rather than returning
  `null` in Safari private mode and wherever cookies are blocked; an uncaught throw
  would break the page on exactly the browsers this component serves.
- **A missed event does NOT recover.** Chromium fires `beforeinstallprompt` once
  and will not reissue it on request, so a listener that attaches on mount has
  already lost. This is why "Wiring the capture" above is a requirement rather
  than an optimisation.
