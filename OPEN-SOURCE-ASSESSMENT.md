# Open-source assessment — `12-apps/shared-packages` and `12-apps/ci`

Evaluates whether making these two repositories public would hurt, and whether it
would cut the CI bill. Both repos were audited in full (working tree + complete
git history) on 2026-08-04.

**Short answer:** publishing does not hurt — the code is clean and the community
value is real — but it will **not** meaningfully cut the CI bill, because Actions
minutes are billed to the *calling* repo, and almost all the org's minutes are
spent by `12-apps/future-pay`, which stays private either way.

---

## 1. The CI-cost premise does not hold

GitHub Actions is free on public repos with standard runners; private repos get
2,000 min/month (Free), 3,000 (Team), or 50,000 (Enterprise Cloud). So going
public *is* free-CI — for the repo that goes public.

The catch is which repo pays. From GitHub's billing docs: **"If you reuse a
workflow, billing is always associated with the caller workflow."** Minutes are
charged to the repository that triggers the run, not the one hosting the
reusable workflow.

All four org repos are private today: `future-pay`, `ci`, `base-app`,
`shared-packages`. That means:

| Repo | Public would save | Why |
|------|-------------------|-----|
| `12-apps/future-pay` | **all of it** — but it stays private | The actual monorepo (16.5 MB, pushed daily). Every `uses: 12-apps/ci/...@v1` run bills here. |
| `12-apps/ci` | ~nothing | 218 KB, 38 commits. Its own CI is one `release-major-tag` workflow on push. Consumers' runs never bill here. |
| `12-apps/shared-packages` | small but real | 14 runs total, all on 2026-07-17. Its own 6-job CI would become free. |

So open-sourcing `ci` buys **zero** CI savings — the minutes it appears to
"cost" are already being billed to `future-pay`. Open-sourcing
`shared-packages` makes this repo's own CI free, which is worth having but is
not where the bill comes from.

### What would actually cut the bill

Billed minutes are the *sum* of all job-minutes, not wall-clock. This repo's
`ci.yml` runs `lint`, `type-check`, `build`, and `unit-tests` as four separate
jobs — four runners, four checkouts, four full `pnpm install --frozen-lockfile`
of a workspace carrying MUI, Prisma, Storybook and Playwright. The installs
dominate, and they are paid four times over.

Collapsing those four into one job with a single install is the single largest
lever available today. It trades wall-clock (jobs no longer run in parallel) for
minutes. If fail-fast feedback matters more than cost, keep them split and
accept the multiplier — but that is the tradeoff to decide, not visibility.

Second lever: `turbo --affected` with a cross-run `.turbo` cache is already
wired into `12-apps/ci`'s `monorepo-static.yml` but this repo's `ci.yml` calls
`pnpm lint` / `pnpm check-types` directly, so it rebuilds everything on every
PR. Routing this repo through the org's own reusable static pipeline would pick
that up.

---

## 2. Does publishing hurt? — audit findings

### Verified clean

- **No secrets, in either repo, anywhere in history.** Scanned working trees and
  full git history (`shared-packages`: 12 commits; `ci`: 38 commits, unshallowed
  for the scan). No deleted `.env`/`.pem`/key files, no hardcoded credential
  literals. Every CI secret is referenced through `secrets.*` / `vars.*`:
  `DO_API_TOKEN`, `DO_SSH_PRIVATE_KEY_B64`, `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `DOPPLER_TOKEN`, `GOOGLE_CLIENT_ID/SECRET`.
- **No internal infrastructure values.** `.github/deploy/targets.json` holds
  vendor descriptors only. `DEPLOY_HOST` (the droplet IPv4) is a repo variable,
  never committed. The one IP in the tree, `169.254.169.254`, is the standard
  cloud metadata endpoint.
- **No licence conflict.** UI depends on `@mui/material` v6 and
  `@mui/icons-material` v6 — both MIT. No MUI X Pro/Premium, so nothing
  commercially licensed gets redistributed.
- **Test fixtures are already generic** — `example.com` throughout, apart from
  the one case fixed below.

### Fixed in this change

1. `packages/shared-helpers/prisma/seed-admin-demo.ts` hardcoded a real personal
   Gmail address as the default dev-admin when `DEV_ADMIN_EMAIL` is unset.
   Replaced with `dev-admin@example.com`. This is worth fixing whether or not
   the repo ever goes public.
2. `packages/mcp/src/auth/authorization-server-metadata.test.ts` used
   `https://tenant.futuredrink.com.br` — a real-looking customer domain — as an
   OAuth issuer fixture. Replaced with `tenant.example.com`.

### Blocker — must be resolved before flipping public

**`packages/shared-helpers/prisma/` is the product's data model, not a shared
helper.** It carries a 1,122-line schema with 38 models, 27 migrations, and
seed data. The models are the full commerce domain: `Order`, `OrderCharge`,
`Payment`, `SavedCard`, `CustomerProfile`, `StockLot`, `StockMovement`,
`Recipe`, `RecipeComponent`, `Supplier`, `LossEvent`, `OAuthClient`,
`OAuthRefreshToken`, `McpConnection`, `Membership`, `PaymentIntegration`.
Publishing it publishes `future-pay`'s design — every entity, every
relationship, every payment state transition. It also carries 41 `FUT-*`
internal tracker references.

This is a packaging problem independent of open source: a schema for one app
does not belong in a package named "shared helpers", and no community consumer
can use it. Two options:

- **Recommended:** move `prisma/` (schema, migrations, seeds) back into
  `future-pay`, or into a separate private `@12-apps/db` package. Keep the
  genuinely generic Prisma *helpers* that live in `src/prisma/` —
  `audit-extension.ts`, `actor-context.ts`, `search-normalize.ts` — which are
  reusable and reveal nothing.
