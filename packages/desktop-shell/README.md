# @12-apps/desktop-shell

The reusable half of a background desktop **agent**: an Electron app that signs
in against the host's own web sign-in page, keeps working with every window
closed, and starts with the machine on Windows, macOS and Linux.

```bash
pnpm add @12-apps/desktop-shell electron
```

## The problem it solves

Some work cannot be done by a tab, and the list is short and stubborn:

- reach a device on the shop's own network (a printer, a scale, a drawer);
- print without a dialog;
- keep running when the browser is closed;
- start when the machine does.

A product that needs any of those grows a small desktop companion. That
companion is ~90% the same every time — sign in, stay signed in, hold one
connection, do the work, survive, say how it is going in one tray icon — and
the remaining 10% is the whole point of the app. This package is the 90%.

## The rule that shapes everything: no second way to sign in

A desktop app must not collect a password. The moment it does, the product has
**two** authentication paths: the web one — rate limits, lockout, e-mail
verification, OAuth buttons, password reset, copy in every language — and a
text field in a native window that has none of those and never will be kept
level with the first.

So the shell opens the **host's own sign-in page** in a window and watches for
the session cookie to land. A provider added on the web is available to the
agent the same day, and there is no credential handling in this package at all:
`grep -ri password src/` returning nothing is the invariant.

```
   tray icon ─┐
              ├─ sign-in window ──▶ the host's /sign-in page ──▶ cookie
   the work ──┘                                                   │
        ▲                                                         │
        └──────────── net.fetch bound to the same partition ◀──────┘
```

## Surfaces

| Export | What it is |
|---|---|
| `@12-apps/desktop-shell` | The status a tray draws (`deriveShellStatus`) and the supervisor that keeps background work alive. Pure. |
| `…/autostart` | "Start with the machine" across the three platforms — a login item on macOS/Windows, an XDG `.desktop` file on Linux. |
| `…/session` | The cookie watch, the local sign-out, and `guardSession` — a 401 moves the tray, a 403 does not. |
| `…/electron` | The adapter: single instance, tray, windows-hide-never-close, background start, and `startDesktopShell`. |

Everything but `…/electron` is framework-free and runs in a plain Node test —
which is how the autostart quoting and the status ranking are asserted on a
machine with no display.

## Two facts, one word

A session and a live link fail separately and recover separately. An agent that
collapsed them into one boolean could not tell a person which to fix, so they
are tracked apart and `deriveShellStatus` is the one place they become a word.

The ranking is an order of **what to do next**, not of severity: a missing
session outranks a dropped link (the link is a consequence), and a local fault
outranks the link (the link recovers on its own; a fault does not).

`degraded` is not an error. It means the live link is down and the host's
fallback poll is carrying the work — slower, not broken. A host that nags
somebody over `degraded` is nagging them over a reconnect.

## It carries no words

Not one sentence, in any language. A tray menu, a tooltip, a window title and a
startup-list entry are all copy, and copy is the host's — so `TrayCopy` is a
required pack and `ShellState.fault` is a **code**, not a message. The reader
here is a shop owner, and the words are most of the product.

## Adoption

See [ADOPTING.md](./ADOPTING.md).
