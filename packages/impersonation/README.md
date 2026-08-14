# `@12-apps/impersonation`

An operator previews as a tenant user. Reads are scoped, writes are refused
unless opted in, money paths are always refused, and revoking the entitlement
ends the session live.

Both halves ship here, each behind a single factory that takes a config object:

```ts
const { routes, guard } = createApiImpersonation({ … }); // @12-apps/impersonation/server
const { banner, dialog } = createWebImpersonation({ … }); // @12-apps/impersonation/react
```

## The two kinds of session

| kind | who it resolves as | ceiling | writes |
| --- | --- | --- | --- |
| `operator` | the TARGET user | none — be exactly them | only with `allowWrites`, asked for at start |
| `preview`, member | the previewed MEMBER | the actor's own set | never |
| `preview`, role | the actor themselves | the previewed ROLE's set | allowed |

The role row is not a hole. A role preview substitutes no one: the subject stays
the actor and the previewed role only ever INTERSECTS their own rights, so every
write it permits is one they could already have made under their own name. A
member preview resolves as somebody else and is therefore refused whatever the
cookie says — the rule is re-derived from the session's shape, never from a flag
a caller could set.

## What the package owns

- **The cookie.** Minting, reading, ending. There is no sliding renewal, and
  that is structural rather than un-implemented: a decoded session is not
  assignable to the mint's input, so no expression can re-stamp a live window.
- **The write gate.** The branch order is the feature — the exit first (a
  session that cannot be stopped is worse than any write it might make), then the
  live revocation, then money, then accounts, then the read shortcut, then the
  per-kind rule.
- **The routes.** Three verbs on one resource for the platform mount (start,
  stop, describe), two on the tenant mount (start a preview, stop).
- **The browser half.** The bar that cannot scroll away, be dismissed or be
  covered; the countdown that recomputes from the clock; the chrome offset; the
  wake-up handling; the exit's ordering; the start handshake; and the start
  dialog.
- **The journeys.** `@12-apps/impersonation/e2e` ships the Gherkin, its steps and
  the port a host implements to run them.

## What stays the host's

Everything below is REQUIRED config with no default. A default here fails open:
it hands a second host another product's URLs, vocabulary or language, silently.

- **Who is calling** — the resolved actor: user id, e-mail, platform authority,
  the permission ids they hold, and whether the request came from a machine
  token.
- **The cipher** — an authenticated codec whose tag is the integrity check.
- **The time box** — per kind, in milliseconds.
- **The path tables** — where money moves, which of those GETs are proven pure,
  which prefixes hold a person's own account, and where this package's own
  routes were mounted.
- **The directory** — who may be impersonated, in which tenant, and whether a
  target holds platform authority itself.
- **The trail** — start, end, and every refused attempt.
- **The entitlement** — the tenant's plan and its own consent switch, when the
  host has them.
- **Every sentence** — both halves take all their copy as config.

## The inversion worth reading before you edit the tables

On a money path the METHOD decides nothing. Payment surfaces routinely settle
state on a GET — a status poll that confirms an order paid, a verification
landing that activates a provider, an OAuth callback that stores credentials —
because the provider, not the application, chose when the browser came back. So a
read is let through only when it appears in `paths.moneyReads`, an enumerated
allowlist anchored to the WHOLE pathname. A new route under a money subtree is
refused until a human reads it and adds it: that costs a bug report, where the
other order costs a charge.

Account paths are the opposite and get a separate table for exactly that reason:
nothing under them is a redirect target, so no GET there is forced to settle
state, and reads are allowed while every write is refused.

## Subpaths

| subpath | what it is | peers |
| --- | --- | --- |
| `.` | the framework-free core: codec, path rules, write rule, permissions, wire shapes | — |
| `./server` | `createApiImpersonation` — route descriptors, the write gate, the ports | — |
| `./hono` | the two mounts as routers | `hono` |
| `./react` | `createWebImpersonation` — the banner and the start dialog | `react` |
| `./e2e` | the packaged journeys, their steps, and the world port | `@playwright/test`, `playwright-bdd` |

Adoption contract, step by step: [ADOPTING.md](./ADOPTING.md).