- **Minimum:** exclude `packages/shared-helpers` from the public split entirely
  and publish the other packages.

### Legal and hygiene gaps

3. **No LICENSE file exists anywhere in either repo**, yet `mcp`,
   `shared-helpers`, and `typescript-config` already declare `"license": "MIT"`
   in `package.json`. Publishing MIT-declared code with no licence text is
   legally ambiguous — nobody can rely on it. Add a root `LICENSE`, set the
   `license` field on every package, and include `LICENSE` in each package's
   `files` array. MIT is the already-declared intent.
4. **`publishConfig.access` is `"restricted"` on every package**, and `ci.yml`
   publishes with `npm publish --access restricted`. Restricted scoped packages
   require a paid npm organisation. Going open source means flipping these to
   `public` — which removes an npm cost as a side effect. This is a real saving,
   just not a CI one.
5. **No `README` worth the name** (one line), no `CONTRIBUTING.md`,
   `SECURITY.md`, or issue templates. A public repo without them collects
   low-quality issues and has no channel for vulnerability reports.

### Leaks that are real but low-harm

- `12-apps/ci`'s `README.md` and `CONSUMING.md` name `future-pay`, `apps/web`,
  and `apps/admin`, and document the deployment topology (DigitalOcean droplet
  running docker-compose, GHCR images, Cloudflare Pages/Workers) plus the exact
  secret *names* consumers must set. This is architecture disclosure, not
  credential disclosure — mild reconnaissance value, nothing exploitable.
  Arguably it is the documentation that makes the framework adoptable.
- `packages/shared-helpers/src/impersonation/` implements Azure AD user
  impersonation over Microsoft Graph, including the admin-role-prefix check that
  gates it. The code is generic and correct-looking, but an authorization
  primitive is the one category where publishing invites targeted scrutiny.
  Worth a dedicated security review before it ships publicly, or keep it back.
- `packages/auth` implements admin access as an `ADMIN_EMAILS` env-var
  allowlist with no roles. That is a deliberate, documented choice, but
  publishing it invites "you have no RBAC" criticism. Low risk, low value.

---

## 3. What is actually worth publishing

Ranked by community value against maintenance cost:

| Package / repo | Value | Risk | Verdict |
|---|---|---|---|
| **`12-apps/ci`** | High | None | **Ship first.** |
| **`@12-apps/mcp`** | High | None after the domain fix | **Strong flagship candidate.** |
| **`@12-apps/ui`** | High | Low | Ship only with maintainer appetite. |
| **`@12-apps/shared-helpers`** (minus `prisma/`) | Medium | Medium | Split first. |
| `@12-apps/eslint-config`, `@12-apps/typescript-config` | Low | None | Free to ship, nobody needs them. |
| `@12-apps/auth` | Low | Low | Optional. |
| `@12-apps/onboarding` | Low | None | Coupled to a specific `OnboardingState` model. |

**`12-apps/ci` is the best candidate and it is not close.** The CD framework is
vendor-pluggable and genuinely generic, but the quality-gate suite is the
unusual part: complexity and flakiness lint, `jscpd` duplication, a **knip
shrink-only ratchet** that only fails on *new* dead code, a flaky-test
quarantine, MCP contract drift detection, RBAC and entitlement coverage gates,
e2e page↔spec coverage, and Next.js `loading.*` coverage — all with
grandfathering exception files designed to be burned down rather than
permanently suppressed. The `.quality-exceptions` burn-down pattern is a real
idea most teams reinvent badly. There is nothing proprietary in it.

Publishing `ci` also has a concrete ergonomic payoff: `CONSUMING.md` §1 exists
only because a *private* reusable-workflow repo needs
`Settings → Actions → Access → "Accessible from repositories in the 12-apps
organization"`, and the README notes composite actions are "the only way a
consumer's job token can run private-repo scripts without a dedicated PAT."
Public actions and reusable workflows are callable by anyone with no org setting
and no PAT. That whole class of setup friction disappears.

**`@12-apps/mcp`** is the timeliest. An app-agnostic OpenAPI→MCP generator that
proxies each tool call to the real endpoint carrying the caller's bearer token —
holding *zero* authorization logic, so the agent can do exactly what the user
can — is a pattern people are actively looking for. It is already written
app-agnostic, already declares MIT, and after the `futuredrink` fix has no
internal references left beyond two doc mentions of `future-pay`.

**`@12-apps/ui`** is ~90 MUI-based components across ~155k LOC (mostly stories
and test-stories). Real value, but public means issues, accessibility reports,
and MUI major-version churn arriving on someone's desk. Ship it only as a
deliberate commitment.

---

## 4. Recommended sequence

1. Publish **`12-apps/ci`** as-is. Add LICENSE, README badge, CONTRIBUTING,
   SECURITY. Zero cleanup needed, highest community value, removes consumer
   setup friction. It saves no CI minutes — do it for the other reasons.
2. Split **`@12-apps/mcp`** out and publish it, `access: public`. It is the
   flagship.
3. Decide the `prisma/` split in `shared-helpers` before publishing anything
   else from this repo.
4. Separately from all of the above, if the CI bill is the real problem:
   consolidate this repo's four install-heavy jobs into one, and route it
   through `monorepo-static.yml` so `turbo --affected` and the `.turbo` cache
   apply. That is where the minutes are.

## Sources

- [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Billing and usage — reusable workflows](https://docs.github.com/en/actions/concepts/billing-and-usage)
