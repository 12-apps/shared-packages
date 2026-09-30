# NotificationStatusNotice

Tells a reader whether this browser will notify them — enabled, disabled but
askable, blocked by the browser, or unavailable — and offers the one action
each status allows. Composes `Alert` and `Button`; every sentence comes from
the host, and the browser-specific unblock steps from the pt-BR/en-US
`NotificationUnblockCopy` packs.

## Props

- `status` — which of the four situations; narrows the props below.
- `title` / `description` — the host's sentences.
- `enableLabel` / `onEnable` / `pending` (`disabled`) — the permission request.
- `stepsToggleLabel` / `steps` / `defaultStepsOpen` (`blocked`) — the disclosure over the unblock steps.
- `dataTestId`, `className`, `sx` — forwarded to the root.

## Lint

Clean.

## Type Errors

None.

## Testing Scenarios

Each status's shape; `onEnable` once and not while pending; the disclosure by
click and keyboard; browser detection across Chrome/Edge/Firefox/Safari/Samsung/
Opera on desktop, Android, iPhone and iPad; the steps fallback; pt-BR and en-US
packs with the same shape.

## Current

Web only; no React Native port.
