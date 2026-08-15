# Releasing this package

`.releaserc.json` sits beside this file and says almost nothing, because almost
everything is inherited: `semantic-release-monorepo` narrows the commit list to
the ones touching `packages/app-shell/**`, and `@semantic-release/commit-analyzer`
decides — from the commit SUBJECT — whether those commits are a release and what
kind.

This page exists for one trap in that second half, which cost this package a
release and is invisible unless you already know to look for it.

## A `!` in the title is accepted by commitlint and IGNORED by the analyzer

`fix(app-shell)!: …` is a valid Conventional Commit and `commitlint` passes it.
`@semantic-release/commit-analyzer` runs the **angular** preset, whose header
pattern has no place for a `!` between the scope and the colon. The header
therefore does not match, `type` resolves to nothing, and the commit is not
releasable **at all** — not a major, and not even the patch a `fix` would
otherwise earn.

This repo squash-merges with the PR title, so the PR title IS the analysed
subject. A `!` there eats the release.

```
d6a583c3  fix(app-shell)!: ship every entry compiled…      (no BREAKING footer)
          › The commit should not trigger a release
          › Analysis of 1 commits complete: no release
```

The neighbouring package shows the other half of the rule:

```
fc081204  fix(audit)!: hold the day bounds…               BREAKING CHANGE: …
          › Analysis of 1 commits complete: major release
          › next release version 5.0.0 · Published
```

`@12-apps/audit` released a major from an equally unparseable header — because
the analyzer reads `BREAKING CHANGE:` from the **body** independently of the
type. The `!` did nothing there either; the footer did all the work.

**So:** write the title without a `!`, and put a real `BREAKING CHANGE:` footer
in the squash body when the change is breaking. Prose that merely says "this is
breaking" is not the token and has no effect.

```
fix(app-shell): ship every entry compiled, not just ./vite (12-18)

BREAKING CHANGE: every `exports` entry now resolves to compiled output with an
emitted `.d.ts` instead of TypeScript source.
```

## What a dropped release looks like, so you do not chase the wrong line

The Release job does not announce "app-shell was not released". It ends with:

```
0 published, 30 already on the registry
```

That line is **expected noise, not the failure**. When semantic-release releases
nothing, no manifest is bumped, so the publish step falls back to every package's
frozen committed `1.0.0` — a version the registry has had for months — and npm
refuses each one with *"You cannot publish over the previously published
versions: 1.0.0"*, which `publish.mjs` correctly reports as `skipped`. Thirty
skips is what a no-op release looks like from the outside, and it reads like a
successful no-op rather than a dropped one.

The real evidence is one group above, per package:

```
::group::semantic-release app-shell
  › The commit should not trigger a release
  › Analysis of 1 commits complete: no release
```

and the absence of a new `app-shell-vX.Y.Z` tag. Check the tag, not the publish
summary.

## `TAG_FAILED` names other packages, and that is not about this one

The same job hands off `TAG_FAILED` (see `scripts/release-tags.mjs`), and a
long-standing `EINVALIDNPMTOKEN` on `@12-apps/request-scope` has kept a name in
it. It does not block this package. `release-tags.mjs` attempts every directory
in `PUBLISH_DIRS` even after one fails, in topological order, and says so in its
own comment: *"a failure here means 'this package did not get a NEW version' —
it does not make the packages after it unreleasable"*, with the step summary
adding that *"the publish step still runs, so any package tagged before these
still reaches the registry"*.

`@12-apps/app-shell` is 23rd in `PUBLISH_DIRS` and `request-scope` is 3rd, so
app-shell's analysis ran regardless — and its verdict was a clean *"no release"*,
never a failure. It was never in `TAG_FAILED` at all.
