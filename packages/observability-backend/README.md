# `@12-apps/observability-backend`

Server-side error reporting on Sentry, for the one environment nobody can attach
a debugger to.

It has a browser counterpart, `@12-apps/observability-frontend`. They are two
packages rather than one because they share no code at all, only environment
variables — this side is `@sentry/node` plus `winston-transport`, the other is
`@sentry/react` plus React, and a single package would put a Winston transport
in every SPA's dependency tree and React in every server's. They are independent
(either runs without the other) but deliberately share `SENTRY_ENVIRONMENT` and
`SENTRY_RELEASE`, so a browser event and the 500 behind it land in the same
environment under the same build.

## Why it exists

A production failure used to leave exactly one trace: a line on stdout inside a
container, which dies with it and is reachable only over SSH. So the only way to
learn *why* something broke was to reason about the source and guess — and a run
of four consecutive wrong diagnoses is what that costs. The line that would have
ended it on the first try existed the whole time; nobody could read it.

## Usage

```ts
import { sentryTransport, flushReporter, scrub } from "@12-apps/observability-backend";

const reporter = sentryTransport();
const logger = winston.createLogger({
  transports: [consoleTransport, ...(reporter ? [reporter] : [])],
});
```

**It hangs off the LOGGER, not off each call site.** A shared logger is already
the funnel — every feature's `log.error` goes through one Winston instance, so
attaching here means a new module is covered the moment it logs, with nothing to
remember. The alternative, a `captureException` beside every `throw`, is a rule
that decays the first time someone forgets it.

Note the trap that implies: **`console.error` does not reach the reporter.**
Winston is the funnel; anything written past it reaches a container's stdout and
nowhere else.

| export | what it does |
|---|---|
| `sentryTransport()` | the `winston-transport` to install, or `null` when reporting is off |
| `sentryEnabled()` | whether a DSN is configured for this process |
| `flushReporter(timeoutMs?)` | wait for queued events; call before a deliberate exit |
| `scrub(value)` | redact PII by key at any depth, for a context object folded into a message |

`flushReporter()` matters more than it looks. The SDK batches and sends
asynchronously, so `log.error(…)` followed by `process.exit(1)` tears the process
down with the event still in memory — losing precisely the report worth having
most, since a process that died on boot leaves nothing else behind.

## It is OFF unless a DSN is set

No `SENTRY_DSN`, no transport, no network. Dev, CI and every test run stay silent
and offline. Enabling is a deployment decision, never a code one — which is also
what keeps a test suite's deliberate failures from filling an issue tracker.

| variable | notes |
|---|---|
| `SENTRY_DSN` | the only required one. Write-only ingest. |
| `SENTRY_ENVIRONMENT` | falls back to `NODE_ENV`, then `production` |
| `SENTRY_RELEASE` | which build an error came from |
| `SENTRY_TRACES_SAMPLE_RATE` | defaults to `0` — tracing is billed per span and answers "how slow", while this answers "what threw" |

## PII

`scrub()` redacts by KEY at any depth rather than pattern-matching values: a
Brazilian CPF is eleven digits, and so are plenty of ids worth keeping. Ids and
amounts survive on purpose — a scrub that eats them leaves every event
undiagnosable.

It is not defensive decoration. The leak it was written for is a provider error
that retains the upstream response body, which on a rejected payment carries the
payer's name, e-mail and tax id. `sendDefaultPii` is held off regardless of DSN
on top of that, so request bodies, cookies and IPs never ride along.

The transport also sends the **message** as a string rather than the raw meta
object: Winston's formatter runs `util.inspect(…, { depth: 5 })` over extra
arguments, which is precisely how a provider payload would otherwise reach a
third party.

## Why it ships compiled

Unlike most packages in this repo, this one publishes `dist` (dual CJS+ESM with
`.d.ts`) rather than TypeScript source. Two reasons, both load-bearing:

1. **Node refuses to strip types below `node_modules`**
   (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). A server importing this
   package from the registry gets a hard failure on raw `.ts`. It does *not*
   fail inside a workspace, where pnpm links the package and Node resolves a
   realpath outside `node_modules` — so the bug would first appear in a
   consumer, after publishing.
2. **CommonJS consumers exist.** `@12-apps/shared-helpers` is CJS with classic
   `moduleResolution`, which ignores the `exports` map entirely and reads
   `main`/`types`.

## Tests

```bash
pnpm --filter @12-apps/observability-backend test
```

Nothing reaches the network: the suite asserts the two safety properties —
reporting can be switched off, and what it forwards is scrubbed.
