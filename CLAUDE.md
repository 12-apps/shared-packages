# shared-packages

pnpm + turbo monorepo of independently published `@12-apps/*` packages, released
by semantic-release from the commits that land on `main`. Overview:
[README.md](./README.md). Commit, PR and release rules:
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Layout

- `packages/*` and `packages/payments/*` are the workspaces (`pnpm-workspace.yaml`).
  Packages are nested: `packages/payments/backend` and `packages/payments/frontend`
  are workspaces of their own, next to `packages/payments`.
- `harness/` (frontend, backend, native) is NOT a workspace. It runs against the
  packed tarballs, never the workspace (`harness/README.md`).
- `scripts/` holds the repo-wide gates and their selftests; `scripts/lib/` holds
  their pure parts. Root `quality:*` scripts run them.
- `docs/` holds package-level docs (`reports-builder`, `wiring`).

## Tests: run only what the change reaches

```bash
pnpm test:changed                 # THE local test command (root `pnpm test` is the same)
pnpm test:changed --uncommitted   # only edits since HEAD
npx vitest run <test-file>        # from the package, for one test file
npx vitest related --run <src>    # the tests that import a source file
```

`test:changed` maps the files changed since the merge base with `origin/main`
(plus untracked ones) to their nearest workspace and runs
`vitest related --run` there. A workspace without vitest is skipped, never run
whole.

**A whole package, `pnpm test:all`, `turbo run test` or a package's own `test`
script is never an agent's job.** CI selects and runs what the change reaches. In
your report, name the selective command and how many files it picked.

## Lint, types, build

Many packages export compiled `dist`, so build what a check depends on first.

```bash
pnpm turbo run build --filter=@12-apps/<pkg>...   # the package and its dependencies
pnpm --filter @12-apps/<pkg> check-types          # tsc --noEmit
pnpm --filter @12-apps/<pkg> lint                 # eslint, zero warnings
pnpm quality:complexity                           # also: quality:flakiness, quality:portability
pnpm lint:commits                                 # commit messages against origin/main
```

`pnpm build`, `pnpm lint` and `pnpm check-types` at the root run every package;
use them only when the change really spans the graph. `pnpm quality:all` runs
every repo-wide gate.

## Conventions

- Everything a developer reads is English: commits, PR titles and bodies, code,
  comments, docs, test names, branch names.
- Commits are Conventional Commits: `type(scope): imperative summary`, header at
  most 72 characters, no trailing period, no emoji, no AI attribution trailers.
  The pre-push hook (`.githooks/pre-push`) lints them.
- Packages stay host-agnostic: host-specific names, copy and brand live in the
  consuming app (`quality:portability` enforces it).
- A change to a package's public surface is released from its commit type
  (`feat` minor, `fix` patch, `!` major, which needs a human; see CONTRIBUTING.md).
