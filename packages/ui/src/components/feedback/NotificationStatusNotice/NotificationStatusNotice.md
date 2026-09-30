# NotificationStatusNotice

Tells a reader whether **this browser** will notify them, and offers the one
thing they can do about it.

| `status` | what it means | what it offers |
|---|---|---|
| `enabled` | they will be notified here | nothing |
| `disabled` | they will not, and this page can ask | an action that calls `onEnable` |
| `blocked` | they will not, and the browser refused once | a "turn back on" disclosure over the steps for **their** browser |
| `unavailable` | they will not, and nothing here can change it | nothing |

Use it wherever a promise depends on web push — "we will call you when your
table is ready" — so a reader is never left believing a notification is coming
that cannot arrive.

## Import

```ts
import {
  NotificationStatusNotice,
  detectNotificationBrowser,
  notificationUnblockSteps,
} from '@12-apps/ui/feedback/NotificationStatusNotice';
import { PT_BR_NOTIFICATION_UNBLOCK_COPY } from '@12-apps/ui/pt-BR';
```

## Usage

The component owns no words. Map your own permission state onto `status`, and
pass the sentences:

```tsx
const browser = detectNotificationBrowser(navigator.userAgent, navigator.maxTouchPoints);

switch (pushState) {
  case 'offer':
    return (
      <NotificationStatusNotice
        status="disabled"
        title="Suas notificações estão desligadas."
        description="Sem elas, a gente não consegue te avisar no celular."
        enableLabel="Ligar notificações"
        onEnable={requestPermission} // raise the browser prompt HERE — it needs a gesture
        pending={asking}
      />
    );
  case 'blocked':
    return (
      <NotificationStatusNotice
        status="blocked"
        title="As notificações estão bloqueadas neste navegador."
        stepsToggleLabel="Habilitar novamente"
        steps={notificationUnblockSteps(PT_BR_NOTIFICATION_UNBLOCK_COPY, browser)}
      />
    );
  // …
}
```

## Props

Common to every status:

| prop | type | |
|---|---|---|
| `status` | `'enabled' \| 'disabled' \| 'blocked' \| 'unavailable'` | required; picks the shape below |
| `title` | `string` | required; the reader's situation in one sentence |
| `description` | `string` | what that means for them |
| `dataTestId` | `string` | root test id (default `notification-status-notice`); parts append `-enable`, `-steps-toggle`, `-steps` |
| `className`, `sx` | | forwarded to the root `Alert` |

`disabled` adds `enableLabel`, `onEnable` and `pending` (spinner, and the action
cannot be pressed twice). `blocked` adds `stepsToggleLabel`, `steps` (ordered)
and `defaultStepsOpen`.

## The unblock steps

A web page cannot re-ask after a refusal — `Notification.requestPermission()`
resolves `denied` at once — so the only way back is the browser's own settings,
and those differ per browser. `NotificationUnblockCopy` holds one ordered list
per family and platform, shipped in pt-BR and en-US:

- `detectNotificationBrowser(userAgent, maxTouchPoints)` answers
  `{ family, platform }` — Chrome, Edge, Firefox, Safari, Samsung Internet,
  Opera, or `other`; on `ios`, `android` or `desktop`. Most specific first:
  every Chromium browser also says `Chrome`, every iOS browser also says
  `Safari`, and an iPad asking for the desktop site says `Macintosh`.
- `notificationUnblockSteps(copy, browser)` picks the list. Every iOS browser
  shares one list (web push there belongs to a Home Screen app, switched in the
  device's Settings); a family/platform the pack does not name falls back to
  `other`.

Menu labels move between browser versions. The packs follow the current ones
and say where to look; a host that needs different words passes its own
`NotificationUnblockCopy`.

## Accessibility

- The root is a **polite** live region (`role="status"`): a change of status is
  announced without interrupting what the screen reader was saying.
- The steps sit behind a real `button` with `aria-expanded` and `aria-controls`;
  the list is an `<ol>`, so the order is announced. Enter and Space toggle it.
- `disabled` and `blocked` are `warning`s — the reader can act, and will miss
  something if they do not. `unavailable` is only `info`: painting amber what
  cannot be fixed asks the reader to fix it.
