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

## Build before you check

Every `@12-apps/*` package resolves its siblings through `dist`: the manifests
point `exports` at compiled entries rather than at `src`, which is what makes a
published tarball work for the apps that install it. The cost is paid locally —
a package's `check-types`, `lint` and `test` need its workspace dependencies
**built**, not merely installed, and `pnpm install` alone leaves them unbuilt.

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
