# Contributing to `12-apps/shared-packages`

This is a pnpm/turbo monorepo of independently published `@12-apps/*` packages.
Every package is released by semantic-release from the commits that land on
`main`, which makes the commit message part of the build rather than a note
attached to it.

## Commit messages

Every commit and every pull request title must follow
[Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): imperative summary

Optional body, wrapped at 100 characters.
```

The `Commit messages` check enforces this on every pull request. The contract:

| Rule | |
|---|---|
| **Format** | `type(scope): description` — scope optional, and best used as the package name |
| **Type** | one of `feat` `fix` `docs` `style` `refactor` `test` `chore` `perf` `ci` `build` |
| **Header length** | 72 characters or fewer |
| **Mood** | imperative — `add`, not `added` or `adds` |
| **Punctuation** | no trailing period, no emoji |
| **Body** | lines wrapped at 100 characters |
| **Attribution** | no AI/tool attribution — no co-author trailers, no "Generated with …" |
| **Issue ref** | optional; include `(#123)` when an issue exists |

An issue reference is *not* required. This repo is public, and demanding an
issue number for a one-line typo fix turns a drive-by contribution into a
two-step chore.

### Why both the commits and the PR title are checked

This repo is squash-only, with `squash_merge_commit_title: COMMIT_OR_PR_TITLE`.
GitHub uses the **single commit's subject** when a PR has exactly one commit and
the **PR title** when it has several — so either can be the thing that lands on
`main`, and both are linted. A PR title fixed after CI has run re-triggers the
check automatically.

### The type decides the version

`.releaserc.json` runs `@semantic-release/commit-analyzer`, so the type in your
subject is what picks each package's next version:

| Subject | Release |
|---|---|
| `fix(ui): correct the disabled state` | **patch** — `1.8.1 → 1.8.2` |
| `feat(ui): add a compact variant` | **minor** — `1.8.1 → 1.9.0` |
| `feat(ui)!: drop the legacy Button API` | **minor** — `1.8.1 → 1.9.0` |
| `feat(ui): add x` + `BREAKING CHANGE:` footer | **minor** — `1.8.1 → 1.9.0` |
| `feat(ui): rebuild the API` + `RELEASE-MAJOR:` line | **major** — `1.8.1 → 2.0.0` |
| `chore` / `docs` / `style` / `test` / `ci` / `build` | no release |

**A breaking change is a MINOR here.** That is deliberate and it is the opposite
of the angular default. Both ways of declaring one — the `!` and the
`BREAKING CHANGE:` footer — are still read, still shown in the release notes,
and still worth writing; they just do not spend a major on their own. Tightening
a config to be required, or making a component take its copy, is not a migration
anyone schedules, and majors minted for those had five packages queued at once
while consumers stayed pinned to versions behind them.

Two consequences worth internalising:

- **A `fix` that is really a breaking change ships as a patch.** Mark it with a
  `!` or a `BREAKING CHANGE:` footer so it ships as a minor and says what it did.
- **A `feat` typed as `chore` never ships at all.** The commit merges, CI is
  green, and the package on npm simply does not have your change. Nothing fails
  — which is why this is the failure mode that wastes the most time.

Declare a breaking change explicitly:

```
feat(ui)!: drop the legacy Button API

BREAKING CHANGE: `<Button kind="…">` is replaced by `variant`. Callers passing
`kind` must rename the prop; the values are unchanged.
```

Spend a **major** only for a component-wide refactor — the kind a consumer has
to set aside time to adopt. Say so on its own line in the body:

```
feat(ui): rebuild every component around the copy port

RELEASE-MAJOR: every component now takes its sentences as props. Adopters pass
a copy pack per component; there is no default rendering left.
```

Nobody types `RELEASE-MAJOR` by accident, which is the point: `@12-apps/request-
scope` once shipped `2.0.0` because the commit guard wrapped a body at 100
characters and put the phrase `BREAKING CHANGE` at column 0 — inside a sentence
merely *describing* one.

## A major needs a human

A major is the one bump a consumer cannot take without reading. Consumers pin
`@12-apps/*` **exactly**, so an unplanned major is not picked up and quietly
ignored — it stalls the pin, and the consumer drifts further behind with every
later release. Two checks make spending one deliberate.

**At pull-request time**, the `Major guard` check fails a PR carrying a
`RELEASE-MAJOR` line in the title or any commit body. If the major is intended,
add the **`allow-major`** label and the check passes. This is where a major is
cheapest to reconsider: the message is still editable.

A `!` or a `BREAKING CHANGE:` footer does **not** fail the check — it cuts a
minor. The guard says so in the log rather than staying silent, so that someone
who wrote the footer expecting a major finds out here instead of on npm.

The two syntaxes are equals, and both are legible. That is a deliberate repair,
not a given: the angular preset's `headerPattern` is
`^(\w*)(?:\((.*)\))?: (.*)$`, which a `!` before the colon makes fail *entirely*
— so `fix(prisma)!:` used to parse with no type at all and
`@semantic-release/commit-analyzer` returned **no release**. Not the major its
author meant; not even a patch. That exact commit was once the only one in range
for five packages and released none of them, silently, with every check green.
Every `.releaserc.json` overrides `parserOpts.headerPattern` and
`parserOpts.breakingHeaderPattern` so the shorthand parses and raises a breaking
note — and then `releaseRules` maps that note to a **minor**, so `!` now means
exactly what its author meant (this breaks) and spends a minor saying it.

Three things now rest on that override — this document, the guard's error
message, and the approval gate the major is routed to — so
`scripts/release-bump-selftest.mjs` asserts it against the real analyzer and the
committed configs, loading the same copy of `commit-analyzer` semantic-release
itself will run. It also pins the ordinary levels, because a `parserOpts` typo
that broke plain `fix:` commits would be a repo-wide outage that looked exactly
like the majors working.

**At release time**, the `Detect major bumps` job in `ci.yml` re-runs the
analysis against `main` with `semantic-release --dry-run` — which tags and
publishes nothing — and, when a major is pending, holds the run at the
`Approve major release` job. That job belongs to the `release-major`
environment, so GitHub shows **Review deployments** in the Actions tab and
notifies its reviewers. Approve and the release continues; reject and it stops
having written no tag, so the next merge re-cuts the version normally.

Only a pending major holds the run. An ordinary minor or patch release never
waits for anyone.

> **Setup, once per repository:** Settings → Environments → New environment →
> `release-major`, then add Required reviewers. **Without that protection rule
> the approval job passes straight through and the gate silently does nothing**
> — which looks exactly like a healthy release. If a major reaches npm without
> anyone approving it, check this first.

A footer is anchored to the start of a line, which is what
conventional-commits-parser tests. A sentence that merely *mentions* a breaking
change mid-line is not one — but the commit guard wraps bodies at 100
characters, and a wrap that lands on the phrase turns a mention into a footer.
That is how `@12-apps/request-scope` went out as `2.0.0` for a change that adds
a `.releaserc.json` the tarball does not even ship.

## Scope

Use the package name — `feat(ui):`, `fix(payments-frontend):`. A change that
touches several packages either takes the most affected one or drops the scope.

## Build before you check

Fifteen of the `@12-apps/*` packages ship **compiled** entries — their `exports`
point at `dist` rather than at `src` — which is what makes a published tarball
work for the apps that install it. The other thirteen still export `src`, so
whether this bites you depends on what you depend on. In practice it usually
does: `@12-apps/ui` is one of the fifteen and sits under almost everything else,
and `forms-core`, `mcp`, `rbac`, `onboarding` and `report-builder` are too.

The cost is paid locally. A package's `check-types`, `lint` and `test` need
those dependencies **built**, not merely installed, and `pnpm install` alone
leaves them unbuilt.

What makes this worth a section is that the failure names the wrong thing. It
reads as a missing module, in a package that plainly declares it:

```
src/react/ai-capabilities.tsx(1,21): error TS2307: Cannot find module
'@12-apps/ui/mui/Box' or its corresponding type declarations.
```

Nothing is wrong with the import. `@12-apps/ui` simply has no `dist` yet.

So build first. `pnpm build` does the whole graph and is the safe default — it
is what CI runs before any per-package job. Turbo's `...` suffix builds one
package's dependencies instead, which is much faster when that is all you need:

```bash
pnpm turbo run build --filter=@12-apps/mcp...   # mcp AND everything it needs
pnpm --filter @12-apps/mcp check-types
```

If a build itself fails with `tsup: not found`, or a `dist` never appears for a
package that clearly builds one, the install did not finish — re-run
`pnpm install` before looking for the cause anywhere else.

## Pull requests

Target `main`. Open the PR, get it green, then mark it ready for review.
