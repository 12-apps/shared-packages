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
| `feat(ui)!: drop the legacy Button API` | **major** — `1.8.1 → 2.0.0` |
| `chore` / `docs` / `style` / `test` / `ci` / `build` | no release |

Two consequences worth internalising:

- **A `fix` that is really a breaking change ships as a patch**, and every
  consumer picks it up on their next install with a semver range that promised
  compatibility. Mark it: a `!` after the type/scope, or a `BREAKING CHANGE:`
  footer.
- **A `feat` typed as `chore` never ships at all.** The commit merges, CI is
  green, and the package on npm simply does not have your change. Nothing fails
  — which is why this is the failure mode that wastes the most time.

Declare a breaking change explicitly:

```
feat(ui)!: drop the legacy Button API

BREAKING CHANGE: `<Button kind="…">` is replaced by `variant`. Callers passing
`kind` must rename the prop; the values are unchanged.
```

## Scope

Use the package name — `feat(ui):`, `fix(payments-frontend):`. A change that
touches several packages either takes the most affected one or drops the scope.

## Pull requests

Target `main`. Open the PR, get it green, then mark it ready for review.
